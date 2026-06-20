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
exports.StatusBarManager = void 0;
const vscode = __importStar(require("vscode"));
/**
 * Manages the VSCode status bar items for Remote File Explorer.
 * Shows connection status indicator and quick-action buttons.
 */
class StatusBarManager {
    constructor() {
        this.disposables = [];
        // Connection status indicator (left side)
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.statusBarItem.name = 'Remote FS Connection Status';
        this.statusBarItem.command = 'remote-fs.manageConnections';
        this.statusBarItem.tooltip = 'Remote File Explorer — Manage Connections';
        this.updateStatus('idle', 0);
        this.statusBarItem.show();
        // Sync button (right side)
        this.syncButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
        this.syncButton.name = 'Remote FS Sync';
        this.syncButton.text = '$(cloud-download) Sync';
        this.syncButton.command = 'remote-fs.syncCurrentFile';
        this.syncButton.tooltip = 'Sync Current File from Remote (download latest)';
        this.syncButton.show();
        // Upload button (right side)
        this.uploadButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.uploadButton.name = 'Remote FS Upload';
        this.uploadButton.text = '$(cloud-upload) Upload';
        this.uploadButton.command = 'remote-fs.uploadCurrentFile';
        this.uploadButton.tooltip = 'Upload Current File to Remote';
        this.uploadButton.show();
        this.disposables.push(this.statusBarItem, this.syncButton, this.uploadButton);
    }
    /**
     * Update the connection status display.
     * @param status Current connection status
     * @param activeCount Number of active connections
     */
    updateStatus(status, activeCount) {
        let icon;
        let label;
        switch (status) {
            case 'connected':
                icon = '$(circle-filled)';
                label = `Remote FS: ${activeCount} connected`;
                this.statusBarItem.backgroundColor = undefined;
                break;
            case 'connecting':
                icon = '$(sync~spin)';
                label = `Remote FS: Connecting...`;
                this.statusBarItem.backgroundColor = undefined;
                break;
            case 'error':
                icon = '$(error)';
                label = `Remote FS: Error`;
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                break;
            case 'disconnected':
            case 'idle':
            default:
                icon = '$(circle-slash)';
                label = `Remote FS: ${activeCount > 0 ? activeCount + ' connected' : 'Disconnected'}`;
                this.statusBarItem.backgroundColor = undefined;
                break;
        }
        this.statusBarItem.text = `${icon} ${label}`;
    }
    /**
     * Dispose all status bar items.
     */
    dispose() {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
    }
}
exports.StatusBarManager = StatusBarManager;
//# sourceMappingURL=StatusBarManager.js.map