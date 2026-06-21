import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { IProtocolAdapter } from '../core/IProtocolAdapter';
import { ConflictResult, ConflictAction } from '../core/types';

/**
 * Detects and resolves file conflicts between local cache and remote server.
 * Provides 3 options per mode:
 *   upload:   cancel-upload / force-overwrite / manual-merge
 *   download: download      / keep-local     / manual-merge
 */
export class ConflictResolver {
  private adapter: IProtocolAdapter;
  // TODO(P3-5): skipSet is in-memory only and lost on restart.
  private skipSet: Map<string, Set<string>> = new Map();

  constructor(adapter: IProtocolAdapter) {
    this.adapter = adapter;
  }

  private getSkipSet(connectionId: string): Set<string> {
    let connSet = this.skipSet.get(connectionId);
    if (!connSet) {
      connSet = new Set<string>();
      this.skipSet.set(connectionId, connSet);
    }
    return connSet;
  }

  async checkConflict(
    connectionId: string,
    remotePath: string,
    localMtime: Date,
  ): Promise<ConflictResult> {
    if (this.getSkipSet(connectionId).has(remotePath)) {
      return { hasConflict: false };
    }
    try {
      const remoteStat = await this.adapter.stat(remotePath);
      const remoteMtime = remoteStat.mtime;
      const timeDiff = Math.abs(remoteMtime.getTime() - localMtime.getTime());
      if (timeDiff > 1000) {
        return { hasConflict: true, remoteMtime, localMtime };
      }
      return { hasConflict: false };
    } catch {
      return { hasConflict: false };
    }
  }

  /**
   * Present conflict resolution dialog.
   * Uses showWarningMessage { modal: true } — buttons are context-specific
   * per mode so they're visually distinct from non-modal dirty-file prompts.
   *
   * @param remotePath  The conflicting file path
   * @param mode        'upload' (⬆️) or 'download' (⬇️)
   */
  async resolveConflict(remotePath: string, mode: 'upload' | 'download' = 'upload'): Promise<ConflictAction> {
    const fileName = remotePath.split('/').pop() || remotePath;

    let choice: string | undefined;
    if (mode === 'upload') {
      choice = await vscode.window.showWarningMessage(
        `⚠ Upload Conflict: "${fileName}" was modified on the server since your last download.\n\nYour upload would overwrite remote changes. Choose how to proceed:`,
        { modal: true },
        'Cancel Upload',
        'Force Overwrite',
        'Manual Merge',
      );
    } else {
      choice = await vscode.window.showWarningMessage(
        `⚠ Update Conflict: "${fileName}" was modified on the server.\n\nDownloading would overwrite your local version. Choose how to proceed:`,
        { modal: true },
        'Cancel',
        'Download & Overwrite',
        'Manual Merge',
      );
    }

    switch (choice) {
      case 'Cancel Upload':
      case 'Cancel':
        return 'keep-remote';
      case 'Force Overwrite':
      case 'Download & Overwrite':
        return 'force-overwrite';
      case 'Manual Merge':
        return 'manual-merge';
      default:
        return 'keep-remote';  // dismissed → safe default
    }
  }

  /**
   * Write remote content to a temp file and return its file:// URI.
   * Used by Diff editors so VSCode reads it as a local file,
   * avoiding the RemoteFSProvider path (which would try to stat on the server).
   */
  async writeRemoteTemp(remotePath: string, content: Uint8Array): Promise<vscode.Uri> {
    const tmpDir = os.tmpdir();
    const safeName = remotePath.replace(/[/\\:]/g, '_') + '.remote-base';
    const tmpPath = path.join(tmpDir, `rfe-diff-${Date.now()}-${safeName}`);
    await vscode.workspace.fs.writeFile(vscode.Uri.file(tmpPath), content);
    return vscode.Uri.file(tmpPath);
  }

  /**
   * Skip conflict check for a specific file for this session.
   * @param connectionId The connection identifier
   * @param remotePath The remote file path to skip
   */
  skipForSession(connectionId: string, remotePath: string): void {
    this.getSkipSet(connectionId).add(remotePath);
  }

  /**
   * Clear the skip set for a specific connection, or all connections.
   * @param connectionId Optional — if omitted, clears all skip sets.
   */
  clearSkipSet(connectionId?: string): void {
    if (connectionId) {
      this.skipSet.delete(connectionId);
    } else {
      this.skipSet.clear();
    }
  }
}
