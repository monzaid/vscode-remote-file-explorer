import * as vscode from 'vscode';
import * as path from 'path';
import { IProtocolAdapter } from '../core/IProtocolAdapter';
import { LocalCacheManager } from '../core/LocalCacheManager';
import { ConcurrencyController } from '../core/ConcurrencyController';
import { RemoteFileStat } from '../core/types';

/**
 * VSCode FileSystemProvider implementation for remote file systems.
 * Handles stat, readDirectory, readFile, writeFile, delete, rename, createDirectory.
 * Uses cache-first strategy: reads from local cache when available, downloads on miss.
 */
export class RemoteFSProvider implements vscode.FileSystemProvider {
  private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._onDidChangeFile.event;

  private connectionId: string;
  private protocol: string;
  private adapter: IProtocolAdapter;
  private cacheManager: LocalCacheManager;
  private concurrencyController?: ConcurrencyController;

  // Static cached configuration values — initialized once and updated via listener
  private static maxFileSize: number = 104857600; // 100MB default
  private static warnFileSize: number = 5242880;   // 5MB default
  private static treeBatchSize: number = 0;         // P2-3: 0 = unlimited, >0 = batch size
  private static maxTreeItems: number = 2000;       // P2-3: hard limit default
  private static configInitialized: boolean = false;

  /** Build the VSCode filesystem scheme for a given protocol. */
  static schemeFor(protocol: string): string {
    return `remote-${protocol}`;
  }

  /** Get the scheme used by this provider instance. */
  get scheme(): string {
    return `remote-${this.protocol}`;
  }

