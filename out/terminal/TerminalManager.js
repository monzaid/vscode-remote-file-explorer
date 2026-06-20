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
exports.TerminalManager = void 0;
const vscode = __importStar(require("vscode"));
/**
 * Manages SSH terminal sessions using VSCode Pseudoterminal API.
 * Creates terminals that connect to remote servers via SSH.
 */
class TerminalManager {
    constructor(connectionManager) {
        this.activeTerminals = new Map();
        this.disposables = [];
        this.closeListeners = new Map();
        this.connectionManager = connectionManager;
    }
    /**
     * Create an SSH terminal for a connection.
     * @param connectionId The connection to open a terminal for
     * @param label Optional label for the terminal
     */
    async createTerminal(connectionId, label) {
        const adapter = this.connectionManager.getAdapter(connectionId);
        if (!adapter) {
            throw new Error(`Connection ${connectionId} is not active`);
        }
        if (!adapter.createShell) {
            throw new Error('Shell is not supported for this connection type');
        }
        const conn = await this.connectionManager.getConnection(connectionId);
        const terminalLabel = label || `SSH: ${conn?.label || connectionId}`;
        // Close existing terminal for this connection if any
        // P2-8 fix: clean up old listener before disposing old terminal
        const existing = this.activeTerminals.get(connectionId);
        if (existing) {
            const oldListener = this.closeListeners.get(connectionId);
            if (oldListener) {
                oldListener.dispose();
                this.closeListeners.delete(connectionId);
            }
            existing.dispose();
        }
        // Create Pseudoterminal
        const pty = new SSHPseudoterminal(adapter);
        const terminal = vscode.window.createTerminal({
            name: terminalLabel,
            pty,
        });
        this.activeTerminals.set(connectionId, terminal);
        // P1-2 fix: self-cleaning listener — disposes itself after matching terminal closes
        const closeListener = vscode.window.onDidCloseTerminal((closed) => {
            if (closed === terminal) {
                this.activeTerminals.delete(connectionId);
                this.closeListeners.delete(connectionId);
                pty.dispose();
                closeListener.dispose(); // self-cleanup
            }
        });
        this.closeListeners.set(connectionId, closeListener);
        return terminal;
    }
    /**
     * Open a terminal for a connection. If only one connection exists, opens directly.
     * If multiple, shows a QuickPick to select.
     */
    async openTerminal(connectionId) {
        if (connectionId) {
            await this.createTerminal(connectionId);
            return;
        }
        const activeIds = this.connectionManager.getActiveConnectionIds();
        if (activeIds.length === 0) {
            vscode.window.showErrorMessage('No active connections. Connect to a server first.');
            return;
        }
        if (activeIds.length === 1) {
            await this.createTerminal(activeIds[0]);
            return;
        }
        // Multiple connections — show QuickPick
        const items = await Promise.all(activeIds.map(async (id) => {
            const conn = await this.connectionManager.getConnection(id);
            return {
                label: conn?.label || id,
                description: conn ? `${conn.protocol}://${conn.host}` : '',
                connectionId: id,
            };
        }));
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select connection to open terminal',
        });
        if (selected) {
            await this.createTerminal(selected.connectionId);
        }
    }
    /**
     * Dispose all terminals and clean up.
     */
    dispose() {
        // Clean up close listeners first to avoid triggering on terminal dispose
        for (const listener of this.closeListeners.values()) {
            listener.dispose();
        }
        this.closeListeners.clear();
        for (const terminal of this.activeTerminals.values()) {
            terminal.dispose();
        }
        this.activeTerminals.clear();
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
    }
}
exports.TerminalManager = TerminalManager;
/**
 * VSCode Pseudoterminal implementation for SSH shell.
 * Bridges the ssh2 shell stream to the VSCode terminal UI.
 */
class SSHPseudoterminal {
    constructor(adapter) {
        this.shellSession = null;
        this.writeEmitter = new vscode.EventEmitter();
        this.closeEmitter = new vscode.EventEmitter();
        this.onDidWrite = this.writeEmitter.event;
        this.onDidClose = this.closeEmitter.event;
        this.adapter = adapter;
    }
    /**
     * Open the pseudoterminal — called when the terminal is created.
     */
    async open(initialDimensions) {
        try {
            if (!this.adapter.createShell) {
                this.writeEmitter.fire('Error: Shell not supported for this connection.\r\n');
                this.closeEmitter.fire(1);
                return;
            }
            this.shellSession = await this.adapter.createShell();
            // Forward remote data to terminal
            this.shellSession.onData((data) => {
                this.writeEmitter.fire(data);
            });
            // Set initial dimensions
            if (initialDimensions && this.shellSession.resize) {
                this.shellSession.resize(initialDimensions.columns, initialDimensions.rows);
            }
            this.writeEmitter.fire('Connected to remote shell.\r\n\r\n');
        }
        catch (err) {
            this.writeEmitter.fire(`Error: ${err instanceof Error ? err.message : 'Failed to create shell'}\r\n`);
            this.closeEmitter.fire(1);
        }
    }
    /**
     * Close the pseudoterminal.
     */
    close() {
        if (this.shellSession) {
            this.shellSession.dispose();
            this.shellSession = null;
        }
    }
    /**
     * Handle user input from the terminal.
     */
    handleInput(data) {
        if (this.shellSession) {
            this.shellSession.write(data);
        }
    }
    /**
     * Handle terminal resize.
     */
    setDimensions(dimensions) {
        if (this.shellSession && this.shellSession.resize) {
            this.shellSession.resize(dimensions.columns, dimensions.rows);
        }
    }
    /**
     * Clean up resources.
     */
    dispose() {
        this.close();
        this.writeEmitter.dispose();
        this.closeEmitter.dispose();
    }
}
//# sourceMappingURL=TerminalManager.js.map