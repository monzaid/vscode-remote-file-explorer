import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { IProtocolAdapter } from '../core/IProtocolAdapter';
import { LocalCacheManager } from '../core/LocalCacheManager';
import { ConflictResult, ConflictAction } from '../core/types';

/**
 * Detects and resolves file conflicts between local cache and remote server.
 * Uses content hash (SHA-256) for detection — no timestamps, no clock issues.
 *   upload:   cancel-upload / force-overwrite / manual-merge
 *   download: download      / keep-local     / manual-merge
 */
export class ConflictResolver {
  private adapter: IProtocolAdapter;
  private cacheManager: LocalCacheManager;
  private skipSet: Map<string, Set<string>> = new Map();

  constructor(adapter: IProtocolAdapter, cacheManager: LocalCacheManager) {
    this.adapter = adapter;
    this.cacheManager = cacheManager;
  }

  private getSkipSet(connectionId: string): Set<string> {
    let connSet = this.skipSet.get(connectionId);
    if (!connSet) {
      connSet = new Set<string>();
      this.skipSet.set(connectionId, connSet);
    }
    return connSet;
  }

  /**
   * Check if local cache differs from remote using content hash.
   * Stage 1 (fast): compare file sizes → Stage 2 (accurate): compare SHA-256 hashes.
   */
  async checkConflict(connectionId: string, remotePath: string): Promise<ConflictResult> {
    if (this.getSkipSet(connectionId).has(remotePath)) {
      return { hasConflict: false };
    }
    try {
      // Stage 1: compare sizes (no download needed)
      const remoteStat = await this.adapter.stat(remotePath);
      const cacheStat = await this.cacheManager.getCacheStat(connectionId, remotePath);

      // No local cache → nothing to compare against → no conflict
      if (!cacheStat.exists) {
        return { hasConflict: false };
      }

      // Stage 1: compare sizes (no download needed)
      if (cacheStat.size !== remoteStat.size) {
        return { hasConflict: true };
      }

      // Stage 2: sizes match — compare remote hash vs baseline hash
      const remoteContent = await this.adapter.readFile(remotePath);
      const remoteHash = crypto.createHash('sha256').update(remoteContent).digest('hex');
      const baseHash = await this.cacheManager.readBase(connectionId, remotePath);

      // No baseline → first sync → no conflict
      if (!baseHash) {
        return { hasConflict: false };
      }

      if (remoteHash !== baseHash) {
        return { hasConflict: true };
      }

      return { hasConflict: false };
    } catch {
      // If remote stat/read fails (file deleted, etc.) — no conflict to resolve
      return { hasConflict: false };
    }
  }

  /**
   * Present conflict resolution dialog.
   * Uses showWarningMessage for consistency with the dirty-file prompt style.
   *
   * @param remotePath  The conflicting file path
   * @param mode        'upload' or 'download' — changes the option labels
   */
  async resolveConflict(remotePath: string, mode: 'upload' | 'download' = 'upload'): Promise<ConflictAction> {
    const fileName = remotePath.split('/').pop() || remotePath;

    const choice = mode === 'upload'
      ? await vscode.window.showWarningMessage(
          `Conflict: "${fileName}" has been modified on the server. Upload anyway?`,
          { modal: true },
          'Cancel Upload',
          'Force Overwrite',
          'Manual Merge',
        )
      : await vscode.window.showWarningMessage(
          `Conflict: "${fileName}" differs from the server version.`,
          { modal: true },
          'Download & Overwrite',
          'Keep Local',
          'Manual Merge',
        );

    switch (choice) {
      case 'Cancel Upload':
      case 'Keep Local':
        return 'keep-remote';
      case 'Force Overwrite':
      case 'Download & Overwrite':
        return 'force-overwrite';
      case 'Manual Merge':
        return 'manual-merge';
      default:
        return 'keep-remote';
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
