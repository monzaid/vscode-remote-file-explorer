import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { IProtocolAdapter } from '../core/IProtocolAdapter';
import { ConflictResult, ConflictAction } from '../core/types';

/**
 * Detects and resolves file conflicts between local cache and remote server.
 *
 * Conflict dialog uses showWarningMessage (modal) for its three options.
 * Manual-merge opens a vscode.diff editor with orientation matching the mode:
 *
 *   upload:   Left = Remote (base),  Right = Local (changes to upload)
 *   download: Left = Local  (base),  Right = Remote (changes to download)
 *
 * After the diff editor closes, a follow-up prompt lets the user accept
 * the relevant side or cancel.
 */
export class ConflictResolver {
  private adapter: IProtocolAdapter;
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
      const timeDiff = Math.abs(remoteStat.mtime.getTime() - localMtime.getTime());
      if (timeDiff > 1000) {
        return { hasConflict: true, remoteMtime: remoteStat.mtime, localMtime };
      }
      return { hasConflict: false };
    } catch {
      return { hasConflict: false };
    }
  }

  /**
   * Show conflict resolution dialog with three buttons.
   * Mode controls the button labels:
   *   upload:   Cancel Upload | Force Overwrite | Manual Merge
   *   download: Keep Local   | Download & Overwrite | Manual Merge
   */
  async resolveConflict(remotePath: string, mode: 'upload' | 'download' = 'upload'): Promise<ConflictAction> {
    const fileName = remotePath.split('/').pop() || remotePath;
    const [btn1, btn2, btn3] = mode === 'upload'
      ? ['Cancel Upload', 'Force Overwrite', 'Manual Merge']
      : ['Keep Local', 'Download & Overwrite', 'Manual Merge'];

    const choice = await vscode.window.showWarningMessage(
      `Conflict: "${fileName}" was modified on the server since your last ${mode}.`,
      { modal: true },
      btn1,
      btn2,
      btn3,
    );

    if (choice === btn1) return 'keep-remote';
    if (choice === btn2) return 'force-overwrite';
    if (choice === btn3) return 'manual-merge';
    // Dismissed: safe default
    return 'keep-remote';
  }

  /**
   * Open a diff editor with correct left/right orientation and a follow-up
   * acceptance prompt. Returns the user's final decision.
   *
   * @param mode        'upload' or 'download' — controls L/R ordering and labels
   * @param remotePath  The server-side file path (used for labels)
   * @param remoteContent  The server-side file content
   * @param localUri    URI for the local cache file (remote-* scheme)
   * @param adapter     Optional — if provided, 'accept' will push the result
   * @returns 'accepted' | 'cancelled'
   */
  async openMergeDiff(
    mode: 'upload' | 'download',
    remotePath: string,
    remoteContent: Uint8Array,
    localUri: vscode.Uri,
    adapter?: { writeFile: (p: string, c: Uint8Array) => Promise<void> },
  ): Promise<'accepted' | 'cancelled'> {
    const fileName = remotePath.split('/').pop() || remotePath;
    const baseUri = await this.writeRemoteTemp(remotePath, remoteContent);

    // Orientation:
    //   upload:   show what's on server (left) vs what I'm about to upload (right)
    //   download: show what I have (left) vs what's on server (right)
    const [leftUri, rightUri, leftLabel, rightLabel] = mode === 'upload'
      ? [baseUri, localUri, 'Remote (server)', 'Local (your changes)']
      : [localUri, baseUri, 'Local (cache)', 'Remote (server)'];

    const title = `Merge: ${fileName} (${leftLabel} ↔ ${rightLabel})`;
    await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);

    // Post-diff: ask user to accept a side
    const [acceptLabel, cancelLabel] = mode === 'upload'
      ? ['Accept Local & Upload', 'Keep Remote & Cancel']
      : ['Accept Remote & Download', 'Keep Local & Cancel'];

    const action = await vscode.window.showWarningMessage(
      `Merge complete for "${fileName}". Choose how to proceed:`,
      { modal: true },
      acceptLabel,
      cancelLabel,
    );

    if (action === acceptLabel) {
      if (mode === 'upload' && adapter) {
        // Upload local cache to remote
        const cacheContent = await vscode.workspace.fs.readFile(localUri);
        await adapter.writeFile(remotePath, cacheContent);
      }
      return 'accepted';
    }
    return 'cancelled';
  }

  /** Write content to a temp file and return its file:// URI (for diff right side). */
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
