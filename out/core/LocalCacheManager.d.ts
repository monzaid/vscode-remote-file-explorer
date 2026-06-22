import * as vscode from 'vscode';
import { LocalCacheStat } from './types';
/**
 * Manages local file caching for remote files.
 * Cache directory: globalStorageUri/cache/{connection-id}/{remote-path}
 */
export declare class LocalCacheManager implements vscode.Disposable {
    private cacheRoot;
    private maxSize;
    private disposables;
    /** P0-2: Memory-side cache size counter to avoid repeated filesystem scans. */
    private currentCacheSize;
    /** P2-4: LRU cache for getCachePath results. */
    private pathCache;
    private static readonly PATH_CACHE_MAX;
    constructor(context: vscode.ExtensionContext);
    /**
     * P1-4: Validate that a resolved cache path stays within cacheRoot.
     * Throws if the path escapes cacheRoot (path traversal attempt).
     */
    private validatePath;
    /**
     * Get the local cache path for a remote file.
     */
    getCachePath(connectionId: string, remotePath: string): string;
    /**
     * Check if a cached file exists.
     */
    hasCache(connectionId: string, remotePath: string): Promise<boolean>;
    /**
     * Get cache file metadata.
     */
    getCacheStat(connectionId: string, remotePath: string): Promise<LocalCacheStat>;
    /**
     * Write content to the local cache. Also writes the SHA-256 hash.
     */
    writeCache(connectionId: string, remotePath: string, content: Uint8Array): Promise<void>;
    /**
     * Write SHA-256 hash of content to a sidecar file (.localhash).
     */
    writeLocalHash(connectionId: string, remotePath: string, content: Uint8Array): Promise<void>;
    /**
     * Read SHA-256 hash from the sidecar file (.localhash).
     * Returns the hex string, or undefined if the hash file doesn't exist.
     */
    readLocalHash(connectionId: string, remotePath: string): Promise<string | undefined>;
    /**
     * Read content from the local cache.
     */
    readCache(connectionId: string, remotePath: string): Promise<Uint8Array>;
    /**
     * Delete a single cached file and its hash sidecar.
     */
    deleteCache(connectionId: string, remotePath: string): Promise<void>;
    /**
     * Clear all cache for a specific connection.
     */
    clearConnectionCache(connectionId: string): Promise<void>;
    /**
     * Clear all cache.
     */
    clearAllCache(): Promise<void>;
    /**
     * Get total cache size in bytes.
     */
    getCacheSize(): Promise<number>;
    /**
     * Prune cache if it exceeds the maximum size.
     * Removes oldest files first.
     */
    pruneCache(maxSize?: number): Promise<void>;
    /**
     * P0-2: Sync the memory-side cache size counter with the filesystem.
     * Called periodically or after bulk operations to correct drift.
     */
    syncCacheSize(): Promise<void>;
    /**
     * Recursively calculate directory size.
     */
    private calculateDirSize;
    /**
     * P2-1: Get all cached files with their modification times and sizes.
     * Size is collected alongside mtime to avoid repeated fs.stat calls in pruneCache.
     */
    private getAllCachedFiles;
    /**
     * Recursively collect files from a directory.
     */
    private collectFiles;
    dispose(): void;
}
//# sourceMappingURL=LocalCacheManager.d.ts.map