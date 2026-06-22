import * as vscode from 'vscode';
import { ConnectionManager } from '../core/ConnectionManager';
import { LocalCacheManager } from '../core/LocalCacheManager';
import { SearchEngine } from '../search/SearchEngine';
import { SidebarProvider } from '../providers/SidebarProvider';
import { SyncCommandHandler } from './syncCommands';

/**
 * Dependencies injected by extension.ts after initialization.
 * All fields are optional — commands check availability before use.
 */
export interface CommandDeps {
  connectionManager?: ConnectionManager;
  sidebarProvider?: SidebarProvider;
  cacheManager?: LocalCacheManager;
  searchEngine?: SearchEngine;
  /** Map of connectionId → SyncCommandHandler */
  syncHandlers?: Map<string, SyncCommandHandler>;
}

let deps: CommandDeps = {};

/** Called by extension.ts to inject dependencies */
export function setCommandDeps(d: CommandDeps): void {
  deps = d;
}

// ─── Utility ──────────────────────────────────────────────────────

/** Extract connectionId and remotePath from a TreeView node argument */
function parseNode(node?: { connectionId?: string; remotePath?: string }): { connectionId: string; remotePath: string } | null {
  if (!node?.connectionId) return null;
  return { connectionId: node.connectionId, remotePath: node.remotePath || '/' };
}

/** Get the adapter for a connection, showing an error if not connected */
function getAdapter(connectionId: string) {
  const adapter = deps.connectionManager?.getAdapter(connectionId);
  if (!adapter) {
    vscode.window.showErrorMessage('Connection is not active. Connect first.');
    return undefined;
  }
  return adapter;
}

/** Resolve the active editor's connectionId and remotePath from its URI */
function resolveActiveEditor(): { connectionId: string; remotePath: string } | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage('No active editor.');
    return null;
  }

  const uri = editor.document.uri;
  // URI format: remote-{protocol}://{connectionId}{path}
  if (!uri.scheme.startsWith('remote-')) {
    vscode.window.showInformationMessage('Active file is not a remote file.');
    return null;
  }

  return {
    connectionId: uri.authority,
    remotePath: uri.path,
  };
}

// ─── Command Registration ─────────────────────────────────────────

