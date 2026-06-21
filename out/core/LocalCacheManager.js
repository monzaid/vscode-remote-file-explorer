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
exports.LocalCacheManager = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs/promises"));
const crypto = __importStar(require("crypto"));
/**
 * Manages local file caching for remote files.
 * Cache directory: globalStorageUri/cache/{connection-id}/{remote-path}
 */
class LocalCacheManager {
    constructor(context) {
        this.disposables = [];
        /** P0-2: Memory-side cache size counter to avoid repeated filesystem scans. */
        this.currentCacheSize = 0;
        /** P2-4: LRU cache for getCachePath results. */
        this.pathCache = new Map();
        this.cacheRoot = path.resolve(path.join(context.globalStorageUri.fsPath, 'cache'));
        this.maxSize = vscode.workspace
            .getConfiguration('remote-fs')
            .get('cacheMaxSize', 524288000); // Default 500MB
    }
    /**
     * P1-4: Validate that a resolved cache path stays within cacheRoot.
     * Throws if the path escapes cacheRoot (path traversal attempt).
     */
    validatePath(cachePath) {
        const resolved = path.resolve(cachePath);
        const normalizedRoot = path.resolve(this.cacheRoot);
        if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
            throw new Error(`Path traversal detected: "${cachePath}" is outside cache root.`);
        }
    }
    /**
     * Get the local cache path for a remote file.
     */
    getCachePath(connectionId, remotePath) {
        // P1-4: Reject paths containing ".." to prevent traversal
        if (remotePath.includes('..')) {
            throw new Error(`Invalid remotePath: ".." is not allowed.`);
        }
        // P2-4: Use LRU cache to avoid repeated regex replacement
        const cacheKey = `${connectionId}::${remotePath}`;
        const cached = this.pathCache.get(cacheKey);
        if (cached !== undefined) {
            return cached;
        }
        // Normalize remote path: replace / with path separator, remove leading /
        const normalizedPath = remotePath.replace(/^\//, '').replace(/\//g, path.sep);
        const result = path.join(this.cacheRoot, connectionId, normalizedPath);
        // P1-4: Validate the resolved path stays within cacheRoot
        this.validatePath(result);
        // P2-4: Store in LRU cache, evict half if over limit
        if (this.pathCache.size >= LocalCacheManager.PATH_CACHE_MAX) {
            const entries = [...this.pathCache.keys()];
            const half = Math.floor(entries.length / 2);
            for (let i = 0; i < half; i++) {
                this.pathCache.delete(entries[i]);
            }
        }
        this.pathCache.set(cacheKey, result);
        return result;
    }
    /**
     * Check if a cached file exists.
     */
    async hasCache(connectionId, remotePath) {
        try {
            const cachePath = this.getCachePath(connectionId, remotePath);
            await fs.access(cachePath);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Get cache file metadata.
     */
    async getCacheStat(connectionId, remotePath) {
        try {
            const cachePath = this.getCachePath(connectionId, remotePath);
            const stat = await fs.stat(cachePath);
            return {
                exists: true,
                mtime: stat.mtime,
                size: stat.size,
            };
        }
        catch {
            return { exists: false };
        }
    }
    /**
     * Write content to the local cache. Also writes the SHA-256 hash.
     */
    async writeCache(connectionId, remotePath, content) {
        const cachePath = this.getCachePath(connectionId, remotePath);
        // P0-2: Check capacity before writing — prune if over maxSize
        if (this.currentCacheSize > this.maxSize) {
            await this.pruneCache();
        }
        await fs.mkdir(path.dirname(cachePath), { recursive: true });
        await fs.writeFile(cachePath, content);
        // Write local content hash for cache integrity
        await this.writeLocalHash(connectionId, remotePath, content);
        // P0-2: Update memory-side counter
        this.currentCacheSize += content.byteLength;
    }
    /**
     * Write SHA-256 hash of content to a sidecar file (.localhash).
     */
    async writeLocalHash(connectionId, remotePath, content) {
        const cachePath = this.getCachePath(connectionId, remotePath);
        const hashPath = cachePath + '.localhash';
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        await fs.mkdir(path.dirname(hashPath), { recursive: true });
        await fs.writeFile(hashPath, hash, 'utf-8');
    }
    /**
     * Read stored SHA-256 local hash. Returns null if not cached.
     */
    async readLocalHash(connectionId, remotePath) {
        try {
            const cachePath = this.getCachePath(connectionId, remotePath);
            return await fs.readFile(cachePath + '.localhash', 'utf-8');
        }
        catch {
            return null;
        }
    }
    /**
     * Write remote baseline hash (.remotebasehash) — records the last-known remote hash.
     * Only written after download/sync/upload, NOT on local save (Ctrl+S).
     * This is the reference for conflict detection.
     */
    async writeRemoteBaseHash(connectionId, remotePath, content) {
        const cachePath = this.getCachePath(connectionId, remotePath);
        const basePath = cachePath + '.remotebasehash';
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        await fs.mkdir(path.dirname(basePath), { recursive: true });
        await fs.writeFile(basePath, hash, 'utf-8');
    }
    /**
     * Read remote baseline hash. Returns null if never synced.
     */
    async readRemoteBaseHash(connectionId, remotePath) {
        try {
            const cachePath = this.getCachePath(connectionId, remotePath);
            return await fs.readFile(cachePath + '.remotebasehash', 'utf-8');
        }
        catch {
            return null;
        }
    }
    /**
     * Read content from the local cache.
     */
    async readCache(connectionId, remotePath) {
        const cachePath = this.getCachePath(connectionId, remotePath);
        const buffer = await fs.readFile(cachePath);
        return new Uint8Array(buffer);
    }
    /**
     * Delete a single cached file and its hash sidecar.
     */
    async deleteCache(connectionId, remotePath) {
        try {
            const cachePath = this.getCachePath(connectionId, remotePath);
            // P0-2: Track size before deletion to update counter
            try {
                const stat = await fs.stat(cachePath);
                this.currentCacheSize = Math.max(0, this.currentCacheSize - stat.size);
            }
            catch {
                // File may not exist — that's fine
            }
            await fs.unlink(cachePath);
            // Also delete hash and base sidecar files
            try {
                await fs.unlink(cachePath + '.localhash');
            }
            catch { /* ok if missing */ }
            try {
                await fs.unlink(cachePath + '.remotebasehash');
            }
            catch { /* ok if missing */ }
        }
        catch {
            // File may not exist — that's fine
        }
    }
    /**
     * Clear all cache for a specific connection.
     */
    async clearConnectionCache(connectionId) {
        const connCacheDir = path.join(this.cacheRoot, connectionId);
        try {
            await fs.rm(connCacheDir, { recursive: true, force: true });
            // P0-2: Reset memory counter and re-sync from filesystem
            this.currentCacheSize = 0;
            await this.syncCacheSize();
        }
        catch {
            // Directory may not exist
        }
    }
    /**
     * Clear all cache.
     */
    async clearAllCache() {
        try {
            await fs.rm(this.cacheRoot, { recursive: true, force: true });
            // P0-2: Reset memory counter
            this.currentCacheSize = 0;
        }
        catch {
            // Directory may not exist
        }
    }
    /**
     * Get total cache size in bytes.
     */
    async getCacheSize() {
        return this.calculateDirSize(this.cacheRoot);
    }
    /**
     * Prune cache if it exceeds the maximum size.
     * Removes oldest files first.
     */
    async pruneCache(maxSize) {
        const limit = maxSize ?? this.maxSize;
        // P0-2: Use memory counter first, fall back to filesystem scan
        let currentSize = this.currentCacheSize;
        if (currentSize <= 0) {
            currentSize = await this.getCacheSize();
            this.currentCacheSize = currentSize;
        }
        if (currentSize <= limit) {
            return;
        }
        // Get all cached files with their stats, sorted by mtime (oldest first)
        const files = await this.getAllCachedFiles();
        files.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());
        let sizeToFree = currentSize - limit;
        for (const file of files) {
            if (sizeToFree <= 0)
                break;
            try {
                // P2-1: Use file.size directly from getAllCachedFiles, no extra fs.stat call
                await fs.unlink(file.path);
                sizeToFree -= file.size;
                // P0-2: Update memory counter
                this.currentCacheSize = Math.max(0, this.currentCacheSize - file.size);
            }
            catch {
                // Skip files that can't be accessed
            }
        }
    }
    /**
     * P0-2: Sync the memory-side cache size counter with the filesystem.
     * Called periodically or after bulk operations to correct drift.
     */
    async syncCacheSize() {
        this.currentCacheSize = await this.getCacheSize();
    }
    /**
     * Recursively calculate directory size.
     */
    async calculateDirSize(dirPath) {
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            let totalSize = 0;
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                if (entry.isDirectory()) {
                    totalSize += await this.calculateDirSize(fullPath);
                }
                else if (entry.isFile()) {
                    const stat = await fs.stat(fullPath);
                    totalSize += stat.size;
                }
            }
            return totalSize;
        }
        catch {
            return 0;
        }
    }
    /**
     * P2-1: Get all cached files with their modification times and sizes.
     * Size is collected alongside mtime to avoid repeated fs.stat calls in pruneCache.
     */
    async getAllCachedFiles() {
        const result = [];
        await this.collectFiles(this.cacheRoot, result);
        return result;
    }
    /**
     * Recursively collect files from a directory.
     */
    async collectFiles(dirPath, result) {
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                if (entry.isDirectory()) {
                    await this.collectFiles(fullPath, result);
                }
                else if (entry.isFile()) {
                    const stat = await fs.stat(fullPath);
                    // P2-1: Record both mtime and size in a single stat call
                    result.push({ path: fullPath, mtime: stat.mtime, size: stat.size });
                }
            }
        }
        catch {
            // Skip directories that can't be accessed
        }
    }
    dispose() {
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}
exports.LocalCacheManager = LocalCacheManager;
LocalCacheManager.PATH_CACHE_MAX = 1000;
//# sourceMappingURL=LocalCacheManager.js.map