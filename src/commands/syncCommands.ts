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
   * Compares timestamps; shows conflict dialog when remote differs.
   */
  async syncFromRemote(remotePath: string): Promise<void> {
    try {
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

      // Check local cache and compare with remote via content hash
      const cacheStat = await this.cacheManager.getCacheStat(this.connectionId, remotePath);

      if (!cacheStat.exists) {
        // No cache: download fresh
      } else {
        const conflict = await this.conflictResolver.checkConflict(
          this.connectionId,
          remotePath,
        );

        if (!conflict.hasConflict) {
          vscode.window.showInformationMessage('File is already up to date.');
          return;
        }

        const action = await this.conflictResolver.resolveConflict(remotePath, 'download');

        if (action === 'keep-remote') {
          vscode.window.showInformationMessage('Kept local version.');
          return;
        }

        if (action === 'manual-merge') {
          try {
            const remoteContent = await this.adapter.readFile(remotePath);
            const baseUri = await this.conflictResolver.writeRemoteTemp(remotePath, remoteContent);
            const localUri = vscode.Uri.parse(`${scheme}://${this.connectionId}${remotePath}`);
            await vscode.commands.executeCommand(
              'vscode.diff',
              baseUri,
              localUri,
              `Merge: ${remotePath.split('/').pop()} (Remote ⇿ Local)`,
            );
            // Update baseline to remote hash after manual merge
            await this.cacheManager.writeBase(this.connectionId, remotePath, remoteContent);
          } catch (e) {
            vscode.window.showErrorMessage(`Failed to open diff: ${e instanceof Error ? e.message : e}`);
          }
          return;
        }
        // Download & Overwrite: fall through
      }

      // Download from remote
      const content = await this.adapter.readFile(remotePath);
      await this.cacheManager.writeCache(this.connectionId, remotePath, content);
      await this.cacheManager.writeBase(this.connectionId, remotePath, content);

      // Refresh open editors
      const fileName = remotePath.split('/').pop() || remotePath;
      const targetUri = vscode.Uri.parse(`${scheme}://${this.connectionId}${remotePath}`);

      const openEditors = vscode.window.visibleTextEditors;
      for (const editor of openEditors) {
        if (editor.document.uri.toString() === targetUri.toString()) {
          const fullRange = new vscode.Range(
            editor.document.positionAt(0),
            editor.document.positionAt(editor.document.getText().length),
          );
          const text = new TextDecoder().decode(content);
          await editor.edit((editBuilder) => { editBuilder.replace(fullRange, text); });
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

      // Check for conflicts using content hash
      const conflict = await this.conflictResolver.checkConflict(
        this.connectionId,
        remotePath,
      );

      if (conflict.hasConflict) {
        const action = await this.conflictResolver.resolveConflict(remotePath, 'upload');

        if (action === 'keep-remote') {
          vscode.window.showInformationMessage('Upload cancelled. Remote version kept.');
          return;
        }

        if (action === 'manual-merge') {
          try {
            const remoteContent = await this.adapter.readFile(remotePath);
            const baseUri = await this.conflictResolver.writeRemoteTemp(remotePath, remoteContent);
            const localUri = vscode.Uri.parse(`${scheme}://${this.connectionId}${remotePath}`);
            await vscode.commands.executeCommand(
              'vscode.diff',
              baseUri,
              localUri,
              `Merge: ${remotePath.split('/').pop()} (Remote ⇿ Local)`,
            );
          } catch (e) {
            vscode.window.showErrorMessage(`Failed to open diff: ${e instanceof Error ? e.message : e}`);
          }
          return;
        }
        // Force Overwrite: continue to upload
      }

      // Upload to remote
      const content = await this.cacheManager.readCache(this.connectionId, remotePath);
      await this.adapter.writeFile(remotePath, content);
      // After successful upload, update baseline to match remote
      await this.cacheManager.writeBase(this.connectionId, remotePath, content);

      const fileName = remotePath.split('/').pop();
      vscode.window.showInformationMessage(`Uploaded: ${fileName || remotePath}`);
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to upload: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
  }
}
