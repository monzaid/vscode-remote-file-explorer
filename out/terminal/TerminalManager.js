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
const SSHAdapter_1 = require("../adapters/SSHAdapter");
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
     * Ensure an SSH terminal session is ready. Auto-connects only THIS connection
     * using terminal-only mode (no SFTP/FTP). Does NOT affect other connections.
     *
     * DESIGN DECISION: Terminal and file-browsing share the same SSH connection
     * via a single adapter keyed by connectionId. This is intentional — ssh2's
     * Client can simultaneously hold both SFTP channel and Shell channel over
     * one TCP connection. When a user browses files first (creating an SFTP
     * session) then opens a terminal, the existing connected adapter is reused
     * and createShell() opens a second channel on the same Client. Conversely,
     * if a terminal is opened first via connectTerminalOnly() (sftp=null), a
     * subsequent file-browse will fail because the adapter has no SFTP client.
     * That scenario is handled by the file-browse code path establishing its
     * own connection when needed — it does not depend on this method.
     */
    async ensureConnected(connectionId) {
        let adapter = this.connectionManager.getAdapter(connectionId);
        if (adapter?.isConnected()) {
            return adapter;
        }
        // Not connected — establish SSH session WITHOUT SFTP
        const config = await this.connectionManager.getConnection(connectionId);
        if (!config) {
            throw new Error(`Connection ${connectionId} not found`);
        }
        if (config.protocol !== 'ssh') {
            throw new Error('Terminal is only supported for SSH connections');
        }
        const sshAdapter = new SSHAdapter_1.SSHAdapter();
        await sshAdapter.connectTerminalOnly(config);
        // Register the adapter so subsequent calls find it.
        // Uses the same connectionId key — terminal and file-browsing share
        // the adapter when both are active (see DESIGN DECISION above).
        this.connectionManager.setAdapter(connectionId, sshAdapter);
        return sshAdapter;
    }
    /**
     * Create a new SSH terminal. Always creates a fresh terminal.
     * Auto-connects the selected connection if not already active.
     */
    async createTerminal(connectionId, label) {
        const adapter = await this.ensureConnected(connectionId);
        if (!adapter.createShell) {
            throw new Error('Shell is not supported for this connection type');
        }
        const conn = await this.connectionManager.getConnection(connectionId);
        const terminalLabel = label || `SSH: ${conn?.label || connectionId}`;
        const pty = new SSHPseudoterminal(adapter);
        const terminal = vscode.window.createTerminal({
            name: terminalLabel,
            pty,
        });
        // Show the terminal panel
        terminal.show();
        // Track for cleanup
        this.activeTerminals.set(connectionId, terminal);
        const closeListener = vscode.window.onDidCloseTerminal((closed) => {
            if (closed === terminal) {
                this.activeTerminals.delete(connectionId);
                this.closeListeners.delete(connectionId);
                pty.dispose();
                closeListener.dispose();
            }
        });
        this.closeListeners.set(connectionId, closeListener);
        return terminal;
    }
    /**
     * Open a terminal for a connection. If no connectionId is provided,
     * shows QuickPick to select from all available connections (not just active ones).
     */
    async openTerminal(connectionId) {
        if (connectionId) {
            await this.createTerminal(connectionId);
            return;
        }
        // Show all connections, not just active ones
        const connections = this.connectionManager.getAllConnections();
        if (connections.length === 0) {
            vscode.window.showErrorMessage('No connections configured. Add a connection first.');
            return;
        }
        if (connections.length === 1) {
            await this.createTerminal(connections[0].id);
            return;
        }
        const items = connections.map((conn) => ({
            label: conn.label,
            description: `${conn.protocol}://${conn.host}`,
            connectionId: conn.id,
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