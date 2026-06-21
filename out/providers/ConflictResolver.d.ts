import * as vscode from 'vscode';
import { IProtocolAdapter } from '../core/IProtocolAdapter';
import { LocalCacheManager } from '../core/LocalCacheManager';
import { ConflictResult, ConflictAction } from '../core/types';
/**
 * Detects and resolves file conflicts between local cache and remote server.
 * Uses content hash (SHA-256) for detection — no timestamps, no clock issues.
 *   upload:   cancel-upload / force-overwrite / manual-merge
 *   download: download      / keep-local     / manual-merge
 */
export declare class ConflictResolver {
    private adapter;
    private cacheManager;
    private skipSet;
    constructor(adapter: IProtocolAdapter, cacheManager: LocalCacheManager);
    private getSkipSet;
    /**
     * Check if local cache conflicts with remote using content hash.
     * Compares remote hash vs baseline hash (.base), and also detects
     * local edits (current hash ≠ baseline) even when remote is unchanged.
     */
    checkConflict(connectionId: string, remotePath: string): Promise<ConflictResult>;
    /**
     * Present conflict resolution dialog.
     * Uses showWarningMessage for consistency with the dirty-file prompt style.
     *
     * @param remotePath  The conflicting file path
     * @param mode        'upload' or 'download' — changes the option labels
     */
    resolveConflict(remotePath: string, mode?: 'upload' | 'download'): Promise<ConflictAction>;
    /**
     * Write remote content to a temp file and return its file:// URI.
     * Used by Diff editors so VSCode reads it as a local file,
     * avoiding the RemoteFSProvider path (which would try to stat on the server).
     */
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