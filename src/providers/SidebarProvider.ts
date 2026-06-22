import * as vscode from 'vscode';
import * as path from 'path';
import { IProtocolAdapter } from '../core/IProtocolAdapter';
import { ConnectionManager } from '../core/ConnectionManager';
import { RemoteFileEntry, RemoteFileStat, ConnectionStatus } from '../core/types';

/**
 * Tree item types for the sidebar.
 */
type TreeItemType = 'connection' | 'mountedPath' | 'directory' | 'file';

/** Sort modes for directory/file listings */
export type SortMode = 'name' | 'mtime' | 'size' | 'type';

/**
 * Custom TreeItem for Remote File Explorer.
 */
export class RemoteTreeItem extends vscode.TreeItem {
  type: TreeItemType;
  connectionId?: string;
  remotePath?: string;
  isReadonly?: boolean;
  children?: RemoteTreeItem[];

  constructor(
    label: string,
    type: TreeItemType,
    collapsibleState: vscode.TreeItemCollapsibleState,
    connectionId?: string,
    remotePath?: string,
    stat?: RemoteFileStat,
    protocol?: string,
  ) {
    super(label, collapsibleState);
    this.type = type;
    this.connectionId = connectionId;
    this.remotePath = remotePath;

    // Set context value for right-click menus
    this.contextValue = type;

    // Set icon and description based on type
    this.configureAppearance(type, stat);

    // Set command for file items (click to open)
    if (type === 'file' && connectionId && remotePath) {
      // P1-5 fix: dynamically set protocol scheme based on connection type
      const uriProtocol = protocol ? `remote-${protocol}` : 'remote-ssh';
      this.command = {
        command: 'vscode.open',
        title: 'Open File',
        arguments: [vscode.Uri.parse(`${uriProtocol}://${connectionId}${remotePath}`)],
      };
    }
  }

  private configureAppearance(type: TreeItemType, stat?: RemoteFileStat): void {
    switch (type) {
      case 'connection':
        this.iconPath = new vscode.ThemeIcon('plug');
        this.description = 'disconnected';
        break;

      case 'mountedPath':
        this.iconPath = new vscode.ThemeIcon('folder-library');
        break;

      case 'directory':
        this.iconPath = new vscode.ThemeIcon('folder');
        if (stat) {
          const isReadonly = !stat.permissions.includes('w');
          this.isReadonly = isReadonly;
          this.description = isReadonly ? '🔒' : undefined;
        }
        break;

      case 'file':
        // Choose icon based on file extension
        if (stat) {
          const ext = path.extname(this.label?.toString() || '').toLowerCase();
          this.iconPath = this.getFileIcon(ext);
          const isReadonly = !stat.permissions.includes('w');
          this.isReadonly = isReadonly;
          const sizeStr = this.formatSize(stat.size);
          this.description = `${isReadonly ? '🔒 ' : ''}${sizeStr}`.trim();
          this.tooltip = `${this.label}\nSize: ${sizeStr}\nModified: ${stat.mtime.toLocaleString()}\nPermissions: ${stat.permissions}`;
        } else {
          this.iconPath = new vscode.ThemeIcon('file');
        }
        break;
    }
  }

