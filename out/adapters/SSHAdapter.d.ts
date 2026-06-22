import { IProtocolAdapter } from '../core/IProtocolAdapter';
import { ConnectionConfig, RemoteFileStat, RemoteFileEntry, SearchOptions, SearchResult, ShellSession } from '../core/types';
/**
 * SSH/SFTP protocol adapter implementation using ssh2 library.
 */
export declare class SSHAdapter implements IProtocolAdapter {
    private client;
    private sftp;
    private config;
    private connected;
    /**
     * Establish SSH connection with SFTP (for file browsing).
     */
    connect(config: ConnectionConfig): Promise<void>;
    /**
     * Establish SSH connection WITHOUT SFTP — for terminal-only use.
     * No FTP/SFTP logic is involved. Only SSH shell is available.
     */
    connectTerminalOnly(config: ConnectionConfig): Promise<void>;
    /** Shared SSH connection logic. `withSftp` controls whether SFTP is initialized. */
    private doConnect;
    /**
     * Disconnect from the remote server.
     */
    disconnect(): Promise<void>;
    /**
     * Check if the connection is active.
     */
    isConnected(): boolean;
    /**
     * Ensure SFTP session is available.
     */
    private ensureConnected;
    /**
     * Map SFTP stats to RemoteFileStat.
     */
    private mapStat;
    /**
     * Get file/directory stat.
     */
    stat(filePath: string): Promise<RemoteFileStat>;
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
     * Escape a value for safe use inside single-quoted shell strings.
     * Strategy: replace every ' with '\'' (end quote, escaped quote, start quote).
     */
    private escapeShellArg;
    /**
     * Validate that a path does not contain shell metacharacters.
     * Allowed: alphanumeric, underscore, dash, dot, forward slash, tilde, spaces, asterisks (globs).
     */
    private validateSafePath;
    /**
     * Search for pattern using remote grep/rg.
     */
    search(rootPath: string, pattern: string, options?: SearchOptions): Promise<SearchResult[]>;
    /**
     * Parse grep/rg output into SearchResult array.
     * Uses indexOf to correctly handle file paths containing colons.
     */
    private parseSearchOutput;
    /**
     * Create an interactive shell session.
     */
    createShell(): Promise<ShellSession>;
}
//# sourceMappingURL=SSHAdapter.d.ts.map