import * as vscode from 'vscode';
import { ConnectionStatus } from '../core/types';

/**
 * Manages the VSCode status bar items for Remote File Explorer.
 * Shows connection status indicator and quick-action buttons.
 */
export class StatusBarManager implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private syncButton: vscode.StatusBarItem;
  private uploadButton: vscode.StatusBarItem;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    // Connection status indicator (left side)
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.name = 'Remote FS Connection Status';
    this.statusBarItem.command = 'remote-fs.manageConnections';
    this.statusBarItem.tooltip = 'Remote File Explorer — Manage Connections';
    this.updateStatus('idle', 0);
    this.statusBarItem.show();

    // Sync button (right side)
    this.syncButton = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      101
    );
    this.syncButton.name = 'Remote FS Sync';
    this.syncButton.text = '$(cloud-download) Sync';
    this.syncButton.command = 'remote-fs.syncCurrentFile';
    this.syncButton.tooltip = 'Sync Current File from Remote (download latest)';
    this.syncButton.show();

    // Upload button (right side)
    this.uploadButton = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.uploadButton.name = 'Remote FS Upload';
    this.uploadButton.text = '$(cloud-upload) Upload';
    this.uploadButton.command = 'remote-fs.uploadCurrentFile';
    this.uploadButton.tooltip = 'Upload Current File to Remote';
    this.uploadButton.show();

    this.disposables.push(this.statusBarItem, this.syncButton, this.uploadButton);
  }

  /**
   * Update the connection status display.
   * @param status Current connection status
   * @param activeCount Number of active connections
   */
  updateStatus(status: ConnectionStatus, activeCount: number): void {
    let icon: string;
    let label: string;

    switch (status) {
      case 'connected':
        icon = '$(circle-filled)';
        label = `Remote FS: ${activeCount} connected`;
        this.statusBarItem.backgroundColor = undefined;
        break;
      case 'connecting':
        icon = '$(sync~spin)';
        label = `Remote FS: Connecting...`;
        this.statusBarItem.backgroundColor = undefined;
        break;
      case 'error':
        icon = '$(error)';
        label = `Remote FS: Error`;
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        break;
      case 'disconnected':
      case 'idle':
      default:
        icon = '$(circle-slash)';
        label = `Remote FS: ${activeCount > 0 ? activeCount + ' connected' : 'Disconnected'}`;
        this.statusBarItem.backgroundColor = undefined;
        break;
    }

    this.statusBarItem.text = `${icon} ${label}`;
  }

  /**
   * Dispose all status bar items.
   */
  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
