import { IProtocolAdapter } from '../core/IProtocolAdapter';
import { ConflictResult, ConflictAction } from '../core/types';
/**
 * Detects and resolves file conflicts between local cache and remote server.
 * Provides 3 options: keep-remote, force-overwrite, manual-merge.
 */
export declare class ConflictResolver {
    private adapter;
    private skipSet;
    constructor(adapter: IProtocolAdapter);
    /**
     * Get or create the skip set for a given connection.
     */
    private getSkipSet;
    /**
     * Check if a conflict exists between local cache and remote file.
     * @param connectionId The connection identifier
     * @param remotePath The remote file path
     * @param localMtime The local cache modification time
     * @returns ConflictResult indicating if there's a conflict
     */
    checkConflict(connectionId: string, remotePath: string, localMtime: Date): Promise<ConflictResult>;
    /**
     * Present conflict resolution dialog to the user.
     * @param remotePath The file path with conflict
     * @returns The chosen conflict action
     */
    resolveConflict(remotePath: string): Promise<ConflictAction>;
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