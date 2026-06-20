import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { ConnectionConfig, ConnectionStatus, ConnectionStatusEvent, RemoteFSConfig } from './types';
import { IProtocolAdapter } from './IProtocolAdapter';
import { EventEmitter } from 'events';

/**
 * Manages connection configurations, credential storage, connection pool,
 * and automatic reconnection with exponential backoff.
 */
export class ConnectionManager implements vscode.Disposable {
  private configPath: string;
  private connections: Map<string, ConnectionConfig> = new Map();
  private activeAdapters: Map<string, IProtocolAdapter> = new Map();
  private statusMap: Map<string, ConnectionStatus> = new Map();
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private reconnectAttempts: Map<string, number> = new Map();
  private keepaliveInterval: NodeJS.Timeout | null = null;
  private secretStorage: vscode.SecretStorage;

  private emitter = new EventEmitter();
  onConnectionStatusChange = this.emitter;

  /** Output channel for debug logging */
  private outputChannel: vscode.LogOutputChannel;

  /** Calculate exponential backoff delay: min(2000 * 2^attempts, 30000) */
  private static calcReconnectDelay(attempts: number): number {
    return Math.min(2000 * Math.pow(2, attempts), 30000);
  }
  private static readonly MAX_RECONNECT_ATTEMPTS = 3;
  private static readonly KEEPALIVE_INTERVAL = 30000; // 30 seconds
  private static readonly CONNECT_TIMEOUT = 60000; // 60 seconds
  private static readonly RECONNECT_COOLDOWN = 5 * 60 * 1000; // 5 minutes

  // Cached configuration values (updated via onDidChangeConfiguration)
  private autoReconnect: boolean = true;
  private lastReconnectTime: Map<string, number> = new Map();

