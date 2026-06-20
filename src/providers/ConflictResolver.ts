import * as vscode from 'vscode';
import { IProtocolAdapter } from '../core/IProtocolAdapter';
import { ConflictResult, ConflictAction } from '../core/types';

/**
 * Detects and resolves file conflicts between local cache and remote server.
 * Provides 3 options: keep-remote, force-overwrite, manual-merge.
 */
export class ConflictResolver {
  private adapter: IProtocolAdapter;
  // TODO(P3-5): skipSet is in-memory only and lost on restart.
  // Consider persisting to vscode.workspace.getConfiguration() or globalState
  // for a better user experience across sessions.
  private skipSet: Map<string, Set<string>> = new Map(); // connectionId → files to skip

  constructor(adapter: IProtocolAdapter) {
    this.adapter = adapter;
  }

  /**
   * Get or create the skip set for a given connection.
   */
  private getSkipSet(connectionId: string): Set<string> {
    let connSet = this.skipSet.get(connectionId);
    if (!connSet) {
      connSet = new Set<string>();
      this.skipSet.set(connectionId, connSet);
    }
    return connSet;
  }

  /**
   * Check if a conflict exists between local cache and remote file.
   * @param connectionId The connection identifier
   * @param remotePath The remote file path
   * @param localMtime The local cache modification time
   * @returns ConflictResult indicating if there's a conflict
   */
  async checkConflict(
    connectionId: string,
    remotePath: string,
    localMtime: Date,
  ): Promise<ConflictResult> {
    // Skip if this file is in the "don't ask again" set for this connection
    if (this.getSkipSet(connectionId).has(remotePath)) {
      return { hasConflict: false };
    }

    try {
      const remoteStat = await this.adapter.stat(remotePath);
      const remoteMtime = remoteStat.mtime;

      // Compare modification times (with 1 second tolerance)
      const timeDiff = Math.abs(remoteMtime.getTime() - localMtime.getTime());

      if (timeDiff > 1000) {
        return {
          hasConflict: true,
          remoteMtime,
          localMtime,
        };
      }

      return { hasConflict: false };
    } catch {
      // File may not exist remotely — no conflict
      return { hasConflict: false };
    }
  }

  /**
   * Present conflict resolution dialog to the user.
   * @param remotePath The file path with conflict
   * @returns The chosen conflict action
   */
  async resolveConflict(remotePath: string): Promise<ConflictAction> {
    const fileName = remotePath.split('/').pop() || remotePath;

    const choice = await vscode.window.showWarningMessage(
      `Conflict: "${fileName}" has been modified on the remote server since you last downloaded it.`,
      { modal: true },
      'Keep Remote',
      'Force Overwrite',
      'Manual Merge',
    );

    switch (choice) {
      case 'Keep Remote':
        return 'keep-remote';
      case 'Force Overwrite':
        return 'force-overwrite';
      case 'Manual Merge':
        return 'manual-merge';
      default:
        // User dismissed the dialog — keep remote as safe default
        return 'keep-remote';
    }
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
