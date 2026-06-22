import * as vscode from 'vscode';
import { ConnectionManager } from '../core/ConnectionManager';
/**
 * Manages SSH terminal sessions using VSCode Pseudoterminal API.
 * Creates terminals that connect to remote servers via SSH.
 */
export declare class TerminalManager implements vscode.Disposable {
    private activeTerminals;
    private connectionManager;
    private disposables;
    private closeListeners;
    constructor(connectionManager: ConnectionManager);
    /**
     * Ensure an SSH terminal session is ready. Auto-connects only THIS connection
     * using terminal-only mode (no SFTP/FTP). Does NOT affect other connections.
     */
    private ensureConnected;
    /**
     * Create a new SSH terminal. Always creates a fresh terminal.
     * Auto-connects the selected connection if not already active.
     */
    createTerminal(connectionId: string, label?: string): Promise<vscode.Terminal>;
    /**
     * Open a terminal for a connection. If no connectionId is provided,
     * shows QuickPick to select from all available connections (not just active ones).
     */
    openTerminal(connectionId?: string): Promise<void>;
    /**
     * Dispose all terminals and clean up.
     */
    dispose(): void;
}
//# sourceMappingURL=TerminalManager.d.ts.map