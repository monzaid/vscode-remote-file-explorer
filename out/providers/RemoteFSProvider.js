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
exports.RemoteFSProvider = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
/**
 * VSCode FileSystemProvider implementation for remote file systems.
 * Handles stat, readDirectory, readFile, writeFile, delete, rename, createDirectory.
 * Uses cache-first strategy: reads from local cache when available, downloads on miss.
 */
class RemoteFSProvider {
    /** Build the VSCode filesystem scheme for a given protocol. */
    static schemeFor(protocol) {
        return `remote-${protocol}`;
    }
    /** Get the scheme used by this provider instance. */
    get scheme() {
        return `remote-${this.protocol}`;
    }
    /**
     * Initialize static config cache. Call once during extension activation.
     * Sets up a configuration change listener to keep cached values current.
     */
    static initConfig(context) {
        if (RemoteFSProvider.configInitialized)
            return;
        const config = vscode.workspace.getConfiguration('remote-fs');
        RemoteFSProvider.maxFileSize = config.get('maxFileSize', 104857600);
        RemoteFSProvider.warnFileSize = config.get('warnFileSize', 5242880);
        RemoteFSProvider.treeBatchSize = config.get('treeBatchSize', 0);
        RemoteFSProvider.maxTreeItems = config.get('maxTreeItems', 2000);
        context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('remote-fs.maxFileSize')) {
                RemoteFSProvider.maxFileSize = vscode.workspace
                    .getConfiguration('remote-fs')
                    .get('maxFileSize', 104857600);
            }
            if (e.affectsConfiguration('remote-fs.warnFileSize')) {
                RemoteFSProvider.warnFileSize = vscode.workspace
                    .getConfiguration('remote-fs')
                    .get('warnFileSize', 5242880);
            }
            if (e.affectsConfiguration('remote-fs.treeBatchSize')) {
                RemoteFSProvider.treeBatchSize = vscode.workspace
                    .getConfiguration('remote-fs')
                    .get('treeBatchSize', 0);
            }
            if (e.affectsConfiguration('remote-fs.maxTreeItems')) {
                RemoteFSProvider.maxTreeItems = vscode.workspace
                    .getConfiguration('remote-fs')
                    .get('maxTreeItems', 2000);
            }
        }));
        RemoteFSProvider.configInitialized = true;
    }
    constructor(connectionId, protocol, adapter, cacheManager, concurrencyController) {
        this._onDidChangeFile = new vscode.EventEmitter();
        this.onDidChangeFile = this._onDidChangeFile.event;
        this.connectionId = connectionId;
        this.protocol = protocol;
        this.adapter = adapter;
        this.cacheManager = cacheManager;
        this.concurrencyController = concurrencyController;
    }
    /**
     * Parse remote URI to extract path.
     * URI format: remote-{protocol}://connection-id/path/to/file
     */
    parseUri(uri) {
        return {
            connectionId: uri.authority,
            remotePath: uri.path || '/',
        };
    }
    /**
     * Execute a remote operation through the concurrency controller if one is configured.
     * Falls back to direct execution when no concurrency controller is provided.
     */
    enqueueRemoteOp(fn, label) {
        if (this.concurrencyController) {
            return this.concurrencyController.enqueue(fn, label);
        }
        return fn();
    }
    // ==================== FileSystemProvider Methods ====================
    /**
     * Get file/directory stat.
     */
    async stat(uri) {
        const { remotePath } = this.parseUri(uri);
        const remoteStat = await this.enqueueRemoteOp(() => this.adapter.stat(remotePath), `stat:${remotePath}`);
        const type = remoteStat.type === 'directory'
            ? vscode.FileType.Directory
            : remoteStat.type === 'symlink'
                ? vscode.FileType.SymbolicLink
                : vscode.FileType.File;
        const permissions = remoteStat.permissions && !remoteStat.permissions.includes('w')
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
    async readDirectory(uri) {
        const { remotePath } = this.parseUri(uri);
        const entries = await this.enqueueRemoteOp(() => this.adapter.readDirectory(remotePath), `readDir:${remotePath}`);
        return entries.map((entry) => {
            const type = entry.stat.type === 'directory'
                ? vscode.FileType.Directory
                : entry.stat.type === 'symlink'
                    ? vscode.FileType.SymbolicLink
                    : vscode.FileType.File;
            return [entry.name, type];
        });
    }
    /**
     * Read file contents. Cache-first strategy.
     */
    async readFile(uri) {
        const { remotePath } = this.parseUri(uri);
        // Try cache first — readCache directly, no separate stat call
        try {
            return await this.cacheManager.readCache(this.connectionId, remotePath);
        }
        catch {
            // Cache miss or read error, fall through to remote download
        }
        // Get remote file info for size check
        let remoteStat;
        try {
            remoteStat = await this.enqueueRemoteOp(() => this.adapter.stat(remotePath), `stat:${remotePath}`);
        }
        catch (err) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        // Size checks
        if (remoteStat.size > RemoteFSProvider.maxFileSize) {
            // File too large — offer download option
            const action = await vscode.window.showErrorMessage(`File is too large (${(remoteStat.size / 1048576).toFixed(1)}MB). Maximum is ${(RemoteFSProvider.maxFileSize / 1048576).toFixed(0)}MB.`, 'Download to Local', 'Cancel');
            if (action === 'Download to Local') {
                const saveUri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(path.basename(remotePath)),
                });
                if (saveUri) {
                    const content = await this.enqueueRemoteOp(() => this.adapter.readFile(remotePath), `readFile:${remotePath}`);
                    await vscode.workspace.fs.writeFile(saveUri, content);
                    vscode.window.showInformationMessage(`File downloaded to ${saveUri.fsPath}`);
                }
            }
            throw vscode.FileSystemError.FileNotFound(uri); // Prevent opening
        }
        if (remoteStat.size > RemoteFSProvider.warnFileSize) {
            const proceed = await vscode.window.showWarningMessage(`File is ${(remoteStat.size / 1048576).toFixed(1)}MB. Opening large files may be slow.`, 'Open Anyway', 'Cancel');
            if (proceed !== 'Open Anyway') {
                throw vscode.FileSystemError.FileNotFound(uri);
            }
        }
        // Download and cache
        const content = await this.enqueueRemoteOp(() => this.adapter.readFile(remotePath), `readFile:${remotePath}`);
        // Only cache files under maxFileSize
        if (remoteStat.size <= RemoteFSProvider.maxFileSize) {
            await this.cacheManager.writeCache(this.connectionId, remotePath, content);
        }
        return content;
    }
    /**
     * Write file contents to local cache only (Ctrl+S).
     * Upload is handled separately by syncToRemote (⬆️ command).
     */
    async writeFile(uri, content, _options) {
        const { remotePath } = this.parseUri(uri);
        await this.cacheManager.writeCache(this.connectionId, remotePath, content);
        this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    }
    /**
     * Delete file or directory.
     */
    async delete(uri, options) {
        const { remotePath } = this.parseUri(uri);
        await this.enqueueRemoteOp(() => this.adapter.delete(remotePath, options.recursive), `delete:${remotePath}`);
        // Clear cache for deleted file
        await this.cacheManager.deleteCache(this.connectionId, remotePath);
        this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
    }
    /**
     * Rename/move file or directory.
     */
    async rename(oldUri, newUri, options) {
        const { remotePath: oldPath } = this.parseUri(oldUri);
        const { remotePath: newPath } = this.parseUri(newUri);
        await this.enqueueRemoteOp(() => this.adapter.rename(oldPath, newPath), `rename:${oldPath}->${newPath}`);
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
    async createDirectory(uri) {
        const { remotePath } = this.parseUri(uri);
        await this.enqueueRemoteOp(() => this.adapter.createDirectory(remotePath), `mkdir:${remotePath}`);
        this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Created, uri }]);
    }
    /**
     * Watch for file changes. Currently returns an empty disposable
     * since real-time watching is not implemented.
     */
    watch(_uri, _options) {
        return new vscode.Disposable(() => { });
    }
    /**
     * Refresh the file tree by firing a change event.
     */
    refresh(uri) {
        if (uri) {
            this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
        }
    }
}
exports.RemoteFSProvider = RemoteFSProvider;
// Static cached configuration values — initialized once and updated via listener
RemoteFSProvider.maxFileSize = 104857600; // 100MB default
RemoteFSProvider.warnFileSize = 5242880; // 5MB default
RemoteFSProvider.treeBatchSize = 0; // P2-3: 0 = unlimited, >0 = batch size
RemoteFSProvider.maxTreeItems = 2000; // P2-3: hard limit default
RemoteFSProvider.configInitialized = false;
//# sourceMappingURL=RemoteFSProvider.js.map