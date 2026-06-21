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
   * Uses showQuickPick (dropdown style) to be visually distinct from
   * the showWarningMessage used for dirty-file prompts.
   *
   * @param remotePath  The conflicting file path
   * @param mode        'upload' or 'download' — changes the option labels
   */
  async resolveConflict(remotePath: string, mode: 'upload' | 'download' = 'upload'): Promise<ConflictAction> {
    const fileName = remotePath.split('/').pop() || remotePath;
    const directionLabel = mode === 'upload' ? 'upload' : 'download';

    const items: vscode.QuickPickItem[] = mode === 'upload'
      ? [
          { label: '$(circle-slash) Cancel Upload',       description: 'Keep remote version, discard local changes', alwaysShow: true },
          { label: '$(cloud-upload) Force Overwrite',     description: 'Overwrite remote with your local version',    alwaysShow: true },
          { label: '$(diff) Manual Merge',                description: 'Open diff editor to compare and merge',       alwaysShow: true },
        ]
      : [
          { label: '$(cloud-download) Download & Overwrite', description: 'Replace local with remote version',      alwaysShow: true },
          { label: '$(circle-slash) Keep Local',             description: 'Discard remote changes, keep local',      alwaysShow: true },
          { label: '$(diff) Manual Merge',                   description: 'Open diff editor to compare and merge',   alwaysShow: true },
        ];

    const choice = await vscode.window.showQuickPick(items, {
      placeHolder: `⚠ Conflict: "${fileName}" was modified on server since last ${directionLabel}. Choose action:`,
    });

    if (!choice) {
      // User dismissed → safe default: cancel upload / keep local
      return mode === 'upload' ? 'keep-remote' : 'keep-remote';
    }

    if (choice.label.includes('Cancel') || choice.label.includes('Keep Local')) {
      return 'keep-remote';
    }
    if (choice.label.includes('Force Overwrite') || choice.label.includes('Download')) {
      return 'force-overwrite';
    }
    return 'manual-merge';
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
