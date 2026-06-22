import * as vscode from 'vscode';
import { ConnectionManager } from '../core/ConnectionManager';
import { IProtocolAdapter } from '../core/IProtocolAdapter';
import { ShellSession } from '../core/types';

/**
 * Manages SSH terminal sessions using VSCode Pseudoterminal API.
 * Creates terminals that connect to remote servers via SSH.
 */
export class TerminalManager implements vscode.Disposable {
  private activeTerminals: Map<string, vscode.Terminal> = new Map();
  private connectionManager: ConnectionManager;
  private disposables: vscode.Disposable[] = [];
  private closeListeners: Map<string, vscode.Disposable> = new Map();

  constructor(connectionManager: ConnectionManager) {
    this.connectionManager = connectionManager;
  }

  /**
   * Get the adapter for a connection. Throws if not active.
   */
  private getActiveAdapter(connectionId: string): IProtocolAdapter {
    const adapter = this.connectionManager.getAdapter(connectionId);
    if (!adapter?.isConnected()) {
      throw new Error(`Connection ${connectionId} is not active`);
    }
    return adapter;
  }

  /**
   * Create a new SSH terminal. Always creates a fresh terminal
   * (never reuses existing ones). Does NOT auto-connect — the user
   * must connect manually first via the tree view or command.
   */
  async createTerminal(connectionId: string, label?: string): Promise<vscode.Terminal> {
    const adapter = this.getActiveAdapter(connectionId);

    if (!adapter.createShell) {
      throw new Error('Shell is not supported for this connection type');
    }

    const conn = await this.connectionManager.getConnection(connectionId);
    const terminalLabel = label || `SSH: ${conn?.label || connectionId}`;

    const pty = new SSHPseudoterminal(adapter);

    const terminal = vscode.window.createTerminal({
      name: terminalLabel,
      pty,
    });

    // Show the terminal panel
    terminal.show();

    // Track for cleanup
    this.activeTerminals.set(connectionId, terminal);

    const closeListener = vscode.window.onDidCloseTerminal((closed) => {
      if (closed === terminal) {
        this.activeTerminals.delete(connectionId);
        this.closeListeners.delete(connectionId);
        pty.dispose();
        closeListener.dispose();
      }
    });
    this.closeListeners.set(connectionId, closeListener);

    return terminal;
  }

  /**
   * Open a terminal for a connection. If no connectionId is provided,
   * shows QuickPick to select from all available connections (not just active ones).
   */
  async openTerminal(connectionId?: string): Promise<void> {
    if (connectionId) {
      await this.createTerminal(connectionId);
      return;
    }

    // Show all connections, not just active ones
    const connections = this.connectionManager.getAllConnections();

    if (connections.length === 0) {
      vscode.window.showErrorMessage('No connections configured. Add a connection first.');
      return;
    }

    if (connections.length === 1) {
      await this.createTerminal(connections[0].id);
      return;
    }

    const items = connections.map((conn) => ({
      label: conn.label,
      description: `${conn.protocol}://${conn.host}`,
      connectionId: conn.id,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select connection to open terminal',
    });

    if (selected) {
      await this.createTerminal(selected.connectionId);
    }
  }

  /**
   * Dispose all terminals and clean up.
   */
  dispose(): void {
    // Clean up close listeners first to avoid triggering on terminal dispose
    for (const listener of this.closeListeners.values()) {
      listener.dispose();
    }
    this.closeListeners.clear();

    for (const terminal of this.activeTerminals.values()) {
      terminal.dispose();
    }
    this.activeTerminals.clear();

    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}

/**
 * VSCode Pseudoterminal implementation for SSH shell.
 * Bridges the ssh2 shell stream to the VSCode terminal UI.
 */
class SSHPseudoterminal implements vscode.Pseudoterminal {
  private adapter: IProtocolAdapter;
  private shellSession: ShellSession | null = null;
  private writeEmitter = new vscode.EventEmitter<string>();
  private closeEmitter = new vscode.EventEmitter<number>();

  onDidWrite: vscode.Event<string> = this.writeEmitter.event;
  onDidClose: vscode.Event<number> = this.closeEmitter.event;
  onDidOverrideDimensions?: vscode.Event<vscode.TerminalDimensions | undefined>;

  constructor(adapter: IProtocolAdapter) {
    this.adapter = adapter;
  }

  /**
   * Open the pseudoterminal — called when the terminal is created.
   */
  async open(initialDimensions: vscode.TerminalDimensions | undefined): Promise<void> {
    try {
      if (!this.adapter.createShell) {
        this.writeEmitter.fire('Error: Shell not supported for this connection.\r\n');
        this.closeEmitter.fire(1);
        return;
      }

      this.shellSession = await this.adapter.createShell();

      // Forward remote data to terminal
      this.shellSession.onData((data: string) => {
        this.writeEmitter.fire(data);
      });

      // Set initial dimensions
      if (initialDimensions && this.shellSession.resize) {
        this.shellSession.resize(initialDimensions.columns, initialDimensions.rows);
      }

      this.writeEmitter.fire('Connected to remote shell.\r\n\r\n');
    } catch (err) {
      this.writeEmitter.fire(
        `Error: ${err instanceof Error ? err.message : 'Failed to create shell'}\r\n`,
      );
      this.closeEmitter.fire(1);
    }
  }

  /**
   * Close the pseudoterminal.
   */
  close(): void {
    if (this.shellSession) {
      this.shellSession.dispose();
      this.shellSession = null;
    }
  }

  /**
   * Handle user input from the terminal.
   */
  handleInput(data: string): void {
    if (this.shellSession) {
      this.shellSession.write(data);
    }
  }

  /**
   * Handle terminal resize.
   */
  setDimensions(dimensions: vscode.TerminalDimensions): void {
    if (this.shellSession && this.shellSession.resize) {
      this.shellSession.resize(dimensions.columns, dimensions.rows);
    }
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.close();
    this.writeEmitter.dispose();
    this.closeEmitter.dispose();
  }
}