  constructor(context: vscode.ExtensionContext) {
    this.configPath = path.join(context.globalStorageUri.fsPath, 'remote-fs.json');
    this.secretStorage = context.secrets;

    // Create output channel for debug logging
    this.outputChannel = vscode.window.createOutputChannel('Remote FS', { log: true });
    context.subscriptions.push(this.outputChannel);

    // Cache autoReconnect value to avoid IPC overhead in keepalive loop
    this.autoReconnect = vscode.workspace.getConfiguration('remote-fs').get<boolean>('autoReconnect', true);

    // Listen for configuration changes to update cached value
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('remote-fs.autoReconnect')) {
          this.autoReconnect = vscode.workspace.getConfiguration('remote-fs').get<boolean>('autoReconnect', true);
        }
      })
    );
  }

  // ==================== Configuration CRUD ====================

  /**
   * Load configurations from the config file.
   */
  async loadConfigurations(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.configPath), { recursive: true });
      const data = await fs.readFile(this.configPath, 'utf-8');
      const config: RemoteFSConfig = JSON.parse(data);
      for (const conn of config.connections) {
        this.connections.set(conn.id, conn);
        this.statusMap.set(conn.id, 'idle');
      }
    } catch {
      // Config file doesn't exist yet — start with empty state
    }
  }

  /**
   * Save configurations to the config file (without secrets).
   * Uses atomic write: write to .tmp first, then rename.
   */
  async saveConfiguration(): Promise<void> {
    await fs.mkdir(path.dirname(this.configPath), { recursive: true });

    // Whitelist: explicitly list fields to persist (exclude secrets)
    const connections = Array.from(this.connections.values()).map((conn) => ({
      id: conn.id,
      label: conn.label,
      protocol: conn.protocol,
      host: conn.host,
      port: conn.port,
      username: conn.username,
      authType: conn.authType,
      privateKeyPath: conn.privateKeyPath,
      passphraseStored: conn.passphraseStored,
      mountedPaths: conn.mountedPaths,
      agentUrl: conn.agentUrl,
    }));

    const config: RemoteFSConfig = {
      version: '1',
      connections,
    };

    const tmpPath = this.configPath + '.tmp';
    try {
      await fs.writeFile(tmpPath, JSON.stringify(config, null, 2), 'utf-8');
      await fs.rename(tmpPath, this.configPath);
    } catch {
      // Write failed — original file is preserved, clean up tmp if it exists
      try { await fs.unlink(tmpPath); } catch { /* best effort */ }
      throw new Error('Failed to save connection configuration');
    }
  }

  /**
   * Add a new connection.
   */
  async addConnection(config: ConnectionConfig): Promise<void> {
    this.connections.set(config.id, config);
    this.statusMap.set(config.id, 'idle');

    // Store password in SecretStorage if provided
    if (config.password) {
      await this.storeCredential(config.id, config.password);
    }
    if (config.agentToken) {
      await this.storeCredential(`${config.id}_agent_token`, config.agentToken);
    }

    await this.saveConfiguration();
  }

  /**
   * Update an existing connection.
   */
  async updateConnection(id: string, partial: Partial<ConnectionConfig>): Promise<void> {
    const existing = this.connections.get(id);
    if (!existing) {
      throw new Error(`Connection ${id} not found`);
    }

    const updated: ConnectionConfig = { ...existing, ...partial, id };
    this.connections.set(id, updated);

    if (partial.password !== undefined) {
      if (partial.password) {
        await this.storeCredential(id, partial.password);
      } else {
        await this.deleteCredential(id);
      }
    }
    if (partial.agentToken !== undefined) {
      if (partial.agentToken) {
        await this.storeCredential(`${id}_agent_token`, partial.agentToken);
      } else {
        await this.deleteCredential(`${id}_agent_token`);
      }
    }

    await this.saveConfiguration();
  }

  /**
   * Remove a connection and its credentials.
   */
  async removeConnection(id: string): Promise<void> {
    // Disconnect if connected
    if (this.activeAdapters.has(id)) {
      await this.disconnect(id);
    }

    this.connections.delete(id);
    this.statusMap.delete(id);
    await this.deleteCredential(id);
    await this.deleteCredential(`${id}_agent_token`);
    await this.saveConfiguration();
  }

  /**
   * Get a connection by ID. Fills password from SecretStorage.
   */
  async getConnection(id: string): Promise<ConnectionConfig | undefined> {
    const config = this.connections.get(id);
    if (!config) {
      return undefined;
    }

    // Fill in credentials from SecretStorage
    const password = await this.getCredential(id);
    const agentToken = await this.getCredential(`${id}_agent_token`);

    return {
      ...config,
      password: password ?? undefined,
      agentToken: agentToken ?? undefined,
    };
  }

  /**
   * Get all connections (without credentials).
   */
  getAllConnections(): ConnectionConfig[] {
    return Array.from(this.connections.values());
  }

  // ==================== Credential Storage ====================

  /**
   * Store a credential in VSCode SecretStorage.
   */
  private async storeCredential(connectionId: string, value: string): Promise<void> {
    await this.secretStorage.store(`remote-fs.${connectionId}`, value);
  }

  /**
   * Retrieve a credential from VSCode SecretStorage.
   */
  private async getCredential(connectionId: string): Promise<string | undefined> {
    return this.secretStorage.get(`remote-fs.${connectionId}`);
  }

  /**
   * Delete a credential from VSCode SecretStorage.
   */
  private async deleteCredential(connectionId: string): Promise<void> {
    await this.secretStorage.delete(`remote-fs.${connectionId}`);
  }

  // ==================== Connection Pool Management ====================

  /**
   * Set the adapter factory for creating protocol adapters.
   * This is called by extension.ts to register the adapter constructors.
   */
  private adapterFactory?: (protocol: string) => IProtocolAdapter;
  setAdapterFactory(factory: (protocol: string) => IProtocolAdapter): void {
    this.adapterFactory = factory;
  }

  /**
   * Connect to a remote server.
   */
  async connect(id: string): Promise<void> {
    const config = await this.getConnection(id);
    if (!config) {
      throw new Error(`Connection ${id} not found`);
    }

    if (!this.adapterFactory) {
      throw new Error('Adapter factory not registered');
    }

    this.outputChannel.debug(`Connecting to ${id} (${config.protocol}://${config.host}:${config.port})...`);
    this.updateStatus(id, 'connecting');

    let timer: NodeJS.Timeout | null = null;
    try {
      const adapter = this.adapterFactory(config.protocol);

      // Set connection timeout with proper cleanup
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Connection timeout')), ConnectionManager.CONNECT_TIMEOUT);
      });

      await Promise.race([adapter.connect(config), timeoutPromise]);

      this.activeAdapters.set(id, adapter);
      this.reconnectAttempts.set(id, 0);
      this.updateStatus(id, 'connected');
      this.outputChannel.info(`Connected to ${id}`);
      this.startKeepalive();
    } catch (error) {
      this.outputChannel.error(`Connection failed for ${id}: ${error instanceof Error ? error.message : String(error)}`);
      this.updateStatus(id, 'error', error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Disconnect from a remote server.
   */
  async disconnect(id: string): Promise<void> {
    this.outputChannel.debug(`Disconnecting ${id}...`);
    this.clearReconnectTimer(id);
    const adapter = this.activeAdapters.get(id);
    if (adapter) {
      try {
        await adapter.disconnect();
      } catch (err) {
        this.outputChannel.warn(`Disconnect error for ${id}: ${err instanceof Error ? err.message : String(err)}`);
      }
      this.activeAdapters.delete(id);
    }
    this.updateStatus(id, 'disconnected');
    this.outputChannel.info(`Disconnected ${id}`);
    this.stopKeepaliveIfNoConnections();
  }

  /**
   * Get the adapter for a connection.
   */
  getAdapter(id: string): IProtocolAdapter | undefined {
    return this.activeAdapters.get(id);
  }

  /**
   * Get connection status.
   */
  getStatus(id: string): ConnectionStatus {
    return this.statusMap.get(id) ?? 'idle';
  }

  /**
   * Get all active connection IDs.
   */
  getActiveConnectionIds(): string[] {
    return Array.from(this.activeAdapters.keys());
  }

  /**
   * Get count of active connections.
   */
  getActiveCount(): number {
    return this.activeAdapters.size;
  }

  // ==================== Reconnection ====================

  /**
   * Start reconnection for a connection.
   * Respects reconnect cooldown to prevent rapid-fire reconnection loops.
   */
  private startReconnect(id: string): void {
    const attempts = this.reconnectAttempts.get(id) ?? 0;
    if (attempts >= ConnectionManager.MAX_RECONNECT_ATTEMPTS) {
      // Check cooldown: if enough time has passed since last attempt, reset counter
      const lastTime = this.lastReconnectTime.get(id) ?? 0;
      if (Date.now() - lastTime >= ConnectionManager.RECONNECT_COOLDOWN) {
        this.reconnectAttempts.set(id, 0);
      } else {
        this.updateStatus(id, 'error', new Error('Max reconnection attempts reached'));
        return;
      }
    }

    const delay = ConnectionManager.calcReconnectDelay(attempts);
    this.outputChannel.debug(`Reconnecting ${id}: attempt ${attempts + 1}/${ConnectionManager.MAX_RECONNECT_ATTEMPTS}, delay ${delay}ms`);
    this.reconnectAttempts.set(id, attempts + 1);
    this.lastReconnectTime.set(id, Date.now());

    const timer = setTimeout(async () => {
      try {
        await this.connect(id);
      } catch {
        // Reconnection failed, will try again if not exceeded max attempts
        this.startReconnect(id);
      }
    }, delay);

    this.reconnectTimers.set(id, timer);
  }

  /**
   * Clear reconnection timer for a connection.
   */
  private clearReconnectTimer(id: string): void {
    const timer = this.reconnectTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(id);
    }
  }

  // ==================== Keepalive ====================

  private static readonly KEEPALIVE_CHECK_TIMEOUT = 2000; // 2 seconds per check

  /**
   * Start keepalive checks for all active connections.
   * Uses parallel checks with per-connection timeout to prevent a single
   * hung connection from blocking all other keepalive checks.
   */
  private startKeepalive(): void {
    if (this.keepaliveInterval) {
      return; // Already running
    }

    this.keepaliveInterval = setInterval(() => {
      const checks = Array.from(this.activeAdapters.entries()).map(([id, adapter]) =>
        this.performKeepaliveCheck(id, adapter)
      );
      // Fire all checks in parallel; Promise.allSettled ensures none block others
      Promise.allSettled(checks);
    }, ConnectionManager.KEEPALIVE_INTERVAL);
  }

  /**
   * Perform a single keepalive check with timeout protection.
   */
  private async performKeepaliveCheck(id: string, adapter: IProtocolAdapter): Promise<void> {
    try {
      const connected = await Promise.race([
        adapter.isConnected(),
        new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error('Keepalive timeout')), ConnectionManager.KEEPALIVE_CHECK_TIMEOUT)
        ),
      ]);

      if (!connected) {
        this.updateStatus(id, 'disconnected');
        if (this.autoReconnect) {
          this.startReconnect(id);
        }
      }
    } catch {
      // Timeout or error — treat as disconnected
      this.updateStatus(id, 'disconnected');
      if (this.autoReconnect) {
        this.startReconnect(id);
      }
    }
  }

  /**
   * Stop keepalive if no active connections.
   */
  private stopKeepaliveIfNoConnections(): void {
    if (this.activeAdapters.size === 0 && this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }
  }

  // ==================== Status Management ====================

  /**
   * Update connection status and emit event.
   */
  private updateStatus(id: string, status: ConnectionStatus, error?: Error): void {
    this.statusMap.set(id, status);
    this.outputChannel.debug(`Status ${id}: ${status}${error ? ` (${error.message})` : ''}`);
    const event: ConnectionStatusEvent = { connectionId: id, status, error };
    this.emitter.emit('statusChange', event);
  }

  // ==================== Cleanup ====================

  /**
   * Disconnect all and clean up resources.
   */
  async dispose(): Promise<void> {
    // Clear keepalive
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }

    // Clear all reconnect timers
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();

    // Disconnect all
    for (const [id] of this.activeAdapters) {
      try {
        await this.disconnect(id);
      } catch {
        // Ignore errors during cleanup
      }
    }

    this.emitter.removeAllListeners();
  }
}
