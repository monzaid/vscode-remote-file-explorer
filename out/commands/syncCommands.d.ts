import { IProtocolAdapter } from '../core/IProtocolAdapter';
import { LocalCacheManager } from '../core/LocalCacheManager';
/**
 * Handles inline button commands: ⬇️ Update (sync from remote) and ⬆️ Upload (sync to remote).
 */
export declare class SyncCommandHandler {
    private adapter;
    private cacheManager;
    private connectionId;
    private protocol;
    constructor(connectionId: string, adapter: IProtocolAdapter, cacheManager: LocalCacheManager, protocol: string);
    /**
     * ⬇️ Download: Sync file from remote to local cache.
     */
    syncFromRemote(remotePath: string): Promise<void>;
    /**
     * ⬆️ Upload: Sync local file to remote.
     */
    syncToRemote(remotePath: string): Promise<void>;
    private refreshEditor;
}
//# sourceMappingURL=syncCommands.d.ts.map