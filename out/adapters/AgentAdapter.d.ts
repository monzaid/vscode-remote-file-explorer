import { IProtocolAdapter } from '../core/IProtocolAdapter';
import { ConnectionConfig, RemoteFileStat, RemoteFileEntry, SearchOptions, SearchResult, ShellSession } from '../core/types';
/**
 * Agent protocol adapter using HTTP/WebSocket communication.
 * Connects to a custom agent server that provides file system operations via REST API.
 */
export declare class AgentAdapter implements IProtocolAdapter {
    private config;
    private connected;
    private baseUrl;
    private token;
    private httpAgent;
    private httpsAgent;
    private agentSecure;
    private allowLocalhost;
    constructor();
    /**
     * P1-2: Validate a file path to prevent path traversal attacks.
     * Rejects paths containing '..', null bytes, or exceeding maximum length.
     */
    private validatePath;
    /**
     * P1-3: Validate the agent host to prevent SSRF attacks.
     * Rejects localhost/loopback addresses unless explicitly allowed.
     */
    private validateHost;
    /**
     * P1-3: Validate a full URL string for format correctness.
     */
    private validateUrl;
    /**
     * Establish connection to the agent server.
     * Performs a health check to verify connectivity.
     */
    connect(config: ConnectionConfig): Promise<void>;
    /**
     * Disconnect from the agent server.
     */
    disconnect(): Promise<void>;
    /**
     * Check if connected.
     */
    isConnected(): boolean;
    /**
     * Make an HTTP request to the agent API.
     * P2-3: Uses connection-pooled agents for keep-alive.
     * P2-9: Enforces response size limit and handles redirects.
     */
    private apiRequest;
    /**
     * Map agent API response to RemoteFileStat.
     */
    private mapStat;
    /**
     * Get file/directory stat.
     */
    stat(path: string): Promise<RemoteFileStat>;
    /**
     * List directory contents.
     */
    readDirectory(dirPath: string): Promise<RemoteFileEntry[]>;
    /**
     * Read file contents.
     */
    readFile(filePath: string): Promise<Uint8Array>;
    /**
     * Write file contents.
     */
    writeFile(filePath: string, content: Uint8Array): Promise<void>;
    /**
     * Delete file or directory.
     */
    delete(targetPath: string, recursive?: boolean): Promise<void>;
    /**
     * Rename/move file or directory.
     */
    rename(oldPath: string, newPath: string): Promise<void>;
    /**
     * Create a new directory.
     */
    createDirectory(dirPath: string): Promise<void>;
    /**
     * Search for pattern using agent API.
     */
    search(rootPath: string, pattern: string, options?: SearchOptions): Promise<SearchResult[]>;
    /**
     * Shell is not typically supported for Agent connections.
     */
    createShell(): Promise<ShellSession>;
}
//# sourceMappingURL=AgentAdapter.d.ts.map