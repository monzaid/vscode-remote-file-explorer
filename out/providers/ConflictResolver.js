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
exports.ConflictResolver = void 0;
const vscode = __importStar(require("vscode"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
/**
 * Detects and resolves file conflicts between local cache and remote server.
 * Uses content hash (SHA-256) for detection — no timestamps, no clock issues.
 *   upload:   cancel-upload / force-overwrite / manual-merge
 *   download: download      / keep-local     / manual-merge
 */
class ConflictResolver {
    constructor(adapter, cacheManager) {
        this.skipSet = new Map();
        this.adapter = adapter;
        this.cacheManager = cacheManager;
    }
    getSkipSet(connectionId) {
        let connSet = this.skipSet.get(connectionId);
        if (!connSet) {
            connSet = new Set();
            this.skipSet.set(connectionId, connSet);
        }
        return connSet;
    }
    /**
     * Check if local cache conflicts with remote using content hash.
     * Compares remote hash vs baseline hash (.base), and also detects
     * local edits (current hash ≠ baseline) even when remote is unchanged.
     */
    async checkConflict(connectionId, remotePath) {
        if (this.getSkipSet(connectionId).has(remotePath)) {
            return { hasConflict: false };
        }
        try {
            const cacheStat = await this.cacheManager.getCacheStat(connectionId, remotePath);
            if (!cacheStat.exists) {
                return { hasConflict: false };
            }
            const remoteContent = await this.adapter.readFile(remotePath);
            const remoteHash = crypto.createHash('sha256').update(remoteContent).digest('hex');
            const baseHash = await this.cacheManager.readRemoteBaseHash(connectionId, remotePath);
            // No baseline → first sync → no conflict
            if (!baseHash) {
                return { hasConflict: false };
            }
            // Remote changed → conflict
            if (remoteHash !== baseHash) {
                return { hasConflict: true };
            }
            // Remote unchanged, but local has been edited → conflict (only for download flow)
            const localHash = await this.cacheManager.readLocalHash(connectionId, remotePath);
            if (localHash && localHash !== baseHash) {
                return { hasConflict: true };
            }
            return { hasConflict: false };
        }
        catch {
            return { hasConflict: false };
        }
    }
    /**
     * Present conflict resolution dialog.
     * Uses showWarningMessage for consistency with the dirty-file prompt style.
     *
     * @param remotePath  The conflicting file path
     * @param mode        'upload' or 'download' — changes the option labels
     */
    async resolveConflict(remotePath, mode = 'upload') {
        const fileName = remotePath.split('/').pop() || remotePath;
        const choice = mode === 'upload'
            ? await vscode.window.showWarningMessage(`Conflict: "${fileName}" has been modified on the server. Upload anyway?`, { modal: true }, '暂不上传', 'Force Overwrite', 'Manual Merge')
            : await vscode.window.showWarningMessage(`Conflict: "${fileName}" differs from the server version.`, { modal: true }, 'Download & Overwrite', 'Keep Local', 'Manual Merge');
        switch (choice) {
            case '暂不上传':
            case 'Keep Local':
                return 'keep-remote';
            case 'Force Overwrite':
            case 'Download & Overwrite':
                return 'force-overwrite';
            case 'Manual Merge':
                return 'manual-merge';
            default:
                return 'keep-remote';
        }
    }
    /**
     * Write remote content to a temp file and return its file:// URI.
     * Used by Diff editors so VSCode reads it as a local file,
     * avoiding the RemoteFSProvider path (which would try to stat on the server).
     */
    async writeRemoteTemp(remotePath, content) {
        const tmpDir = os.tmpdir();
        const safeName = remotePath.replace(/[/\\:]/g, '_') + '.remote-base';
        const tmpPath = path.join(tmpDir, `rfe-diff-${Date.now()}-${safeName}`);
        await vscode.workspace.fs.writeFile(vscode.Uri.file(tmpPath), content);
        return vscode.Uri.file(tmpPath);
    }
    /**
     * Skip conflict check for a specific file for this session.
     * @param connectionId The connection identifier
     * @param remotePath The remote file path to skip
     */
    skipForSession(connectionId, remotePath) {
        this.getSkipSet(connectionId).add(remotePath);
    }
    /**
     * Clear the skip set for a specific connection, or all connections.
     * @param connectionId Optional — if omitted, clears all skip sets.
     */
    clearSkipSet(connectionId) {
        if (connectionId) {
            this.skipSet.delete(connectionId);
        }
        else {
            this.skipSet.clear();
        }
    }
}
exports.ConflictResolver = ConflictResolver;
//# sourceMappingURL=ConflictResolver.js.map