import * as vscode from 'vscode';
import { ConnectionConfig, ConnectionProtocol, AuthType, MountedPath } from '../core/types';

/**
 * Manages connection add/edit/delete UI dialogs using VSCode InputBox and QuickPick.
 */
export class ConnectionDialog {
  /**
   * Show the add connection dialog with multi-step input.
   */
  async showAddConnectionDialog(): Promise<ConnectionConfig | undefined> {
    // Step 1: Select protocol
    const protocol = await vscode.window.showQuickPick(
      [
        { label: 'SSH/SFTP', description: 'Secure Shell connection', value: 'ssh' as ConnectionProtocol },
        { label: 'FTP', description: 'File Transfer Protocol', value: 'ftp' as ConnectionProtocol },
        { label: 'FTPS (Explicit)', description: 'FTP over TLS (explicit)', value: 'ftp' as ConnectionProtocol },
        { label: 'FTPS (Implicit)', description: 'FTP over TLS (implicit)', value: 'ftp' as ConnectionProtocol },
        { label: 'Agent', description: 'Custom Agent protocol', value: 'agent' as ConnectionProtocol },
      ],
      { placeHolder: 'Select connection protocol' },
    );
    if (!protocol) return undefined;

    // Step 2: Host
    const host = await vscode.window.showInputBox({
      prompt: 'Enter hostname or IP address',
      placeHolder: '192.168.1.100',
      validateInput: (value) => (!value ? 'Host is required' : undefined),
    });
    if (host === undefined) return undefined;
    if (!host) {
      vscode.window.showErrorMessage('Host is required');
      return undefined;
    }

    // Step 3: Port
    const defaultPort = protocol.value === 'ssh' ? '22' : protocol.value === 'ftp' ? '21' : '8080';
    const portStr = await vscode.window.showInputBox({
      prompt: 'Enter port number',
      placeHolder: defaultPort,
      value: defaultPort,
      validateInput: (value) => {
        if (!value || !value.trim()) return undefined; // empty = use default
        const num = parseInt(value.trim(), 10);
        return isNaN(num) || num < 1 || num > 65535 ? 'Invalid port (1-65535)' : undefined;
      },
    });
    if (portStr === undefined) return undefined;
    const port = parseInt((portStr || defaultPort).trim(), 10);

    // Step 4: Username
    const username = await vscode.window.showInputBox({
      prompt: 'Enter username',
      placeHolder: 'root',
      validateInput: (value) => (!value ? 'Username is required' : undefined),
    });
    if (username === undefined) return undefined;
    if (!username) {
      vscode.window.showErrorMessage('Username is required');
      return undefined;
    }

    // Step 5: Auth type
    const authType = await vscode.window.showQuickPick(
      [
        { label: 'Password', description: 'Authenticate with password', value: 'password' as AuthType },
        { label: 'Private Key', description: 'Authenticate with SSH key', value: 'key' as AuthType },
      ],
      { placeHolder: 'Select authentication method' },
    );
    if (!authType) return undefined;

    // Step 6: Password/Key
    let password: string | undefined;
    let privateKeyPath: string | undefined;

    if (authType.value === 'password') {
      password = await vscode.window.showInputBox({
        prompt: 'Enter password',
        password: true,
        placeHolder: 'Password (stored securely)',
      });
      if (password === undefined) return undefined;
    } else {
      const keyUris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectMany: false,
        openLabel: 'Select Private Key',
        filters: { 'All Files': ['*'] },
      });
      if (!keyUris || keyUris.length === 0) return undefined;
      privateKeyPath = keyUris[0].fsPath;

