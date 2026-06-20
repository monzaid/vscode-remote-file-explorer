import * as vscode from 'vscode';
import { ConnectionStatus } from '../core/types';
/**
 * Manages the VSCode status bar items for Remote File Explorer.
 * Shows connection status indicator and quick-action buttons.
 */
export declare class StatusBarManager implements vscode.Disposable {
    private statusBarItem;
    private syncButton;
    private uploadButton;
    private disposables;
    constructor();
    /**
     * Update the connection status display.
     * @param status Current connection status
     * @param activeCount Number of active connections
     */
    updateStatus(status: ConnectionStatus, activeCount: number): void;
    /**
     * Dispose all status bar items.
     */
    dispose(): void;
}
//# sourceMappingURL=StatusBarManager.d.ts.map