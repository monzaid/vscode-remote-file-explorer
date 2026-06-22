import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { LocalCacheStat } from './types';

/**
 * Manages local file caching for remote files.
 * Cache directory: globalStorageUri/cache/{connection-id}/{remote-path}
 */
export class LocalCacheManager implements vscode.Disposable {
  private cacheRoot: string;
  private maxSize: number;
  private disposables: vscode.Disposable[] = [];

  /** P0-2: Memory-side cache size counter to avoid repeated filesystem scans. */
  private currentCacheSize: number = 0;

  /** P2-4: LRU cache for getCachePath results. */
  private pathCache: Map<string, string> = new Map();
  private static readonly PATH_CACHE_MAX = 1000;

  constructor(context: vscode.ExtensionContext) {
    this.cacheRoot = path.resolve(path.join(context.globalStorageUri.fsPath, 'cache'));
    this.maxSize = vscode.workspace
      .getConfiguration('remote-fs')
      .get<number>('cacheMaxSize', 524288000); // Default 500MB
  }

  /**
   * P1-4: Validate that a resolved cache path stays within cacheRoot.
   * Throws if the path escapes cacheRoot (path traversal attempt).
   */
  private validatePath(cachePath: string): void {
    const resolved = path.resolve(cachePath);
    const normalizedRoot = path.resolve(this.cacheRoot);
    if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
      throw new Error(`Path traversal detected: "${cachePath}" is outside cache root.`);
    }
  }

  /**
   * Get the local cache path for a remote file.
   */
  getCachePath(connectionId: string, remotePath: string): string {
    // P1-4: Unicode normalization + encoded traversal guard
    const normalized = remotePath.normalize('NFC');
    if (normalized.includes('..') || normalized.includes('%2e%2e') || normalized.includes('%2E%2E')) {
      throw new Error(`Invalid remotePath: path traversal not allowed.`);
    }

    // P2-4: Use LRU cache to avoid repeated regex replacement
    const cacheKey = `${connectionId}::${normalized}`;
    const cached = this.pathCache.get(cacheKey);
    if (cached !== undefined) {
      // P2 fix: true LRU — move accessed entry to end of Map on cache hit
      this.pathCache.delete(cacheKey);
      this.pathCache.set(cacheKey, cached);
      return cached;
    }

    // Normalize remote path: replace / with path separator, remove leading /
    const normalizedPath = normalized.replace(/^\//, '').replace(/\//g, path.sep);
    const result = path.join(this.cacheRoot, connectionId, normalizedPath);

    // P1-4: Validate the resolved path stays within cacheRoot
    this.validatePath(result);

    // P2-4: Store in LRU cache, evict least-recently-used half if over limit.
    // Since getCachePath moves entries to end on access, the first half of the
    // Map's insertion order are truly the least-recently-used entries.
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
  async hasCache(connectionId: string, remotePath: string): Promise<boolean> {
    try {
      const cachePath = this.getCachePath(connectionId, remotePath);
      await fs.access(cachePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get cache file metadata.
   */
  async getCacheStat(connectionId: string, remotePath: string): Promise<LocalCacheStat> {
    try {
      const cachePath = this.getCachePath(connectionId, remotePath);
      const stat = await fs.stat(cachePath);
      return {
        exists: true,
        mtime: stat.mtime,
        size: stat.size,
      };
    } catch {
      return { exists: false };
    }
  }

  /**
   * Write content to the local cache. Also writes the SHA-256 hash.
   */
  async writeCache(connectionId: string, remotePath: string, content: Uint8Array): Promise<void> {
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
  async writeLocalHash(connectionId: string, remotePath: string, content: Uint8Array): Promise<void> {
    const cachePath = this.getCachePath(connectionId, remotePath);
    const hashPath = cachePath + '.localhash';
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    await fs.mkdir(path.dirname(hashPath), { recursive: true });
    await fs.writeFile(hashPath, hash, 'utf-8');
  }

  /**
   * Read SHA-256 hash from the sidecar file (.localhash).
   * Returns the hex string, or undefined if the hash file doesn't exist.
   */
  async readLocalHash(connectionId: string, remotePath: string): Promise<string | undefined> {
    try {
      const cachePath = this.getCachePath(connectionId, remotePath);
      const hashPath = cachePath + '.localhash';
      return await fs.readFile(hashPath, 'utf-8');
    } catch {
      return undefined;
    }
  }

  /**
   * Read content from the local cache.
   */
  async readCache(connectionId: string, remotePath: string): Promise<Uint8Array> {
    const cachePath = this.getCachePath(connectionId, remotePath);
    const buffer = await fs.readFile(cachePath);
    return new Uint8Array(buffer);
  }

  /**
   * Delete a single cached file and its hash sidecar.
   */
  async deleteCache(connectionId: string, remotePath: string): Promise<void> {
    try {
      const cachePath = this.getCachePath(connectionId, remotePath);

      // P0-2: Track size before deletion to update counter
      try {
        const stat = await fs.stat(cachePath);
        this.currentCacheSize = Math.max(0, this.currentCacheSize - stat.size);
      } catch {
        // File may not exist — that's fine
      }

      await fs.unlink(cachePath);
      // Also delete hash sidecar file
      try { await fs.unlink(cachePath + '.localhash'); } catch { /* ok if missing */ }
    } catch {
      // File may not exist — that's fine
    }
  }

  /**
   * Clear all cache for a specific connection.
   */
  async clearConnectionCache(connectionId: string): Promise<void> {
    const connCacheDir = path.join(this.cacheRoot, connectionId);
    try {
      await fs.rm(connCacheDir, { recursive: true, force: true });
      // P0-2: Reset memory counter and re-sync from filesystem
      this.currentCacheSize = 0;
      await this.syncCacheSize();
    } catch {
      // Directory may not exist
    }
  }

  /**
   * Clear all cache.
   */
  async clearAllCache(): Promise<void> {
    try {
      await fs.rm(this.cacheRoot, { recursive: true, force: true });
      // P0-2: Reset memory counter
      this.currentCacheSize = 0;
    } catch {
      // Directory may not exist
    }
  }

  /**
   * Get total cache size in bytes.
   */
  async getCacheSize(): Promise<number> {
    return this.calculateDirSize(this.cacheRoot);
  }

  /**
   * Prune cache if it exceeds the maximum size.
   * Removes oldest files first.
   */
  async pruneCache(maxSize?: number): Promise<void> {
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
      if (sizeToFree <= 0) break;
      try {
        // P2-1: Use file.size directly from getAllCachedFiles, no extra fs.stat call
        await fs.unlink(file.path);
        sizeToFree -= file.size;
        // P0-2: Update memory counter
        this.currentCacheSize = Math.max(0, this.currentCacheSize - file.size);
      } catch {
        // Skip files that can't be accessed
      }
    }
  }

  /**
   * P0-2: Sync the memory-side cache size counter with the filesystem.
   * Called periodically or after bulk operations to correct drift.
   */
  async syncCacheSize(): Promise<void> {
    this.currentCacheSize = await this.getCacheSize();
  }

  /**
   * Recursively calculate directory size.
   */
  private async calculateDirSize(dirPath: string): Promise<number> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      let totalSize = 0;

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          totalSize += await this.calculateDirSize(fullPath);
        } else if (entry.isFile()) {
          const stat = await fs.stat(fullPath);
          totalSize += stat.size;
        }
      }

      return totalSize;
    } catch {
      return 0;
    }
  }

  /**
   * P2-1: Get all cached files with their modification times and sizes.
   * Size is collected alongside mtime to avoid repeated fs.stat calls in pruneCache.
   */
  private async getAllCachedFiles(): Promise<Array<{ path: string; mtime: Date; size: number }>> {
    const result: Array<{ path: string; mtime: Date; size: number }> = [];
    await this.collectFiles(this.cacheRoot, result);
    return result;
  }

  /**
   * Recursively collect files from a directory.
   */
  private async collectFiles(
    dirPath: string,
    result: Array<{ path: string; mtime: Date; size: number }>
  ): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          await this.collectFiles(fullPath, result);
        } else if (entry.isFile()) {
          const stat = await fs.stat(fullPath);
          // P2-1: Record both mtime and size in a single stat call
          result.push({ path: fullPath, mtime: stat.mtime, size: stat.size });
        }
      }
    } catch {
      // Skip directories that can't be accessed
    }
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
