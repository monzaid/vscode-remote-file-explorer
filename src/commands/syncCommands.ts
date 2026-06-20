import * as vscode from 'vscode';
import { IProtocolAdapter } from '../core/IProtocolAdapter';
import { LocalCacheManager } from '../core/LocalCacheManager';
import { ConflictResolver } from '../providers/ConflictResolver';

/**
 * Handles inline button commands: ⬇️ Update (sync from remote) and ⬆️ Upload (sync to remote).
 */
export class SyncCommandHandler {
  private adapter: IProtocolAdapter;
  private cacheManager: LocalCacheManager;
  private conflictResolver: ConflictResolver;
  private connectionId: string;
  private protocol: string;

  constructor(
    connectionId: string,
    adapter: IProtocolAdapter,
    cacheManager: LocalCacheManager,
    conflictResolver: ConflictResolver,
    protocol: string,
  ) {
    this.connectionId = connectionId;
    this.adapter = adapter;
    this.cacheManager = cacheManager;
    this.conflictResolver = conflictResolver;
    this.protocol = protocol;
  }

  /**
   * ⬇️ Download: Sync file from remote to local cache.
   * Compares timestamps and only downloads if remote is newer.
   */
  async syncFromRemote(remotePath: string): Promise<void> {
    try {
      // ═══ P0-3: 检查编辑器是否有未保存的修改 ═══
      const scheme = `remote-${this.protocol}`;
      const remoteUri = vscode.Uri.parse(`${scheme}://${this.connectionId}${remotePath}`);

      const editors = vscode.window.visibleTextEditors.filter(
        e => e.document.uri.toString() === remoteUri.toString()
      );

      if (editors.length > 0 && editors[0].document.isDirty) {
        const choice = await vscode.window.showWarningMessage(
          'File has unsaved changes. Save locally before updating from remote?',
          'Save & Update',
          'Cancel'
        );
        if (choice === 'Save & Update') {
          await editors[0].document.save();
        } else {
          return;
        }
      }

      // Check local cache timestamp
      const cacheStat = await this.cacheManager.getCacheStat(this.connectionId, remotePath);

      if (cacheStat.exists && cacheStat.mtime) {
        // Compare with remote timestamp
        const remoteStat = await this.adapter.stat(remotePath);
        if (remoteStat.mtime.getTime() <= cacheStat.mtime.getTime()) {
          vscode.window.showInformationMessage('File is already up to date.');
          return;
        }
      }

      // Download from remote
      const content = await this.adapter.readFile(remotePath);
      await this.cacheManager.writeCache(this.connectionId, remotePath, content);

      // Refresh open editors if this file is open
      const fileName = remotePath.split('/').pop() || remotePath;

      // Build the remote URI to match editors precisely.
      // The editor's document.uri for a remote file follows the pattern:
      //   remote-{protocol}://<connectionId><remotePath>
      // We construct the expected URI and compare via toString() for exact matching.
      const targetUri = vscode.Uri.parse(
        `${scheme}://${this.connectionId}${remotePath}`,
      );

      const openEditors = vscode.window.visibleTextEditors;
      for (const editor of openEditors) {
        if (editor.document.uri.toString() === targetUri.toString()) {
          // Replace the entire document content with the freshly downloaded content
          const fullRange = new vscode.Range(
            editor.document.positionAt(0),
            editor.document.positionAt(editor.document.getText().length),
          );
          const text = new TextDecoder().decode(content);
          await editor.edit((editBuilder) => {
            editBuilder.replace(fullRange, text);
          });
          // Save the updated document to persist the change
          await editor.document.save();
        }
      }

      vscode.window.showInformationMessage(`Synced: ${fileName}`);
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to sync: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * ⬆️ Upload: Sync local file to remote.
   * Checks for conflicts before uploading.
   */
  async syncToRemote(remotePath: string): Promise<void> {
    try {
      // ═══ P0-2: 检查编辑器是否有未保存的修改 ═══
      const scheme = `remote-${this.protocol}`;
      const remoteUri = vscode.Uri.parse(`${scheme}://${this.connectionId}${remotePath}`);

      const editors = vscode.window.visibleTextEditors.filter(
        e => e.document.uri.toString() === remoteUri.toString()
      );

      if (editors.length > 0 && editors[0].document.isDirty) {
        const choice = await vscode.window.showWarningMessage(
          'File has unsaved changes. Save locally before uploading?',
          'Save & Upload',
          'Cancel'
        );
        if (choice === 'Save & Upload') {
          await editors[0].document.save();
        } else {
          return;
        }
      }

      // Check cache exists
      const cacheStat = await this.cacheManager.getCacheStat(this.connectionId, remotePath);
      if (!cacheStat.exists) {
        vscode.window.showErrorMessage('No local cache found. Open the file first.');
        return;
      }

      // Check for conflicts
      if (cacheStat.mtime) {
        const conflict = await this.conflictResolver.checkConflict(
          this.connectionId,
          remotePath,
          cacheStat.mtime,
        );

        if (conflict.hasConflict) {
          const action = await this.conflictResolver.resolveConflict(remotePath);

          if (action === 'keep-remote') {
            // Download remote version
            const remoteContent = await this.adapter.readFile(remotePath);
            await this.cacheManager.writeCache(this.connectionId, remotePath, remoteContent);
            vscode.window.showInformationMessage('Kept remote version.');
            return;
          } else if (action === 'manual-merge') {
            // Open diff — handled by ConflictResolver
            vscode.window.showInformationMessage('Opening diff editor for manual merge.');
            return;
          }
          // force-overwrite: continue to upload
        }
      }

      // Upload to remote
      const content = await this.cacheManager.readCache(this.connectionId, remotePath);
      await this.adapter.writeFile(remotePath, content);

      const fileName = remotePath.split('/').pop();
      vscode.window.showInformationMessage(`Uploaded: ${fileName || remotePath}`);
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to upload: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
  }
}
