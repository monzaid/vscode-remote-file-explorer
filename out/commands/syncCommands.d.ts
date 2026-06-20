import { IProtocolAdapter } from '../core/IProtocolAdapter';
import { LocalCacheManager } from '../core/LocalCacheManager';
import { ConflictResolver } from '../providers/ConflictResolver';
/**
 * Handles inline button commands: ⬇️ Update (sync from remote) and ⬆️ Upload (sync to remote).
 */
export declare class SyncCommandHandler {
    private adapter;
    private cacheManager;
    private conflictResolver;
    private connectionId;
    private protocol;
    constructor(connectionId: string, adapter: IProtocolAdapter, cacheManager: LocalCacheManager, conflictResolver: ConflictResolver, protocol: string);
    /**
     * ⬇️ Download: Sync file from remote to local cache.
     * Compares timestamps and only downloads if remote is newer.
     */
    syncFromRemote(remotePath: string): Promise<void>;
    /**
     * ⬆️ Upload: Sync local file to remote.
     * Checks for conflicts before uploading.
     */
    syncToRemote(remotePath: string): Promise<void>;
}
//# sourceMappingURL=syncCommands.d.ts.map