import * as vscode from 'vscode';
import { IProtocolAdapter } from '../core/IProtocolAdapter';
import { LocalCacheManager } from '../core/LocalCacheManager';
import { ConcurrencyController } from '../core/ConcurrencyController';
/**
 * VSCode FileSystemProvider implementation for remote file systems.
 * Handles stat, readDirectory, readFile, writeFile, delete, rename, createDirectory.
 * Uses cache-first strategy: reads from local cache when available, downloads on miss.
 */
export declare class RemoteFSProvider implements vscode.FileSystemProvider {
    private _onDidChangeFile;
    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]>;
    private connectionId;
    private protocol;
    private adapter;
    private cacheManager;
    private concurrencyController?;
    private static maxFileSize;
    private static warnFileSize;
    private static treeBatchSize;
    private static maxTreeItems;
    private static configInitialized;
    /** Build the VSCode filesystem scheme for a given protocol. */
    static schemeFor(protocol: string): string;
    /** Get the scheme used by this provider instance. */
    get scheme(): string;
    /**
     * Initialize static config cache. Call once during extension activation.
     * Sets up a configuration change listener to keep cached values current.
     */
    static initConfig(context: vscode.ExtensionContext): void;
    constructor(connectionId: string, protocol: string, adapter: IProtocolAdapter, cacheManager: LocalCacheManager, concurrencyController?: ConcurrencyController);
    /**
     * Parse remote URI to extract path.
     * URI format: remote-{protocol}://connection-id/path/to/file
     * P2 fix: validate authority to prevent injection via malicious URIs.
     */
    private parseUri;
    /**
     * Execute a remote operation through the concurrency controller if one is configured.
     * Falls back to direct execution when no concurrency controller is provided.
     */
    private enqueueRemoteOp;
    /**
     * Get file/directory stat.
     */
    stat(uri: vscode.Uri): Promise<vscode.FileStat>;
    /**
     * List directory contents.
     * P2-3: apply maxTreeItems limit to prevent overwhelming the UI.
     */
    readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]>;
    /**
     * Read file contents. Cache-first strategy.
     * P1: download-first on cache miss (no separate stat call — saves 1 RTT).
     * Size checks use content.byteLength from the download result.
     */
    readFile(uri: vscode.Uri): Promise<Uint8Array>;
    /**
     * Write file contents to local cache only (Ctrl+S).
     * Upload is handled separately by syncToRemote (⬆️ command).
     */
    writeFile(uri: vscode.Uri, content: Uint8Array, _options: {
        readonly create: boolean;
        readonly overwrite: boolean;
    }): Promise<void>;
    /**
     * Delete file or directory.
     */
    delete(uri: vscode.Uri, options: {
        readonly recursive: boolean;
    }): Promise<void>;
    /**
     * Rename/move file or directory.
     */
    rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: {
        readonly overwrite: boolean;
    }): Promise<void>;
    /**
     * Create a new directory.
     */
    createDirectory(uri: vscode.Uri): Promise<void>;
    /**
     * Watch for file changes via polling fallback.
     * P2 fix: implements 30s polling to detect remote file changes.
     * Real-time inotify/kqueue is not available over remote protocols.
     */
    watch(uri: vscode.Uri, _options: {
        readonly recursive: boolean;
        readonly excludes: readonly string[];
    }): vscode.Disposable;
    /**
     * Refresh the file tree by firing a change event.
     */
    refresh(uri?: vscode.Uri): void;
}
//# sourceMappingURL=RemoteFSProvider.d.ts.map