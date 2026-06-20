import * as vscode from 'vscode';
import { IProtocolAdapter } from '../core/IProtocolAdapter';
import { ConnectionManager } from '../core/ConnectionManager';
import { RemoteFileStat } from '../core/types';
/**
 * Tree item types for the sidebar.
 */
type TreeItemType = 'connection' | 'mountedPath' | 'directory' | 'file';
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
     * Get the tree item for a given element.
     */
    getTreeItem(element: RemoteTreeItem): vscode.TreeItem;
    /**
     * Get the children of a given element.
     */
    getChildren(element?: RemoteTreeItem): Promise<RemoteTreeItem[]>;
    /**
     * Get the parent of a given element.
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
     */
    private buildDirectoryItems;
}
export {};
//# sourceMappingURL=SidebarProvider.d.ts.map