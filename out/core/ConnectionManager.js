"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectionManager = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs/promises"));
const events_1 = require("events");
/**
 * Manages connection configurations, credential storage, connection pool,
 * and automatic reconnection with exponential backoff.
 */
class ConnectionManager {
    /** Calculate exponential backoff delay: min(2000 * 2^attempts, 30000) */
    static calcReconnectDelay(attempts) {
        return Math.min(2000 * Math.pow(2, attempts), 30000);
    }
    constructor(context) {
        this.connections = new Map();
        this.activeAdapters = new Map();
        this.statusMap = new Map();
        this.reconnectTimers = new Map();
        this.reconnectAttempts = new Map();
        this.keepaliveInterval = null;
        this.emitter = new events_1.EventEmitter();
        this.onConnectionStatusChange = this.emitter;
        // Cached configuration values (updated via onDidChangeConfiguration)
        this.autoReconnect = true;
        this.lastReconnectTime = new Map();
        this.configPath = path.join(context.globalStorageUri.fsPath, 'remote-fs.json');
        this.secretStorage = context.secrets;
        // Create output channel for debug logging
        this.outputChannel = vscode.window.createOutputChannel('Remote FS', { log: true });
        context.subscriptions.push(this.outputChannel);
        // Cache autoReconnect value to avoid IPC overhead in keepalive loop
        this.autoReconnect = vscode.workspace.getConfiguration('remote-fs').get('autoReconnect', true);
        // Listen for configuration changes to update cached value
        context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('remote-fs.autoReconnect')) {
                this.autoReconnect = vscode.workspace.getConfiguration('remote-fs').get('autoReconnect', true);
            }
        }));
    }
    // ==================== Configuration CRUD ====================
    /**
     * Load configurations from the config file.
     */
    async loadConfigurations() {
        try {
            await fs.mkdir(path.dirname(this.configPath), { recursive: true });
            const data = await fs.readFile(this.configPath, 'utf-8');
            const config = JSON.parse(data);
            for (const conn of config.connections) {
                this.connections.set(conn.id, conn);
                this.statusMap.set(conn.id, 'idle');
            }
        }
        catch {
            // Config file doesn't exist yet — start with empty state
        }
    }
    /**
     * Save configurations to the config file (without secrets).
     * Uses atomic write: write to .tmp first, then rename.
     */
    async saveConfiguration() {
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
        const config = {
            version: '1',
            connections,
        };
        const tmpPath = this.configPath + '.tmp';
        try {
            await fs.writeFile(tmpPath, JSON.stringify(config, null, 2), 'utf-8');
            await fs.rename(tmpPath, this.configPath);
        }
        catch {
            // Write failed — original file is preserved, clean up tmp if it exists
            try {
                await fs.unlink(tmpPath);
            }
            catch { /* best effort */ }
            throw new Error('Failed to save connection configuration');
        }
    }
    /**
     * Add a new connection.
     */
    async addConnection(config) {
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
    async updateConnection(id, partial) {
        const existing = this.connections.get(id);
        if (!existing) {
            throw new Error(`Connection ${id} not found`);
        }
        const updated = { ...existing, ...partial, id };
        this.connections.set(id, updated);
        if (partial.password !== undefined) {
            if (partial.password) {
                await this.storeCredential(id, partial.password);
            }
            else {
                await this.deleteCredential(id);
            }
        }
        if (partial.agentToken !== undefined) {
            if (partial.agentToken) {
                await this.storeCredential(`${id}_agent_token`, partial.agentToken);
            }
            else {
                await this.deleteCredential(`${id}_agent_token`);
            }
        }
        await this.saveConfiguration();
    }
    /**
     * Remove a connection and its credentials.
     */
    async removeConnection(id) {
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
    async getConnection(id) {
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
    getAllConnections() {
        return Array.from(this.connections.values());
    }
    // ==================== Credential Storage ====================
    /**
     * Store a credential in VSCode SecretStorage.
     */
    async storeCredential(connectionId, value) {
        await this.secretStorage.store(`remote-fs.${connectionId}`, value);
    }
    /**
     * Retrieve a credential from VSCode SecretStorage.
     */
    async getCredential(connectionId) {
        return this.secretStorage.get(`remote-fs.${connectionId}`);
    }
    /**
     * Delete a credential from VSCode SecretStorage.
     */
    async deleteCredential(connectionId) {
        await this.secretStorage.delete(`remote-fs.${connectionId}`);
    }
    setAdapterFactory(factory) {
        this.adapterFactory = factory;
    }
    /**
     * Connect to a remote server.
     */
    async connect(id) {
        const config = await this.getConnection(id);
        if (!config) {
            throw new Error(`Connection ${id} not found`);
        }
        if (!this.adapterFactory) {
            throw new Error('Adapter factory not registered');
        }
        this.outputChannel.debug(`Connecting to ${id} (${config.protocol}://${config.host}:${config.port})...`);
        this.updateStatus(id, 'connecting');
        let timer = null;
        try {
            const adapter = this.adapterFactory(config.protocol);
            // Set connection timeout with proper cleanup
            const timeoutPromise = new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('Connection timeout')), ConnectionManager.CONNECT_TIMEOUT);
            });
            await Promise.race([adapter.connect(config), timeoutPromise]);
            this.activeAdapters.set(id, adapter);
            this.reconnectAttempts.set(id, 0);
            this.updateStatus(id, 'connected');
            this.outputChannel.info(`Connected to ${id}`);
            this.startKeepalive();
        }
        catch (error) {
            this.outputChannel.error(`Connection failed for ${id}: ${error instanceof Error ? error.message : String(error)}`);
            this.updateStatus(id, 'error', error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
        finally {
            if (timer !== null) {
                clearTimeout(timer);
            }
        }
    }
    /**
     * Disconnect from a remote server.
     */
    async disconnect(id) {
        this.outputChannel.debug(`Disconnecting ${id}...`);
        this.clearReconnectTimer(id);
        const adapter = this.activeAdapters.get(id);
        if (adapter) {
            try {
                await adapter.disconnect();
            }
            catch (err) {
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
    getAdapter(id) {
        return this.activeAdapters.get(id);
    }
    /**
     * Get connection status.
     */
    getStatus(id) {
        return this.statusMap.get(id) ?? 'idle';
    }
    /**
     * Get all active connection IDs.
     */
    getActiveConnectionIds() {
        return Array.from(this.activeAdapters.keys());
    }
    /**
     * Get count of active connections.
     */
    getActiveCount() {
        return this.activeAdapters.size;
    }
    // ==================== Reconnection ====================
    /**
     * Start reconnection for a connection.
     * Respects reconnect cooldown to prevent rapid-fire reconnection loops.
     */
    startReconnect(id) {
        const attempts = this.reconnectAttempts.get(id) ?? 0;
        if (attempts >= ConnectionManager.MAX_RECONNECT_ATTEMPTS) {
            // Check cooldown: if enough time has passed since last attempt, reset counter
            const lastTime = this.lastReconnectTime.get(id) ?? 0;
            if (Date.now() - lastTime >= ConnectionManager.RECONNECT_COOLDOWN) {
                this.reconnectAttempts.set(id, 0);
            }
            else {
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
            }
            catch {
                // Reconnection failed, will try again if not exceeded max attempts
                this.startReconnect(id);
            }
        }, delay);
        this.reconnectTimers.set(id, timer);
    }
    /**
     * Clear reconnection timer for a connection.
     */
    clearReconnectTimer(id) {
        const timer = this.reconnectTimers.get(id);
        if (timer) {
            clearTimeout(timer);
            this.reconnectTimers.delete(id);
        }
    }
    /**
     * Start keepalive checks for all active connections.
     * Uses parallel checks with per-connection timeout to prevent a single
     * hung connection from blocking all other keepalive checks.
     */
    startKeepalive() {
        if (this.keepaliveInterval) {
            return; // Already running
        }
        this.keepaliveInterval = setInterval(() => {
            const checks = Array.from(this.activeAdapters.entries()).map(([id, adapter]) => this.performKeepaliveCheck(id, adapter));
            // Fire all checks in parallel; Promise.allSettled ensures none block others
            Promise.allSettled(checks);
        }, ConnectionManager.KEEPALIVE_INTERVAL);
    }
    /**
     * Perform a single keepalive check with timeout protection.
     */
    async performKeepaliveCheck(id, adapter) {
        try {
            const connected = await Promise.race([
                adapter.isConnected(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Keepalive timeout')), ConnectionManager.KEEPALIVE_CHECK_TIMEOUT)),
            ]);
            if (!connected) {
                this.updateStatus(id, 'disconnected');
                if (this.autoReconnect) {
                    this.startReconnect(id);
                }
            }
        }
        catch {
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
    stopKeepaliveIfNoConnections() {
        if (this.activeAdapters.size === 0 && this.keepaliveInterval) {
            clearInterval(this.keepaliveInterval);
            this.keepaliveInterval = null;
        }
    }
    // ==================== Status Management ====================
    /**
     * Update connection status and emit event.
     */
    updateStatus(id, status, error) {
        this.statusMap.set(id, status);
        this.outputChannel.debug(`Status ${id}: ${status}${error ? ` (${error.message})` : ''}`);
        const event = { connectionId: id, status, error };
        this.emitter.emit('statusChange', event);
    }
    // ==================== Cleanup ====================
    /**
     * Disconnect all and clean up resources.
     */
    async dispose() {
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
            }
            catch {
                // Ignore errors during cleanup
            }
        }
        this.emitter.removeAllListeners();
    }
}
exports.ConnectionManager = ConnectionManager;
ConnectionManager.MAX_RECONNECT_ATTEMPTS = 3;
ConnectionManager.KEEPALIVE_INTERVAL = 30000; // 30 seconds
ConnectionManager.CONNECT_TIMEOUT = 60000; // 60 seconds
ConnectionManager.RECONNECT_COOLDOWN = 5 * 60 * 1000; // 5 minutes
// ==================== Keepalive ====================
ConnectionManager.KEEPALIVE_CHECK_TIMEOUT = 2000; // 2 seconds per check
//# sourceMappingURL=ConnectionManager.js.map