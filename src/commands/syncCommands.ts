import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { IProtocolAdapter } from '../core/IProtocolAdapter';
import { LocalCacheManager } from '../core/LocalCacheManager';

/**
 * Handles inline button commands: ⬇️ Update (sync from remote) and ⬆️ Upload (sync to remote).
 */
export class SyncCommandHandler {
  private adapter: IProtocolAdapter;
  private cacheManager: LocalCacheManager;
  private connectionId: string;
  private protocol: string;

  constructor(
    connectionId: string,
    adapter: IProtocolAdapter,
    cacheManager: LocalCacheManager,
    protocol: string,
  ) {
    this.connectionId = connectionId;
    this.adapter = adapter;
    this.cacheManager = cacheManager;
    this.protocol = protocol;
  }

  /**
   * ⬇️ Download: Sync file from remote to local cache.
   * P2: Compares SHA-256 hash of remote content against local cache before overwriting.
   */
  async syncFromRemote(remotePath: string): Promise<void> {
    try {
      const scheme = `remote-${this.protocol}`;
      const remoteUri = vscode.Uri.parse(`${scheme}://${this.connectionId}${remotePath}`);

      // Check for unsaved changes
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

      // Download remote content
      const content = await this.adapter.readFile(remotePath);

      // P2: Compute SHA-256 of remote content
      const remoteHash = crypto.createHash('sha256').update(content).digest('hex');

      // Check if local cache exists and compare hashes
      const cacheStat = await this.cacheManager.getCacheStat(this.connectionId, remotePath);
      if (cacheStat.exists) {
        const localHash = await this.cacheManager.readLocalHash(this.connectionId, remotePath);
        if (localHash && localHash === remoteHash) {
          vscode.window.showInformationMessage(
            `File is already up to date: ${remotePath.split('/').pop()}`,
          );
          return;
        }

        const choice = await vscode.window.showWarningMessage(
          '检测到本地有对应的缓存文件',
          { modal: true },
          '下载覆盖',
          '保留本地',
        );
        if (choice !== '下载覆盖') {
          return;
        }
      }

      // Write cache and refresh editors
      await this.cacheManager.writeCache(this.connectionId, remotePath, content);
      this.refreshEditor(remotePath, content, scheme);
      vscode.window.showInformationMessage(`Synced: ${remotePath.split('/').pop()}`);
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to sync: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * ⬆️ Upload: Sync local file to remote.
   */
  async syncToRemote(remotePath: string): Promise<void> {
    try {
      const scheme = `remote-${this.protocol}`;
      const remoteUri = vscode.Uri.parse(`${scheme}://${this.connectionId}${remotePath}`);

      // Check for unsaved changes
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
        vscode.window.showErrorMessage('没有文件可以上传');
        return;
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

  private refreshEditor(remotePath: string, content: Uint8Array, scheme: string): void {
    const targetUri = vscode.Uri.parse(`${scheme}://${this.connectionId}${remotePath}`);
    const openEditors = vscode.window.visibleTextEditors;
    for (const editor of openEditors) {
      if (editor.document.uri.toString() === targetUri.toString()) {
        const fullRange = new vscode.Range(
          editor.document.positionAt(0),
          editor.document.positionAt(editor.document.getText().length),
        );
        const text = new TextDecoder().decode(content);
        editor.edit((editBuilder) => { editBuilder.replace(fullRange, text); }).then(() => {
          editor.document.save();
        });
      }
    }
  }
}
