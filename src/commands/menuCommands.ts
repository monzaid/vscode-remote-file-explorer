import * as vscode from 'vscode';

/**
 * Register additional menu-specific command handlers.
 * These complement the commands in commandRegistry.ts with
 * implementations specific to context menu actions.
 */
export function registerMenuCommands(context: vscode.ExtensionContext): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  // Menu command implementations are handled by commandRegistry.ts
  // This file provides additional menu-specific behavior

  // Re-register connect with menu context awareness
  disposables.push(
    vscode.commands.registerCommand('remote-fs.menuConnect', async (node?: { connectionId?: string }) => {
      if (node?.connectionId) {
        await vscode.commands.executeCommand('remote-fs.connect', node);
      }
    }),
  );

  // Re-register disconnect with menu context awareness
  disposables.push(
    vscode.commands.registerCommand('remote-fs.menuDisconnect', async (node?: { connectionId?: string }) => {
      if (node?.connectionId) {
        await vscode.commands.executeCommand('remote-fs.disconnect', node);
      }
    }),
  );

  return disposables;
}
