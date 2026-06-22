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