      // Optional passphrase
      password = await vscode.window.showInputBox({
        prompt: 'Enter passphrase (optional)',
        password: true,
        placeHolder: 'Key passphrase',
      });
    }

    // Step 7: Label
    const label = await vscode.window.showInputBox({
      prompt: 'Enter a display name for this connection',
      placeHolder: `${username}@${host}`,
      value: `${username}@${host}`,
    });
    if (label === undefined) return undefined;

    // Step 8: Mounted paths (optional)
    const mountedPaths: MountedPath[] = [];
    let addMore = true;
    while (addMore) {
      const remotePath = await vscode.window.showInputBox({
        prompt: 'Enter remote path to mount (leave empty to skip)',
        placeHolder: '/var/www',
      });
      if (!remotePath) break;

      const pathLabel = await vscode.window.showInputBox({
        prompt: 'Enter label for this mount',
        placeHolder: remotePath.split('/').pop() || remotePath,
        value: remotePath.split('/').pop() || remotePath,
      });
      if (pathLabel === undefined) break;

      mountedPaths.push({ remotePath, label: pathLabel || remotePath });

      const more = await vscode.window.showQuickPick(['Add another path', 'Done'], {
        placeHolder: 'Add another mounted path?',
      });
      if (more !== 'Add another path') addMore = false;
    }

    // Generate ID
    const id = `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const config: ConnectionConfig = {
      id,
      label: label || `${username}@${host}`,
      protocol: protocol.value,
      host,
      port,
      username: username || 'root',
      authType: authType.value,
      password,
      privateKeyPath,
      mountedPaths: mountedPaths.length > 0 ? mountedPaths : [{ remotePath: '/', label: 'Root' }],
    };

    return config;
  }

  /**
   * Show edit connection dialog with full field editing,
   * auth type switching, and remote path management.
   */
  async showEditConnectionDialog(existing: ConnectionConfig): Promise<ConnectionConfig | undefined> {
    const updated = { ...existing, mountedPaths: [...existing.mountedPaths] };
    let editing = true;

    while (editing) {
      const authDesc = updated.authType === 'key' && updated.privateKeyPath
        ? `$(key) Key: ${updated.privateKeyPath.split(/[\\/]/).pop()}`
        : updated.authType === 'password'
          ? '$(key) Password'
          : '$(edit) Click to change';
      const items: vscode.QuickPickItem[] = [
        { label: `Label: ${updated.label}`, description: '$(edit) Click to change' },
        { label: `Host: ${updated.host}`, description: `$(edit) Click to change` },
        { label: `Port: ${updated.port}`, description: `$(edit) Click to change` },
        { label: `Username: ${updated.username}`, description: `$(edit) Click to change` },
        { label: '$(shield) Manage Auth', description: authDesc },
        { label: '$(folder) Manage Remote Paths', description: `${updated.mountedPaths.length} path(s) configured` },
        { label: '$(check) Done Editing', description: 'Save changes' },
      ];

      const field = await vscode.window.showQuickPick(items, {
        placeHolder: `Editing "${existing.label}" — select a field to change, or Done to save`,
      });
      if (!field) return undefined;

      const choice = field.label;

      if (choice.startsWith('Label:')) {
        const v = await vscode.window.showInputBox({ prompt: 'New label', value: updated.label });
        if (v) updated.label = v;
      } else if (choice.startsWith('Host:')) {
        const v = await vscode.window.showInputBox({ prompt: 'New host', value: updated.host });
        if (v) updated.host = v;
      } else if (choice.startsWith('Port:')) {
        const v = await vscode.window.showInputBox({ prompt: 'New port', value: String(updated.port) });
        if (v && !isNaN(parseInt(v))) updated.port = parseInt(v, 10);
      } else if (choice.startsWith('Username:')) {
        const v = await vscode.window.showInputBox({ prompt: 'New username', value: updated.username });
        if (v) updated.username = v;
      } else if (choice.includes('Manage Auth')) {
        await this.manageAuth(updated);
      } else if (choice.includes('Manage Remote Paths')) {
        await this.manageRemotePaths(updated);
      } else if (choice.includes('Done')) {
        editing = false;
      }
    }

    return updated;
  }

  /**
   * Sub-dialog for managing authentication: switch type, set password/key/passphrase.
   */
  private async manageAuth(config: ConnectionConfig): Promise<void> {
    let managing = true;
    while (managing) {
      const authLabel = config.authType === 'key'
        ? `$(key) Private Key`
        : `$(key) Password`;
      const items: vscode.QuickPickItem[] = [
        { label: `Auth Type: ${config.authType}`, description: '$(edit) Switch between password and key' },
        ...(config.authType === 'password'
          ? [{ label: `Password: $(edit) Change password`, description: '' }]
          : []),
        ...(config.authType === 'key'
          ? [
              { label: `Key File: ${config.privateKeyPath || '$(circle-slash) Not set'}`, description: '$(folder) Select private key' },
              { label: `Passphrase: ${config.passphrase ? '$(check) Set' : '$(circle-slash) Not set'}`, description: '$(edit) Change passphrase' },
            ]
          : []),
        { label: '$(arrow-left) Back', description: 'Return to connection settings' },
      ];

      const chosen = await vscode.window.showQuickPick(items, {
        placeHolder: `Manage authentication for "${config.label}"`,
      });

      if (!chosen || chosen.label.includes('Back')) {
        managing = false;
        continue;
      }

      const choice = chosen.label;
      if (choice.startsWith('Auth Type:')) {
        const newAuth = await vscode.window.showQuickPick(
          [
            { label: 'Password', description: 'Authenticate with password' },
            { label: 'Private Key', description: 'Authenticate with SSH key' },
          ],
          { placeHolder: 'Select authentication method' },
        );
        if (newAuth) {
          config.authType = newAuth.label === 'Private Key' ? 'key' : 'password';
          if (config.authType === 'password') {
            config.privateKeyPath = undefined;
            config.passphrase = undefined;
          }
        }
      } else if (choice.startsWith('Password:')) {
        const v = await vscode.window.showInputBox({
          prompt: 'Enter password', password: true,
          value: config.password || '',
        });
        if (v !== undefined) config.password = v;
      } else if (choice.startsWith('Key File:')) {
        const keyUris = await vscode.window.showOpenDialog({
          canSelectFiles: true, canSelectMany: false,
          openLabel: 'Select Private Key', filters: { 'All Files': ['*'] },
        });
        if (keyUris && keyUris.length > 0) config.privateKeyPath = keyUris[0].fsPath;
      } else if (choice.startsWith('Passphrase:')) {
        const v = await vscode.window.showInputBox({
          prompt: 'Enter passphrase', password: true,
          value: config.passphrase || '',
        });
        if (v !== undefined) config.passphrase = v;
      }
    }
  }

  /**
   * Sub-dialog for managing remote paths: add, edit, delete.
   */
  private async manageRemotePaths(config: ConnectionConfig): Promise<void> {
    let managing = true;
    while (managing) {
      const items: vscode.QuickPickItem[] = [
        ...config.mountedPaths.map((mp, i) => ({
          label: `$(folder) ${mp.label}`,
          description: mp.remotePath,
          detail: `$(edit) Edit | $(trash) Delete`,
          index: i,
        })),
        { label: '$(add) Add New Path', description: 'Add another remote path' },
        { label: '$(arrow-left) Back', description: 'Return to connection settings' },
      ];

      const chosen = await vscode.window.showQuickPick(items, {
        placeHolder: `Manage remote paths for "${config.label}"`,
      });

      if (!chosen || chosen.label.includes('Back')) {
        managing = false;
        continue;
      }

      if (chosen.label.includes('Add')) {
        const remotePath = await vscode.window.showInputBox({ prompt: 'Remote path', placeHolder: '/var/www' });
        if (!remotePath) continue;
        const pathLabel = await vscode.window.showInputBox({
          prompt: 'Label for this mount', placeHolder: remotePath.split('/').pop() || remotePath,
          value: remotePath.split('/').pop() || remotePath,
        });
        if (pathLabel === undefined) continue;
        config.mountedPaths.push({ remotePath, label: pathLabel || remotePath });
      } else {
        const idx = (chosen as any).index as number;
        if (idx === undefined) continue;
        const action = await vscode.window.showQuickPick(['Edit', 'Delete'], {
          placeHolder: `"${config.mountedPaths[idx].label}" — Edit or Delete?`,
        });
        if (action === 'Edit') {
          const newLabel = await vscode.window.showInputBox({
            prompt: 'New label', value: config.mountedPaths[idx].label,
          });
          if (newLabel !== undefined) config.mountedPaths[idx].label = newLabel;
          const newPath = await vscode.window.showInputBox({
            prompt: 'New remote path', value: config.mountedPaths[idx].remotePath,
          });
          if (newPath !== undefined) config.mountedPaths[idx].remotePath = newPath;
        } else if (action === 'Delete') {
          config.mountedPaths.splice(idx, 1);
        }
      }
    }
  }

  /**
   * Show delete confirmation dialog.
   */
  async showDeleteConfirmation(connectionLabel: string): Promise<boolean> {
    const choice = await vscode.window.showWarningMessage(
      `Are you sure you want to delete connection "${connectionLabel}"?`,
      { modal: true },
      'Delete',
      'Cancel',
    );
    return choice === 'Delete';
  }

  /**
   * Show connection list QuickPick for management.
   */
  async showConnectionList(connections: ConnectionConfig[]): Promise<ConnectionConfig | undefined> {
    if (connections.length === 0) {
      vscode.window.showInformationMessage('No connections configured. Add one first.');
      return undefined;
    }

    const items = connections.map((conn) => ({
      label: conn.label,
      description: `${conn.protocol}://${conn.host}:${conn.port}`,
      detail: `User: ${conn.username} | Auth: ${conn.authType}`,
      connection: conn,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a connection to manage',
    });

    return selected?.connection;
  }
}