  /**
   * Initialize static config cache. Call once during extension activation.
   * Sets up a configuration change listener to keep cached values current.
   */
  static initConfig(context: vscode.ExtensionContext): void {
    if (RemoteFSProvider.configInitialized) return;

    const config = vscode.workspace.getConfiguration('remote-fs');
    RemoteFSProvider.maxFileSize = config.get<number>('maxFileSize', 104857600);
    RemoteFSProvider.warnFileSize = config.get<number>('warnFileSize', 5242880);
    RemoteFSProvider.treeBatchSize = config.get<number>('treeBatchSize', 0);
    RemoteFSProvider.maxTreeItems = config.get<number>('maxTreeItems', 2000);

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('remote-fs.maxFileSize')) {
          RemoteFSProvider.maxFileSize = vscode.workspace
            .getConfiguration('remote-fs')
            .get<number>('maxFileSize', 104857600);
        }
        if (e.affectsConfiguration('remote-fs.warnFileSize')) {
          RemoteFSProvider.warnFileSize = vscode.workspace
            .getConfiguration('remote-fs')
            .get<number>('warnFileSize', 5242880);
        }
        if (e.affectsConfiguration('remote-fs.treeBatchSize')) {
          RemoteFSProvider.treeBatchSize = vscode.workspace
            .getConfiguration('remote-fs')
            .get<number>('treeBatchSize', 0);
        }
        if (e.affectsConfiguration('remote-fs.maxTreeItems')) {
          RemoteFSProvider.maxTreeItems = vscode.workspace
            .getConfiguration('remote-fs')
            .get<number>('maxTreeItems', 2000);
        }
      }),
    );

    RemoteFSProvider.configInitialized = true;
  }

  constructor(
    connectionId: string,
    protocol: string,
    adapter: IProtocolAdapter,
    cacheManager: LocalCacheManager,
    concurrencyController?: ConcurrencyController,
  ) {
    this.connectionId = connectionId;
    this.protocol = protocol;
    this.adapter = adapter;
    this.cacheManager = cacheManager;
    this.concurrencyController = concurrencyController;
  }

  /**
   * Parse remote URI to extract path.
   * URI format: remote-{protocol}://connection-id/path/to/file
   * P2 fix: validate authority to prevent injection via malicious URIs.
   */
  private parseUri(uri: vscode.Uri): { connectionId: string; remotePath: string } {
    const connectionId = uri.authority;
    if (!connectionId || !/^conn-\d+-[a-z0-9]+$/.test(connectionId)) {
      throw vscode.FileSystemError.Unavailable(uri);
    }
    return { connectionId, remotePath: uri.path || '/' };
  }

  /**
   * Execute a remote operation through the concurrency controller if one is configured.
   * Falls back to direct execution when no concurrency controller is provided.
   */
  private enqueueRemoteOp<T>(fn: () => Promise<T>, label: string): Promise<T> {
    if (this.concurrencyController) {
      return this.concurrencyController.enqueue(fn, label);
    }
    return fn();
  }

  // ==================== FileSystemProvider Methods ====================

  /**
   * Get file/directory stat.
   */
  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const { remotePath } = this.parseUri(uri);
    const remoteStat = await this.enqueueRemoteOp(
      () => this.adapter.stat(remotePath),
      `stat:${remotePath}`,
    );

    const type =
      remoteStat.type === 'directory'
        ? vscode.FileType.Directory
        : remoteStat.type === 'symlink'
          ? vscode.FileType.SymbolicLink
          : vscode.FileType.File;

    const permissions =
      remoteStat.permissions && !remoteStat.permissions.includes('w')
        ? vscode.FilePermission.Readonly
        : undefined;

    return {
      type,
      ctime: remoteStat.ctime.getTime(),
      mtime: remoteStat.mtime.getTime(),
      size: remoteStat.size,
      permissions,
    };
  }

  /**
   * List directory contents.
   * P2-3: apply maxTreeItems limit to prevent overwhelming the UI.
   */
  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const { remotePath } = this.parseUri(uri);
    const entries = await this.enqueueRemoteOp(
      () => this.adapter.readDirectory(remotePath),
      `readDir:${remotePath}`,
    );

    const result: [string, vscode.FileType][] = entries.map((entry) => {
      const type =
        entry.stat.type === 'directory'
          ? vscode.FileType.Directory
          : entry.stat.type === 'symlink'
            ? vscode.FileType.SymbolicLink
            : vscode.FileType.File;

      return [entry.name, type] as [string, vscode.FileType];
    });

    // P2-3: apply maxTreeItems limit
    if (RemoteFSProvider.maxTreeItems > 0 && result.length > RemoteFSProvider.maxTreeItems) {
      return result.slice(0, RemoteFSProvider.maxTreeItems);
    }
    return result;
  }

  /**
   * Read file contents. Cache-first strategy.
   * P1: download-first on cache miss (no separate stat call — saves 1 RTT).
   * Size checks use content.byteLength from the download result.
   */
  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const { remotePath } = this.parseUri(uri);

    // Try cache first — readCache directly, no separate stat call
    try {
      return await this.cacheManager.readCache(this.connectionId, remotePath);
    } catch {
      // Cache miss or read error, fall through to remote download
    }

    // Download (single network round-trip; no preceding stat call)
    let content: Uint8Array;
    try {
      content = await this.enqueueRemoteOp(
        () => this.adapter.readFile(remotePath),
        `readFile:${remotePath}`,
      );
    } catch (err) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    // Post-download size checks (uses content.byteLength, no extra network cost)
    if (content.byteLength > RemoteFSProvider.maxFileSize) {
      const action = await vscode.window.showErrorMessage(
        `File too large (${(content.byteLength / 1048576).toFixed(1)}MB). Max ${(RemoteFSProvider.maxFileSize / 1048576).toFixed(0)}MB.`,
        'Download to Local',
        'Cancel',
      );
      if (action === 'Download to Local') {
        const saveUri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(path.basename(remotePath)),
        });
        if (saveUri) {
          await vscode.workspace.fs.writeFile(saveUri, content);
          vscode.window.showInformationMessage(`Downloaded to ${saveUri.fsPath}`);
        }
      }
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    if (content.byteLength > RemoteFSProvider.warnFileSize) {
      const proceed = await vscode.window.showWarningMessage(
        `File is ${(content.byteLength / 1048576).toFixed(1)}MB. May be slow.`,
        'Open Anyway',
        'Cancel',
      );
      if (proceed !== 'Open Anyway') {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
    }

    // Cache downloaded content
    await this.cacheManager.writeCache(this.connectionId, remotePath, content);
    return content;
  }

  /**
   * Write file contents to local cache only (Ctrl+S).
   * Upload is handled separately by syncToRemote (⬆️ command).
   */
  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    _options: { readonly create: boolean; readonly overwrite: boolean },
  ): Promise<void> {
    const { remotePath } = this.parseUri(uri);

    await this.cacheManager.writeCache(this.connectionId, remotePath, content);
    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  /**
   * Delete file or directory.
   */
  async delete(uri: vscode.Uri, options: { readonly recursive: boolean }): Promise<void> {
    const { remotePath } = this.parseUri(uri);
    await this.enqueueRemoteOp(
      () => this.adapter.delete(remotePath, options.recursive),
      `delete:${remotePath}`,
    );

    // Clear cache for deleted file
    await this.cacheManager.deleteCache(this.connectionId, remotePath);

    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }

  /**
   * Rename/move file or directory.
   */
  async rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { readonly overwrite: boolean },
  ): Promise<void> {
    const { remotePath: oldPath } = this.parseUri(oldUri);
    const { remotePath: newPath } = this.parseUri(newUri);

    await this.enqueueRemoteOp(
      () => this.adapter.rename(oldPath, newPath),
      `rename:${oldPath}->${newPath}`,
    );

    // Move cache
    // P3 optimization note: for same-connectionId renames, a direct fs.rename
    // on the cache file would avoid read-write-delete memory overhead. However,
    // rename is not a high-frequency operation, so current approach is acceptable.
    const oldCache = await this.cacheManager.getCacheStat(this.connectionId, oldPath);
    if (oldCache.exists) {
      const content = await this.cacheManager.readCache(this.connectionId, oldPath);
      await this.cacheManager.writeCache(this.connectionId, newPath, content);
      await this.cacheManager.deleteCache(this.connectionId, oldPath);
    }

    this._onDidChangeFile.fire([
      { type: vscode.FileChangeType.Deleted, uri: oldUri },
      { type: vscode.FileChangeType.Created, uri: newUri },
    ]);
  }

  /**
   * Create a new directory.
   */
  async createDirectory(uri: vscode.Uri): Promise<void> {
    const { remotePath } = this.parseUri(uri);
    await this.enqueueRemoteOp(
      () => this.adapter.createDirectory(remotePath),
      `mkdir:${remotePath}`,
    );

    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Created, uri }]);
  }

  /**
   * Watch for file changes via polling fallback.
   * P2 fix: implements 30s polling to detect remote file changes.
   * Real-time inotify/kqueue is not available over remote protocols.
   */
  watch(uri: vscode.Uri, _options: { readonly recursive: boolean; readonly excludes: readonly string[] }): vscode.Disposable {
    const { remotePath } = this.parseUri(uri);
    let interval: ReturnType<typeof setInterval> | null = setInterval(async () => {
      try {
        const remoteStat = await this.adapter.stat(remotePath);
        const cacheStat = await this.cacheManager.getCacheStat(this.connectionId, remotePath);
        if (cacheStat.exists && remoteStat.mtime.getTime() !== cacheStat.mtime?.getTime()) {
          this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
        }
      } catch {
        // stat failed, file may not exist — skip this poll cycle
      }
    }, 30000); // 30s polling interval

    return new vscode.Disposable(() => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    });
  }

  /**
   * Refresh the file tree by firing a change event.
   */
  refresh(uri?: vscode.Uri): void {
    if (uri) {
      this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    }
  }
}
