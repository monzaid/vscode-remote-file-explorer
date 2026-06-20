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
     * Create an SSH terminal for a connection.
     * @param connectionId The connection to open a terminal for
     * @param label Optional label for the terminal
     */
    createTerminal(connectionId: string, label?: string): Promise<vscode.Terminal>;
    /**
     * Open a terminal for a connection. If only one connection exists, opens directly.
     * If multiple, shows a QuickPick to select.
     */
    openTerminal(connectionId?: string): Promise<void>;
    /**
     * Dispose all terminals and clean up.
     */
    dispose(): void;
}
//# sourceMappingURL=TerminalManager.d.ts.map