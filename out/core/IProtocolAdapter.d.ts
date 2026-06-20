import { ConnectionConfig, RemoteFileStat, RemoteFileEntry, SearchOptions, SearchResult, ShellSession } from './types';
/**
 * Unified protocol adapter interface.
 * All protocol implementations (SSH, FTP, Agent) must implement this interface.
 */
export interface IProtocolAdapter {
    /** Establish connection to the remote server */
    connect(config: ConnectionConfig): Promise<void>;
    /** Disconnect from the remote server */
    disconnect(): Promise<void>;
    /** Check if the connection is currently active */
    isConnected(): boolean;
    /** Get file/directory stat information */
    stat(path: string): Promise<RemoteFileStat>;
    /** List directory contents */
    readDirectory(path: string): Promise<RemoteFileEntry[]>;
    /** Read file contents as Uint8Array */
    readFile(path: string): Promise<Uint8Array>;
    /** Write file contents */
    writeFile(path: string, content: Uint8Array): Promise<void>;
    /** Delete file or directory (recursive for directories) */
    delete(path: string, recursive?: boolean): Promise<void>;
    /** Rename/move file or directory */
    rename(oldPath: string, newPath: string): Promise<void>;
    /** Create a new directory */
    createDirectory(path: string): Promise<void>;
    /** Search for pattern in files (optional — only SSH typically supports this) */
    search?(rootPath: string, pattern: string, options?: SearchOptions): Promise<SearchResult[]>;
    /** Create an interactive shell session (optional — only SSH supports this) */
    createShell?(): Promise<ShellSession>;
}
//# sourceMappingURL=IProtocolAdapter.d.ts.map