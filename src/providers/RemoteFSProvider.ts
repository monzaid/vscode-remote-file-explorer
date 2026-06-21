import * as vscode from 'vscode';
import * as path from 'path';
import { IProtocolAdapter } from '../core/IProtocolAdapter';
import { LocalCacheManager } from '../core/LocalCacheManager';
import { ConflictResolver } from './ConflictResolver';
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
  private conflictResolver?: ConflictResolver;
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
    conflictResolver?: ConflictResolver,
    concurrencyController?: ConcurrencyController,
  ) {
    this.connectionId = connectionId;
    this.protocol = protocol;
    this.adapter = adapter;
    this.cacheManager = cacheManager;
    this.conflictResolver = conflictResolver;
    this.concurrencyController = concurrencyController;
  }

  /**
   * Parse remote URI to extract path.
   * URI format: remote-{protocol}://connection-id/path/to/file
   */
  private parseUri(uri: vscode.Uri): { connectionId: string; remotePath: string } {
    return {
      connectionId: uri.authority,
      remotePath: uri.path || '/',
    };
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
   */
  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const { remotePath } = this.parseUri(uri);
    const entries = await this.enqueueRemoteOp(
      () => this.adapter.readDirectory(remotePath),
      `readDir:${remotePath}`,
    );

    return entries.map((entry) => {
      const type =
        entry.stat.type === 'directory'
          ? vscode.FileType.Directory
          : entry.stat.type === 'symlink'
            ? vscode.FileType.SymbolicLink
            : vscode.FileType.File;

      return [entry.name, type] as [string, vscode.FileType];
    });
  }

  /**
   * Read file contents. Cache-first strategy.
   */
  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const { remotePath } = this.parseUri(uri);

    // Try cache first — readCache directly, no separate stat call
    try {
      return await this.cacheManager.readCache(this.connectionId, remotePath);
    } catch {
      // Cache miss or read error, fall through to remote download
    }

    // Get remote file info for size check
    let remoteStat: RemoteFileStat;
    try {
      remoteStat = await this.enqueueRemoteOp(
        () => this.adapter.stat(remotePath),
        `stat:${remotePath}`,
      );
    } catch (err) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    // Size checks
    if (remoteStat.size > RemoteFSProvider.maxFileSize) {
      // File too large — offer download option
      const action = await vscode.window.showErrorMessage(
        `File is too large (${(remoteStat.size / 1048576).toFixed(1)}MB). Maximum is ${(RemoteFSProvider.maxFileSize / 1048576).toFixed(0)}MB.`,
        'Download to Local',
        'Cancel',
      );
      if (action === 'Download to Local') {
        const saveUri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(path.basename(remotePath)),
        });
        if (saveUri) {
          const content = await this.enqueueRemoteOp(
            () => this.adapter.readFile(remotePath),
            `readFile:${remotePath}`,
          );
          await vscode.workspace.fs.writeFile(saveUri, content);
          vscode.window.showInformationMessage(`File downloaded to ${saveUri.fsPath}`);
        }
      }
      throw vscode.FileSystemError.FileNotFound(uri); // Prevent opening
    }

    if (remoteStat.size > RemoteFSProvider.warnFileSize) {
      const proceed = await vscode.window.showWarningMessage(
        `File is ${(remoteStat.size / 1048576).toFixed(1)}MB. Opening large files may be slow.`,
        'Open Anyway',
        'Cancel',
      );
      if (proceed !== 'Open Anyway') {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
    }

    // Download and cache
    const content = await this.enqueueRemoteOp(
      () => this.adapter.readFile(remotePath),
      `readFile:${remotePath}`,
    );

    // Only cache files under maxFileSize
    if (remoteStat.size <= RemoteFSProvider.maxFileSize) {
      await this.cacheManager.writeCache(this.connectionId, remotePath, content);
    }

    return content;
  }

  /**
   * Write file contents. Checks for conflicts first.
   */
  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { readonly create: boolean; readonly overwrite: boolean },
  ): Promise<void> {
    const { remotePath } = this.parseUri(uri);

    // Check for conflicts if conflict resolver is available
    if (this.conflictResolver && !options.create) {
      const cacheStat = await this.cacheManager.getCacheStat(this.connectionId, remotePath);
      if (cacheStat.exists) {
        const conflictResult = await this.conflictResolver.checkConflict(
          this.connectionId,
          remotePath,
        );

        if (conflictResult.hasConflict) {
          const action = await this.conflictResolver.resolveConflict(remotePath, 'upload');
          if (action === 'keep-remote') {
            // Cancel write — keep remote version
            return;
          } else if (action === 'manual-merge') {
            // Open diff editor: local cache vs remote via temp file (avoid RemoteFS route)
            try {
              const remoteContent = await this.enqueueRemoteOp(
                () => this.adapter.readFile(remotePath),
                `readFile:${remotePath}`,
              );
              const baseUri = await this.conflictResolver.writeRemoteTemp(remotePath, remoteContent);
              const localUri = this.adapter ? vscode.Uri.parse(
                `remote-${this.protocol}://${this.connectionId}${remotePath}`
              ) : uri;
              await vscode.commands.executeCommand(
                'vscode.diff',
                baseUri,
                localUri,
                `Merge: ${remotePath.split('/').pop()} (Remote ⇿ Local)`,
              );
            } catch (e) {
              vscode.window.showErrorMessage(`Failed to open diff: ${e instanceof Error ? e.message : e}`);
            }
            return;
          }
          // force-overwrite: fall through to write
        }
      }
    }

    // Write to local cache only — upload is handled by syncToRemote (⬆️ command)
    // This ensures Ctrl+S never triggers an upload; the upload flow properly
    // checks conflicts via syncCommands.syncToRemote() before uploading.
    await this.cacheManager.writeCache(this.connectionId, remotePath, content);

    // Notify file change
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
   * Watch for file changes. Currently returns an empty disposable
   * since real-time watching is not implemented.
   */
  watch(_uri: vscode.Uri, _options: { readonly recursive: boolean; readonly excludes: readonly string[] }): vscode.Disposable {
    return new vscode.Disposable(() => {});
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