export function registerAllCommands(_context: vscode.ExtensionContext): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  // ==================================================================
  // connect
  // ==================================================================
  disposables.push(
    vscode.commands.registerCommand('remote-fs.connect', async (node?: { connectionId?: string }) => {
      const parsed = parseNode(node);
      if (!parsed) {
        // No node — list all connections
        const conns = deps.connectionManager?.getAllConnections();
        if (!conns || conns.length === 0) {
          vscode.window.showErrorMessage('No connections configured.');
          return;
        }
        const items = conns.map((c) => ({ label: c.label, description: `${c.protocol}://${c.host}`, connectionId: c.id }));
        const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select connection to connect' });
        if (!picked) return;
        try {
          await deps.connectionManager!.connect(picked.connectionId);
          vscode.window.showInformationMessage(`Connected to ${picked.label}`);
        } catch (err) {
          vscode.window.showErrorMessage(`Connect failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
        return;
      }

      // Only connect if not already connected
      const status = deps.connectionManager?.getStatus(parsed.connectionId);
      if (status === 'connected') {
        vscode.window.showInformationMessage('Already connected.');
        return;
      }
      try {
        await deps.connectionManager!.connect(parsed.connectionId);
        vscode.window.showInformationMessage('Connected.');
        deps.sidebarProvider?.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(`Connect failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }),
  );

  // ==================================================================
  // disconnect
  // ==================================================================
  disposables.push(
    vscode.commands.registerCommand('remote-fs.disconnect', async (node?: { connectionId?: string }) => {
      const parsed = parseNode(node);
      if (!parsed) return;
      try {
        await deps.connectionManager?.disconnect(parsed.connectionId);
        vscode.window.showInformationMessage('Disconnected.');
        deps.sidebarProvider?.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(`Disconnect failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }),
  );

  // ==================================================================
  // search
  // ==================================================================
  disposables.push(
    vscode.commands.registerCommand('remote-fs.search', async () => {
      if (!deps.searchEngine) {
        vscode.window.showErrorMessage('Search engine not initialized.');
        return;
      }

      // Pick a connected adapter
      const activeIds = deps.connectionManager?.getActiveConnectionIds() || [];
      if (activeIds.length === 0) {
        vscode.window.showErrorMessage('No active connections. Connect to a server first.');
        return;
      }

      let connectionId: string;
      if (activeIds.length === 1) {
        connectionId = activeIds[0];
      } else {
        const items = await Promise.all(
          activeIds.map(async (id) => {
            const conn = await deps.connectionManager!.getConnection(id);
            return { label: conn?.label || id, connectionId: id };
          }),
        );
        const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select connection to search' });
        if (!picked) return;
        connectionId = picked.connectionId;
      }

      const adapter = getAdapter(connectionId);
      if (!adapter) return;

      // Input: search pattern
      const pattern = await vscode.window.showInputBox({
        prompt: 'Enter search pattern',
        placeHolder: 'Search text or regex...',
        validateInput: (v) => (!v ? 'Pattern is required' : undefined),
      });
      if (!pattern) return;

      // Input: root path
      const conn = await deps.connectionManager!.getConnection(connectionId);
      const defaultRoot = conn?.mountedPaths?.[0]?.remotePath || '/';
      const rootPath = await vscode.window.showInputBox({
        prompt: 'Search root path',
        value: defaultRoot,
      });
      if (!rootPath) return;

      // Execute search with progress
      let results;
      try {
        results = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Searching...', cancellable: true },
          async (_progress, token) => {
            const promise = deps.searchEngine!.search(adapter, rootPath, pattern);
            token.onCancellationRequested(() => {
              // Best-effort cancellation — the SSH command will still run but results are ignored
            });
            return promise;
          },
        );
      } catch (err) {
        vscode.window.showErrorMessage(`Search failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
        return;
      }

      if (!results || results.length === 0) {
        vscode.window.showInformationMessage('No results found.');
        return;
      }

      // Show results in QuickPick
      const truncated = results.slice(0, 200);
      const resultItems = truncated.map((r) => ({
        label: `${r.filePath}:${r.lineNumber}`,
        description: r.lineContent.substring(0, 120),
        detail: r.lineContent,
        filePath: r.filePath,
        lineNumber: r.lineNumber,
      }));

      const selected = await vscode.window.showQuickPick(resultItems, {
        placeHolder: `${results.length} result(s)${results.length > 200 ? ' (showing first 200)' : ''}`,
        matchOnDescription: true,
        matchOnDetail: true,
      });
      if (!selected) return;

      // Open the selected file at the matched line
      const protocol = conn?.protocol || 'ssh';
      const fileUri = vscode.Uri.parse(`remote-${protocol}://${connectionId}${selected.filePath}`);
      const doc = await vscode.workspace.openTextDocument(fileUri);
      const editor = await vscode.window.showTextDocument(doc);
      // Move cursor to the matched line
      const line = Math.max(0, selected.lineNumber - 1);
      const pos = new vscode.Position(line, 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }),
  );

  // ==================================================================
  // syncCurrentFile — ⬇️ download latest from remote
  // ==================================================================
  disposables.push(
    vscode.commands.registerCommand('remote-fs.syncCurrentFile', async (node?: { connectionId?: string; remotePath?: string }) => {
      // Priority: TreeView node → active editor
      let connectionId: string;
      let remotePath: string;

      if (node?.connectionId && node?.remotePath) {
        connectionId = node.connectionId;
        remotePath = node.remotePath;
      } else {
        const resolved = resolveActiveEditor();
        if (!resolved) return;
        connectionId = resolved.connectionId;
        remotePath = resolved.remotePath;
      }

      const handler = deps.syncHandlers?.get(connectionId);
      if (!handler) {
        vscode.window.showErrorMessage('Sync not available for this connection.');
        return;
      }

      await handler.syncFromRemote(remotePath);
    }),
  );

  // ==================================================================
  // uploadCurrentFile — ⬆️ upload to remote
  // ==================================================================
  disposables.push(
    vscode.commands.registerCommand('remote-fs.uploadCurrentFile', async (node?: { connectionId?: string; remotePath?: string }) => {
      let connectionId: string;
      let remotePath: string;

      if (node?.connectionId && node?.remotePath) {
        connectionId = node.connectionId;
        remotePath = node.remotePath;
      } else {
        const resolved = resolveActiveEditor();
        if (!resolved) return;
        connectionId = resolved.connectionId;
        remotePath = resolved.remotePath;
      }

      const handler = deps.syncHandlers?.get(connectionId);
      if (!handler) {
        vscode.window.showErrorMessage('Upload not available for this connection.');
        return;
      }

      await handler.syncToRemote(remotePath);
    }),
  );

  // ==================================================================
  // newFile
  // ==================================================================
  disposables.push(
    vscode.commands.registerCommand('remote-fs.newFile', async (node?: { connectionId?: string; remotePath?: string }) => {
      const parsed = parseNode(node);
      if (!parsed) return;

      const adapter = getAdapter(parsed.connectionId);
      if (!adapter) return;

      const name = await vscode.window.showInputBox({
        prompt: 'Enter new file name',
        placeHolder: 'untitled.txt',
        validateInput: (v) => (!v ? 'File name is required' : v.includes('/') ? 'Directory separators not allowed' : undefined),
      });
      if (!name) return;

      const filePath = parsed.remotePath + (parsed.remotePath.endsWith('/') ? '' : '/') + name;

      try {
        // Create empty file
        await adapter.writeFile(filePath, new Uint8Array());
        vscode.window.showInformationMessage(`Created: ${name}`);
        deps.sidebarProvider?.refresh();

        // Open the new file for editing
        const conn = await deps.connectionManager?.getConnection(parsed.connectionId);
        const protocol = conn?.protocol || 'ssh';
        const fileUri = vscode.Uri.parse(`remote-${protocol}://${parsed.connectionId}${filePath}`);
        const doc = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(doc);
      } catch (err) {
        vscode.window.showErrorMessage(`Create file failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }),
  );

  // ==================================================================
  // newFolder
  // ==================================================================
  disposables.push(
    vscode.commands.registerCommand('remote-fs.newFolder', async (node?: { connectionId?: string; remotePath?: string }) => {
      const parsed = parseNode(node);
      if (!parsed) return;

      const adapter = getAdapter(parsed.connectionId);
      if (!adapter) return;

      const name = await vscode.window.showInputBox({
        prompt: 'Enter new folder name',
        placeHolder: 'new-folder',
        validateInput: (v) => (!v ? 'Folder name is required' : v.includes('/') ? 'Directory separators not allowed' : undefined),
      });
      if (!name) return;

      const dirPath = parsed.remotePath + (parsed.remotePath.endsWith('/') ? '' : '/') + name;

      try {
        await adapter.createDirectory(dirPath);
        vscode.window.showInformationMessage(`Folder created: ${name}`);
        deps.sidebarProvider?.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(`Create folder failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }),
  );

  // ==================================================================
  // deleteFile
  // ==================================================================
  disposables.push(
    vscode.commands.registerCommand('remote-fs.deleteFile', async (node?: { connectionId?: string; remotePath?: string; type?: string }) => {
      const parsed = parseNode(node);
      if (!parsed) return;

      const adapter = getAdapter(parsed.connectionId);
      if (!adapter) return;

      const isDir = node?.type === 'directory' || node?.type === 'mountedPath';
      const name = parsed.remotePath.split('/').pop() || parsed.remotePath;
      const itemType = isDir ? 'folder' : 'file';

      const confirm = await vscode.window.showWarningMessage(
        `Delete ${itemType} "${name}"?`,
        { modal: true },
        'Delete',
        'Cancel',
      );
      if (confirm !== 'Delete') return;

      try {
        await adapter.delete(parsed.remotePath, isDir);
        vscode.window.showInformationMessage(`Deleted: ${name}`);
        deps.sidebarProvider?.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(`Delete failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }),
  );

  // ==================================================================
  // renameFile
  // ==================================================================
  disposables.push(
    vscode.commands.registerCommand('remote-fs.renameFile', async (node?: { connectionId?: string; remotePath?: string }) => {
      const parsed = parseNode(node);
      if (!parsed) return;

      const adapter = getAdapter(parsed.connectionId);
      if (!adapter) return;

      const oldName = parsed.remotePath.split('/').pop() || parsed.remotePath;
      const parentDir = parsed.remotePath.substring(0, parsed.remotePath.lastIndexOf('/') + 1);

      const newName = await vscode.window.showInputBox({
        prompt: 'Enter new name',
        value: oldName,
        validateInput: (v) => (!v ? 'Name is required' : v === oldName ? 'Must be different' : undefined),
      });
      if (!newName) return;

      const newPath = parentDir + newName;

      try {
        await adapter.rename(parsed.remotePath, newPath);
        vscode.window.showInformationMessage(`Renamed to: ${newName}`);
        deps.sidebarProvider?.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(`Rename failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }),
  );

  // ==================================================================
  // copyPath
  // ==================================================================
  disposables.push(
    vscode.commands.registerCommand('remote-fs.copyPath', async (node?: { connectionId?: string; remotePath?: string }) => {
      const parsed = parseNode(node);
      if (!parsed) return;
      await vscode.env.clipboard.writeText(parsed.remotePath);
      vscode.window.showInformationMessage(`Copied: ${parsed.remotePath}`);
    }),
  );

  // ==================================================================
  // downloadToLocal
  // ==================================================================
  disposables.push(
    vscode.commands.registerCommand('remote-fs.downloadToLocal', async (node?: { connectionId?: string; remotePath?: string }) => {
      const parsed = parseNode(node);
      if (!parsed) return;

      const adapter = getAdapter(parsed.connectionId);
      if (!adapter) return;

      const fileName = parsed.remotePath.split('/').pop() || 'download';

      const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(fileName),
        filters: { 'All Files': ['*'] },
      });
      if (!saveUri) return;

      try {
        const content = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Downloading ${fileName}...`, cancellable: false },
          async () => adapter.readFile(parsed.remotePath),
        );
        await vscode.workspace.fs.writeFile(saveUri, content);
        vscode.window.showInformationMessage(`Downloaded to: ${saveUri.fsPath}`);
      } catch (err) {
        vscode.window.showErrorMessage(`Download failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }),
  );

  // ==================================================================
  // revealInExplorer — open cached file in OS file explorer (Shift+Alt+R)
  // ==================================================================
  disposables.push(
    vscode.commands.registerCommand('remote-fs.revealInExplorer', async (node?: { connectionId?: string; remotePath?: string }) => {
      const parsed = parseNode(node);
      if (!parsed) return;

      if (!deps.cacheManager) {
        vscode.window.showErrorMessage('Cache manager not available.');
        return;
      }

      const cachePath = deps.cacheManager.getCachePath(parsed.connectionId, parsed.remotePath);
      const exists = await deps.cacheManager.hasCache(parsed.connectionId, parsed.remotePath);
      if (!exists) {
        vscode.window.showErrorMessage('File is not cached. Open it first.');
        return;
      }

      const cacheUri = vscode.Uri.file(cachePath);
      await vscode.commands.executeCommand('revealFileInOS', cacheUri);
    }),
  );

  return disposables;
}