  private getFileIcon(ext: string): vscode.ThemeIcon {
    const iconMap: Record<string, string> = {
      '.ts': 'symbol-class',
      '.tsx': 'symbol-class',
      '.js': 'symbol-method',
      '.jsx': 'symbol-method',
      '.json': 'symbol-property',
      '.md': 'markdown',
      '.css': 'symbol-color',
      '.html': 'symbol-structure',
      '.py': 'symbol-method',
      '.go': 'symbol-method',
      '.rs': 'symbol-method',
      '.yaml': 'symbol-property',
      '.yml': 'symbol-property',
      '.xml': 'symbol-structure',
      '.sh': 'terminal',
      '.bash': 'terminal',
      '.txt': 'symbol-string',
      '.log': 'output',
      '.gitignore': 'gear',
      '.env': 'lock',
    };
    const iconName = iconMap[ext] || 'file';
    return new vscode.ThemeIcon(iconName);
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1073741824).toFixed(1)} GB`;
  }
}

/**
 * TreeDataProvider for the Remote File Explorer sidebar.
 * Displays connections, mounted paths, directories, and files in a tree structure.
 */
export class SidebarProvider implements vscode.TreeDataProvider<RemoteTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<RemoteTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<RemoteTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  private connectionManager: ConnectionManager;
  private adapters: Map<string, IProtocolAdapter> = new Map();

  // P2-2 fix: directory cache to avoid repeated remote I/O on re-expand
  private dirCache: Map<string, { entries: RemoteFileEntry[]; timestamp: number }> = new Map();
  private static readonly DIR_CACHE_TTL = 5000; // 5 seconds

  // Sort modes per remote path (connectionId:remotePath → SortMode)
  private sortModes: Map<string, SortMode> = new Map();

  /** Walk up parent paths to find the nearest sort mode for this directory */
  private getSortMode(connId: string, remotePath: string): SortMode {
    let current = remotePath;
    while (current) {
      const key = `${connId}:${current}`;
      const mode = this.sortModes.get(key);
      if (mode) return mode;
      if (current === '/') break;
      const parent = current.substring(0, current.lastIndexOf('/')) || '/';
      if (parent === current) break;
      current = parent;
    }
    return 'name';
  }

  constructor(connectionManager: ConnectionManager) {
    this.connectionManager = connectionManager;

    // Listen for connection status changes
    this.connectionManager.onConnectionStatusChange.on('statusChange', () => {
      this.refresh();
    });
  }

  /**
   * Register an adapter for a connection.
   */
  registerAdapter(connectionId: string, adapter: IProtocolAdapter): void {
    this.adapters.set(connectionId, adapter);
  }

  /**
   * Unregister an adapter.
   */
  unregisterAdapter(connectionId: string): void {
    this.adapters.delete(connectionId);
  }

  /**
   * Refresh the tree view. Clears directory cache on full refresh.
   */
  refresh(element?: RemoteTreeItem): void {
    if (!element) {
      // Full refresh: clear directory cache
      this.dirCache.clear();
    } else if (element.connectionId && element.remotePath) {
      // Targeted refresh: clear cache for the specific path
      const cacheKey = `${element.connectionId}:${element.remotePath}`;
      this.dirCache.delete(cacheKey);
    }
    this._onDidChangeTreeData.fire(element);
  }

  /**
   * Get the tree item for a given element.
   */
  getTreeItem(element: RemoteTreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * Get the children of a given element.
   */
  async getChildren(element?: RemoteTreeItem): Promise<RemoteTreeItem[]> {
    if (!element) {
      // Root level: show all connections
      return this.getConnectionNodes();
    }

    switch (element.type) {
      case 'connection':
        return this.getMountedPathNodes(element);
      case 'mountedPath':
      case 'directory':
        return this.getDirectoryChildren(element);
      case 'file':
        return []; // Files have no children
      default:
        return [];
    }
  }

  /**
   * Get the parent of a given element.
   */
  getParent(element: RemoteTreeItem): vscode.ProviderResult<RemoteTreeItem> {
    // TreeView manages this via the tree structure
    return null;
  }

  /**
   * Get all connection nodes.
   * P3-4 TODO: Consider caching connection nodes to avoid rebuilding on every tree refresh.
   * Currently acceptable since connection count is typically small (< 20).
   */
  private getConnectionNodes(): RemoteTreeItem[] {
    const connections = this.connectionManager.getAllConnections();

    return connections.map((conn) => {
      const status = this.connectionManager.getStatus(conn.id);
      const item = new RemoteTreeItem(
        conn.label,
        'connection',
        vscode.TreeItemCollapsibleState.Collapsed,
        conn.id,
        undefined,
        undefined,
        conn.protocol,
      );

      // Update status display
      switch (status) {
        case 'connected':
          item.description = '🟢 connected';
          item.iconPath = new vscode.ThemeIcon('vm-connect');
          break;
        case 'connecting':
          item.description = '🟡 connecting...';
          item.iconPath = new vscode.ThemeIcon('sync~spin');
          break;
        case 'error':
          item.description = '🔴 error';
          item.iconPath = new vscode.ThemeIcon('error');
          break;
        default:
          item.description = '⚫ disconnected';
          item.iconPath = new vscode.ThemeIcon('debug-disconnect');
          break;
      }

      item.contextValue = 'connection';
      return item;
    });
  }

  /**
   * Get mounted path nodes for a connection.
   * P3-4 TODO: Consider caching mounted path nodes per connection. Currently acceptable
   * since mount count is typically small (< 10 per connection).
   */
  private getMountedPathNodes(connectionNode: RemoteTreeItem): RemoteTreeItem[] {
    const connId = connectionNode.connectionId;
    if (!connId) return [];

    const conn = this.connectionManager.getAllConnections().find((c) => c.id === connId);
    if (!conn) return [];

    return conn.mountedPaths.map(
      (mp) =>
        new RemoteTreeItem(
          mp.label || mp.remotePath,
          'mountedPath',
          vscode.TreeItemCollapsibleState.Collapsed,
          connId,
          mp.remotePath,
          undefined,
          conn.protocol,
        ),
    );
  }

  /**
   * Get directory children (files and subdirectories).
   * P2-2 fix: uses cache with 5s TTL to avoid repeated remote I/O on re-expand.
   */
  private async getDirectoryChildren(element: RemoteTreeItem): Promise<RemoteTreeItem[]> {
    const connId = element.connectionId;
    const remotePath = element.remotePath;
    if (!connId || !remotePath) return [];

    const adapter = this.adapters.get(connId);
    if (!adapter || !adapter.isConnected()) {
      return [
        new RemoteTreeItem(
          'Not connected',
          'file',
          vscode.TreeItemCollapsibleState.None,
        ),
      ];
    }

    // Resolve protocol for URI scheme
    const conn = this.connectionManager.getAllConnections().find((c) => c.id === connId);
    const protocol = conn?.protocol;

    // P2-2: check directory cache
    const cacheKey = `${connId}:${remotePath}`;
    const cached = this.dirCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < SidebarProvider.DIR_CACHE_TTL) {
      return this.buildDirectoryItems(cached.entries, connId, remotePath, protocol);
    }

    try {
      const entries = await adapter.readDirectory(remotePath);

      // P2-2: update cache
      this.dirCache.set(cacheKey, { entries, timestamp: Date.now() });

      return this.buildDirectoryItems(entries, connId, remotePath, protocol);
    } catch (err) {
      return [
        new RemoteTreeItem(
          `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
          'file',
          vscode.TreeItemCollapsibleState.None,
        ),
      ];
    }
  }

  /**
   * Build sorted RemoteTreeItem array from directory entries.
   * Sort mode is per remote path (connId:remotePath key).
   */
  private buildDirectoryItems(
    entries: RemoteFileEntry[],
    connId: string,
    remotePath?: string,
    protocol?: string,
  ): RemoteTreeItem[] {
    const mode = this.getSortMode(connId, remotePath || '/');

    const sorted = [...entries].sort((a, b) => {
      // Directories always first
      const aIsDir = a.stat.type === 'directory';
      const bIsDir = b.stat.type === 'directory';
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;

      // Apply selected sort mode (only within same type group)
      switch (mode) {
        case 'mtime':
          return b.stat.mtime.getTime() - a.stat.mtime.getTime();
        case 'size':
          return a.stat.size - b.stat.size;
        case 'type':
          const extA = path.extname(a.name).toLowerCase();
          const extB = path.extname(b.name).toLowerCase();
          return extA.localeCompare(extB) || a.name.localeCompare(b.name);
        case 'name':
        default:
          return a.name.localeCompare(b.name);
      }
    });

    return sorted.map((entry) => {
      const isDir = entry.stat.type === 'directory';
      return new RemoteTreeItem(
        entry.name,
        isDir ? 'directory' : 'file',
        isDir ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
        connId,
        entry.path,
        entry.stat,
        protocol,
      );
    });
  }

  /**
   * Set sort mode for a remote path and all its sub-directories (recursive).
   * Clears cached entries so expanded nodes rebuild with new sort order.
   */
  setSortMode(connectionId: string, remotePath: string, mode: SortMode): void {
    const prefix = `${connectionId}:${remotePath}`;
    this.sortModes.set(prefix, mode);
    // Clear cache for this path and all sub-paths
    for (const key of this.dirCache.keys()) {
      if (key === prefix || key.startsWith(prefix + '/')) {
        this.dirCache.delete(key);
      }
    }
    this._onDidChangeTreeData.fire();
  }
}
