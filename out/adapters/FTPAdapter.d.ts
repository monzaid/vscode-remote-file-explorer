import { IProtocolAdapter } from '../core/IProtocolAdapter';
import { ConnectionConfig, RemoteFileStat, RemoteFileEntry, SearchOptions, SearchResult, ShellSession } from '../core/types';
/**
 * FTP/FTPS protocol adapter implementation using basic-ftp library.
 */
export declare class FTPAdapter implements IProtocolAdapter {
    private client;
    private connected;
    /** Short-term cache for directory listings to reduce repeated list() calls */
    private dirListCache;
    /**
     * Establish FTP/FTPS connection.
     *
     * Security rules:
     * - Port 990 → FTPS (implicit TLS), always enforced with strict cert validation.
     * - Port 21  → plain FTP, blocked by default unless user explicitly enables
     *   `remote-fs.ftp.allowInsecure` in VSCode settings AND confirms a warning dialog.
     */
    connect(config: ConnectionConfig): Promise<void>;
    /**
     * Disconnect from FTP server.
     */
    disconnect(): Promise<void>;
    /**
     * Check if connected.
     */
    isConnected(): boolean;
    /**
     * Ensure client is available.
     */
    private ensureClient;
    /**
     * Normalize path to ensure it starts with /.
     */
    private normalizePath;
    /**
     * Map FTP file info to RemoteFileStat.
     */
    private mapFileInfo;
    /**
     * Get a cached directory listing, or fetch and cache a fresh one.
     */
    private getCachedList;
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
     * Uses client.list to determine type first, avoiding exception-as-control-flow.
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
     * Search is not supported for FTP.
     */
    search(_rootPath: string, _pattern: string, _options?: SearchOptions): Promise<SearchResult[]>;
    /**
     * Shell is not supported for FTP.
     */
    createShell(): Promise<ShellSession>;
}
//# sourceMappingURL=FTPAdapter.d.ts.map