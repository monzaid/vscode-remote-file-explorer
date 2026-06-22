import * as vscode from 'vscode';
import { IProtocolAdapter } from '../core/IProtocolAdapter';
import { ConnectionManager } from '../core/ConnectionManager';
import { RemoteFileStat } from '../core/types';
/**
 * Tree item types for the sidebar.
 */
type TreeItemType = 'connection' | 'mountedPath' | 'directory' | 'file';
/** Sort mode (field) */
export type SortField = 'name' | 'mtime' | 'size' | 'type';
/** Sort configuration including direction */
export interface SortConfig {
    field: SortField;
    asc: boolean;
}
/**
 * Custom TreeItem for Remote File Explorer.
 */
export declare class RemoteTreeItem extends vscode.TreeItem {
    type: TreeItemType;
    connectionId?: string;
    remotePath?: string;
    isReadonly?: boolean;
    children?: RemoteTreeItem[];
    constructor(label: string, type: TreeItemType, collapsibleState: vscode.TreeItemCollapsibleState, connectionId?: string, remotePath?: string, stat?: RemoteFileStat, protocol?: string);
    private configureAppearance;
    private getFileIcon;
    private formatSize;
}
/**
 * TreeDataProvider for the Remote File Explorer sidebar.
 * Displays connections, mounted paths, directories, and files in a tree structure.
 */
export declare class SidebarProvider implements vscode.TreeDataProvider<RemoteTreeItem> {
    private _onDidChangeTreeData;
    readonly onDidChangeTreeData: vscode.Event<RemoteTreeItem | undefined | void>;
    private connectionManager;
    private adapters;
    private dirCache;
    private static readonly DIR_CACHE_TTL;
    private sortConfigs;
    /** Walk up parent paths to find the nearest sort config for this directory */
    getSortConfig(connId: string, remotePath: string): SortConfig;
    constructor(connectionManager: ConnectionManager);
    /**
     * Register an adapter for a connection.
     */
    registerAdapter(connectionId: string, adapter: IProtocolAdapter): void;
    /**
     * Unregister an adapter.
     */
    unregisterAdapter(connectionId: string): void;
    /**
     * Refresh the tree view. Clears directory cache on full refresh.
     */
    refresh(element?: RemoteTreeItem): void;
    /**
     * P2 fix: Invalidate directory cache for a specific remote path.
     * Called by RemoteFSProvider after writeFile/delete/createDirectory operations
     * so the sidebar reflects up-to-date content instead of stale cached data.
     */
    invalidateCache(connectionId: string, remotePath: string): void;
    /**
     * Get the tree item for a given element.
     */
    getTreeItem(element: RemoteTreeItem): vscode.TreeItem;
    /**
     * Get the children of a given element.
     */
    getChildren(element?: RemoteTreeItem): Promise<RemoteTreeItem[]>;
    /**
     * Get the parent of a given element.
     *
     * Note: VSCode TreeView uses getParent for keyboard navigation (e.g. Alt+Left
     * to jump to parent node). Returning null means keyboard back-navigation is
     * unavailable. Full parent traversal would require maintaining a path-to-node
     * map, which is deferred to a future optimization.
     */
    getParent(element: RemoteTreeItem): vscode.ProviderResult<RemoteTreeItem>;
    /**
     * Get all connection nodes.
     * P3-4 TODO: Consider caching connection nodes to avoid rebuilding on every tree refresh.
     * Currently acceptable since connection count is typically small (< 20).
     */
    private getConnectionNodes;
    /**
     * Get mounted path nodes for a connection.
     * P3-4 TODO: Consider caching mounted path nodes per connection. Currently acceptable
     * since mount count is typically small (< 10 per connection).
     */
    private getMountedPathNodes;
    /**
     * Get directory children (files and subdirectories).
     * P2-2 fix: uses cache with 5s TTL to avoid repeated remote I/O on re-expand.
     */
    private getDirectoryChildren;
    /**
     * Build sorted RemoteTreeItem array from directory entries.
     * Sort mode is per remote path (connId:remotePath key).
     */
    private buildDirectoryItems;
    /**
     * Set sort config for a remote path and all its sub-directories (recursive).
     * If the same field is selected again, toggles direction.
     * Clears cached entries so expanded nodes rebuild with new sort order.
     */
    setSortMode(connectionId: string, remotePath: string, field: SortField): void;
}
export {};
//# sourceMappingURL=SidebarProvider.d.ts.map