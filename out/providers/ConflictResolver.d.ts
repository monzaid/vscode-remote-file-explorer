import * as vscode from 'vscode';
import { IProtocolAdapter } from '../core/IProtocolAdapter';
import { ConflictResult, ConflictAction } from '../core/types';
/**
 * Detects and resolves file conflicts between local cache and remote server.
 *
 * Conflict dialog uses showWarningMessage (modal) for its three options.
 * Manual-merge opens a vscode.diff editor with orientation matching the mode:
 *
 *   upload:   Left = Remote (base),  Right = Local (changes to upload)
 *   download: Left = Local  (base),  Right = Remote (changes to download)
 *
 * After the diff editor closes, a follow-up prompt lets the user accept
 * the relevant side or cancel.
 */
export declare class ConflictResolver {
    private adapter;
    private skipSet;
    constructor(adapter: IProtocolAdapter);
    private getSkipSet;
    checkConflict(connectionId: string, remotePath: string, localMtime: Date): Promise<ConflictResult>;
    /**
     * Show conflict resolution dialog with three buttons.
     * Mode controls the button labels:
     *   upload:   Cancel Upload | Force Overwrite | Manual Merge
     *   download: Keep Local   | Download & Overwrite | Manual Merge
     */
    resolveConflict(remotePath: string, mode?: 'upload' | 'download'): Promise<ConflictAction>;
    /**
     * Open a diff editor with correct left/right orientation and a follow-up
     * acceptance prompt. Returns the user's final decision.
     *
     * @param mode        'upload' or 'download' — controls L/R ordering and labels
     * @param remotePath  The server-side file path (used for labels)
     * @param remoteContent  The server-side file content
     * @param localUri    URI for the local cache file (remote-* scheme)
     * @param adapter     Optional — if provided, 'accept' will push the result
     * @returns 'accepted' | 'cancelled'
     */
    openMergeDiff(mode: 'upload' | 'download', remotePath: string, remoteContent: Uint8Array, localUri: vscode.Uri, adapter?: {
        writeFile: (p: string, c: Uint8Array) => Promise<void>;
    }): Promise<'accepted' | 'cancelled'>;
    /** Write content to a temp file and return its file:// URI (for diff right side). */
    writeRemoteTemp(remotePath: string, content: Uint8Array): Promise<vscode.Uri>;
    /**
     * Skip conflict check for a specific file for this session.
     * @param connectionId The connection identifier
     * @param remotePath The remote file path to skip
     */
    skipForSession(connectionId: string, remotePath: string): void;
    /**
     * Clear the skip set for a specific connection, or all connections.
     * @param connectionId Optional — if omitted, clears all skip sets.
     */
    clearSkipSet(connectionId?: string): void;
}
//# sourceMappingURL=ConflictResolver.d.ts.map