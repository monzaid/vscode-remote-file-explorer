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
/**
 * Detects and resolves file conflicts between local cache and remote server.
 * Provides 3 options: keep-remote, force-overwrite, manual-merge.
 */
class ConflictResolver {
    constructor(adapter) {
        // TODO(P3-5): skipSet is in-memory only and lost on restart.
        // Consider persisting to vscode.workspace.getConfiguration() or globalState
        // for a better user experience across sessions.
        this.skipSet = new Map(); // connectionId → files to skip
        this.adapter = adapter;
    }
    /**
     * Get or create the skip set for a given connection.
     */
    getSkipSet(connectionId) {
        let connSet = this.skipSet.get(connectionId);
        if (!connSet) {
            connSet = new Set();
            this.skipSet.set(connectionId, connSet);
        }
        return connSet;
    }
    /**
     * Check if a conflict exists between local cache and remote file.
     * @param connectionId The connection identifier
     * @param remotePath The remote file path
     * @param localMtime The local cache modification time
     * @returns ConflictResult indicating if there's a conflict
     */
    async checkConflict(connectionId, remotePath, localMtime) {
        // Skip if this file is in the "don't ask again" set for this connection
        if (this.getSkipSet(connectionId).has(remotePath)) {
            return { hasConflict: false };
        }
        try {
            const remoteStat = await this.adapter.stat(remotePath);
            const remoteMtime = remoteStat.mtime;
            // Compare modification times (with 1 second tolerance)
            const timeDiff = Math.abs(remoteMtime.getTime() - localMtime.getTime());
            if (timeDiff > 1000) {
                return {
                    hasConflict: true,
                    remoteMtime,
                    localMtime,
                };
            }
            return { hasConflict: false };
        }
        catch {
            // File may not exist remotely — no conflict
            return { hasConflict: false };
        }
    }
    /**
     * Present conflict resolution dialog to the user.
     * @param remotePath The file path with conflict
     * @returns The chosen conflict action
     */
    async resolveConflict(remotePath) {
        const fileName = remotePath.split('/').pop() || remotePath;
        const choice = await vscode.window.showWarningMessage(`Conflict: "${fileName}" has been modified on the remote server since you last downloaded it.`, { modal: true }, 'Keep Remote', 'Force Overwrite', 'Manual Merge');
        switch (choice) {
            case 'Keep Remote':
                return 'keep-remote';
            case 'Force Overwrite':
                return 'force-overwrite';
            case 'Manual Merge':
                return 'manual-merge';
            default:
                // User dismissed the dialog — keep remote as safe default
                return 'keep-remote';
        }
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