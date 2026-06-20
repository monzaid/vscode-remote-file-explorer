import { ConnectionConfig } from '../core/types';
/**
 * Manages connection add/edit/delete UI dialogs using VSCode InputBox and QuickPick.
 */
export declare class ConnectionDialog {
    /**
     * Show the add connection dialog with multi-step input.
     */
    showAddConnectionDialog(): Promise<ConnectionConfig | undefined>;
    /**
     * Show edit connection dialog (pre-filled with existing values).
     */
    showEditConnectionDialog(existing: ConnectionConfig): Promise<ConnectionConfig | undefined>;
    /**
     * Show delete confirmation dialog.
     */
    showDeleteConfirmation(connectionLabel: string): Promise<boolean>;
    /**
     * Show connection list QuickPick for management.
     */
    showConnectionList(connections: ConnectionConfig[]): Promise<ConnectionConfig | undefined>;
}
//# sourceMappingURL=ConnectionDialog.d.ts.map