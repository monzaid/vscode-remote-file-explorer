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
exports.SyncCommandHandler = void 0;
const vscode = __importStar(require("vscode"));
/**
 * Handles inline button commands: ⬇️ Update (sync from remote) and ⬆️ Upload (sync to remote).
 */
class SyncCommandHandler {
    constructor(connectionId, adapter, cacheManager, conflictResolver, protocol) {
        this.connectionId = connectionId;
        this.adapter = adapter;
        this.cacheManager = cacheManager;
        this.conflictResolver = conflictResolver;
        this.protocol = protocol;
    }
    /**
     * ⬇️ Download: Sync file from remote to local cache.
     * Uses content hash for conflict detection.
     */
    async syncFromRemote(remotePath) {
        try {
            const scheme = `remote-${this.protocol}`;
            const remoteUri = vscode.Uri.parse(`${scheme}://${this.connectionId}${remotePath}`);
            const editors = vscode.window.visibleTextEditors.filter(e => e.document.uri.toString() === remoteUri.toString());
            if (editors.length > 0 && editors[0].document.isDirty) {
                const choice = await vscode.window.showWarningMessage('File has unsaved changes. Save locally before updating from remote?', 'Save & Update', 'Cancel');
                if (choice === 'Save & Update') {
                    await editors[0].document.save();
                }
                else {
                    return;
                }
            }
            // Download remote for hash comparison
            const remoteContent = await this.adapter.readFile(remotePath);
            // ── No cache: fresh download ──
            const cacheStat = await this.cacheManager.getCacheStat(this.connectionId, remotePath);
            if (!cacheStat.exists) {
                await this.cacheManager.writeCache(this.connectionId, remotePath, remoteContent);
                await this.cacheManager.writeRemoteBaseHash(this.connectionId, remotePath, remoteContent);
                this.refreshEditor(remotePath, remoteContent, scheme);
                return;
            }
            // ── Cache exists: check conflict ──
            const conflict = await this.conflictResolver.checkConflict(this.connectionId, remotePath);
            if (!conflict.hasConflict) {
                // Remote unchanged and local unchanged → already up to date
                vscode.window.showInformationMessage('File is already up to date.');
                return;
            }
            // ── Conflict: show dialog ──
            const action = await this.conflictResolver.resolveConflict(remotePath, 'download');
            if (action === 'keep-remote') {
                // Keep Local — cancel
                vscode.window.showInformationMessage('Kept local version.');
                return;
            }
            if (action === 'manual-merge') {
                try {
                    const baseUri = await this.conflictResolver.writeRemoteTemp(remotePath, remoteContent);
                    const localUri = vscode.Uri.parse(`${scheme}://${this.connectionId}${remotePath}`);
                    await vscode.commands.executeCommand('vscode.diff', baseUri, localUri, `Merge: ${remotePath.split('/').pop()} (Remote ⇿ Local)`);
                    // Manual merge resolves to remote → update baseline
                    await this.cacheManager.writeRemoteBaseHash(this.connectionId, remotePath, remoteContent);
                }
                catch (e) {
                    vscode.window.showErrorMessage(`Failed to open diff: ${e instanceof Error ? e.message : e}`);
                }
                return;
            }
            // Download & Overwrite: fall through
            await this.cacheManager.writeCache(this.connectionId, remotePath, remoteContent);
            await this.cacheManager.writeRemoteBaseHash(this.connectionId, remotePath, remoteContent);
            this.refreshEditor(remotePath, remoteContent, scheme);
            vscode.window.showInformationMessage(`Synced: ${remotePath.split('/').pop()}`);
        }
        catch (err) {
            vscode.window.showErrorMessage(`Failed to sync: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    }
    refreshEditor(remotePath, content, scheme) {
        const targetUri = vscode.Uri.parse(`${scheme}://${this.connectionId}${remotePath}`);
        const openEditors = vscode.window.visibleTextEditors;
        for (const editor of openEditors) {
            if (editor.document.uri.toString() === targetUri.toString()) {
                const fullRange = new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(editor.document.getText().length));
                const text = new TextDecoder().decode(content);
                editor.edit((editBuilder) => { editBuilder.replace(fullRange, text); }).then(() => {
                    editor.document.save();
                });
            }
        }
    }
    /**
     * ⬆️ Upload: Sync local file to remote.
     * Checks for conflicts before uploading.
     */
    async syncToRemote(remotePath) {
        try {
            // ═══ P0-2: 检查编辑器是否有未保存的修改 ═══
            const scheme = `remote-${this.protocol}`;
            const remoteUri = vscode.Uri.parse(`${scheme}://${this.connectionId}${remotePath}`);
            const editors = vscode.window.visibleTextEditors.filter(e => e.document.uri.toString() === remoteUri.toString());
            if (editors.length > 0 && editors[0].document.isDirty) {
                const choice = await vscode.window.showWarningMessage('File has unsaved changes. Save locally before uploading?', 'Save & Upload', 'Cancel');
                if (choice === 'Save & Upload') {
                    await editors[0].document.save();
                }
                else {
                    return;
                }
            }
            // Check cache exists
            const cacheStat = await this.cacheManager.getCacheStat(this.connectionId, remotePath);
            if (!cacheStat.exists) {
                vscode.window.showErrorMessage('No local cache found. Open the file first.');
                return;
            }
            // Check for conflicts using content hash
            const conflict = await this.conflictResolver.checkConflict(this.connectionId, remotePath);
            if (conflict.hasConflict) {
                const action = await this.conflictResolver.resolveConflict(remotePath, 'upload');
                if (action === 'keep-remote') {
                    // 暂不上传
                    vscode.window.showInformationMessage('Upload cancelled.');
                    return;
                }
                if (action === 'manual-merge') {
                    try {
                        const remoteContent = await this.adapter.readFile(remotePath);
                        const baseUri = await this.conflictResolver.writeRemoteTemp(remotePath, remoteContent);
                        const localUri = vscode.Uri.parse(`${scheme}://${this.connectionId}${remotePath}`);
                        await vscode.commands.executeCommand('vscode.diff', baseUri, localUri, `Merge: ${remotePath.split('/').pop()} (Remote ⇿ Local)`);
                        // Manual merge resolves to remote baseline
                        await this.cacheManager.writeRemoteBaseHash(this.connectionId, remotePath, remoteContent);
                    }
                    catch (e) {
                        vscode.window.showErrorMessage(`Failed to open diff: ${e instanceof Error ? e.message : e}`);
                    }
                    return;
                }
                // Force Overwrite: continue to upload
            }
            // Upload to remote
            const content = await this.cacheManager.readCache(this.connectionId, remotePath);
            await this.adapter.writeFile(remotePath, content);
            // After upload, write cache and set baseline to uploaded content
            await this.cacheManager.writeCache(this.connectionId, remotePath, content);
            await this.cacheManager.writeRemoteBaseHash(this.connectionId, remotePath, content);
            const fileName = remotePath.split('/').pop();
            vscode.window.showInformationMessage(`Uploaded: ${fileName || remotePath}`);
        }
        catch (err) {
            vscode.window.showErrorMessage(`Failed to upload: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    }
}
exports.SyncCommandHandler = SyncCommandHandler;
//# sourceMappingURL=syncCommands.js.map