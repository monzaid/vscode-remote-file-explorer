import * as vscode from 'vscode';
import { ConnectionConfig, ConnectionStatus } from './types';
import { IProtocolAdapter } from './IProtocolAdapter';
import { EventEmitter } from 'events';
/**
 * Manages connection configurations, credential storage, connection pool,
 * and automatic reconnection with exponential backoff.
 */
export declare class ConnectionManager implements vscode.Disposable {
    private configPath;
    private connections;
    private activeAdapters;
    private statusMap;
    private reconnectTimers;
    private reconnectAttempts;
    private keepaliveInterval;
    private secretStorage;
    private emitter;
    onConnectionStatusChange: EventEmitter<[never]>;
    /** Output channel for debug logging */
    private outputChannel;
    /** Calculate exponential backoff delay: min(2000 * 2^attempts, 30000) */
    private static calcReconnectDelay;
    private static readonly MAX_RECONNECT_ATTEMPTS;
    private static readonly KEEPALIVE_INTERVAL;
    private static readonly CONNECT_TIMEOUT;
    private static readonly RECONNECT_COOLDOWN;
    private autoReconnect;
    private lastReconnectTime;
    constructor(context: vscode.ExtensionContext);
    /**
     * Load configurations from the config file.
     */
    loadConfigurations(): Promise<void>;
    /**
     * Save configurations to the config file (without secrets).
     * Uses atomic write: write to .tmp first, then rename.
     */
    saveConfiguration(): Promise<void>;
    /**
     * Add a new connection.
     */
    addConnection(config: ConnectionConfig): Promise<void>;
    /**
     * Update an existing connection.
     */
    updateConnection(id: string, partial: Partial<ConnectionConfig>): Promise<void>;
    /**
     * Remove a connection and its credentials.
     */
    removeConnection(id: string): Promise<void>;
    /**
     * Get a connection by ID. Fills password from SecretStorage.
     */
    getConnection(id: string): Promise<ConnectionConfig | undefined>;
    /**
     * Get all connections (without credentials).
     */
    getAllConnections(): ConnectionConfig[];
    /**
     * Store a credential in VSCode SecretStorage.
     */
    private storeCredential;
    /**
     * Retrieve a credential from VSCode SecretStorage.
     */
    private getCredential;
    /**
     * Delete a credential from VSCode SecretStorage.
     */
    private deleteCredential;
    /**
     * Set the adapter factory for creating protocol adapters.
     * This is called by extension.ts to register the adapter constructors.
     */
    private adapterFactory?;
    setAdapterFactory(factory: (protocol: string) => IProtocolAdapter): void;
    /**
     * Connect to a remote server.
     */
    connect(id: string): Promise<void>;
    /**
     * Disconnect from a remote server.
     */
    disconnect(id: string): Promise<void>;
    /**
     * Get the adapter for a connection.
     */
    getAdapter(id: string): IProtocolAdapter | undefined;
    /**
     * Register an externally-created adapter (e.g. terminal-only SSH).
     */
    setAdapter(id: string, adapter: IProtocolAdapter): void;
    /**
     * Get connection status.
     */
    getStatus(id: string): ConnectionStatus;
    /**
     * Get all active connection IDs.
     */
    getActiveConnectionIds(): string[];
    /**
     * Get count of active connections.
     */
    getActiveCount(): number;
    /**
     * Start reconnection for a connection.
     * Respects reconnect cooldown to prevent rapid-fire reconnection loops.
     */
    private startReconnect;
    /**
     * Clear reconnection timer for a connection.
     */
    private clearReconnectTimer;
    private static readonly KEEPALIVE_CHECK_TIMEOUT;
    /**
     * Start keepalive checks for all active connections.
     * Uses parallel checks with per-connection timeout to prevent a single
     * hung connection from blocking all other keepalive checks.
     */
    private startKeepalive;
    /**
     * Perform a single keepalive check with timeout protection.
     */
    private performKeepaliveCheck;
    /**
     * Stop keepalive if no active connections.
     */
    private stopKeepaliveIfNoConnections;
    /**
     * Update connection status and emit event.
     */
    private updateStatus;
    /**
     * Disconnect all and clean up resources.
     */
    dispose(): Promise<void>;
}
//# sourceMappingURL=ConnectionManager.d.ts.map