"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectionDialog = void 0;
const vscode = __importStar(require("vscode"));
/**
 * Manages connection add/edit/delete UI dialogs using VSCode InputBox and QuickPick.
 */
class ConnectionDialog {
    /**
     * Show the add connection dialog with multi-step input.
     */
    async showAddConnectionDialog() {
        // Step 1: Select protocol
        const protocol = await vscode.window.showQuickPick([
            { label: 'SSH/SFTP', description: 'Secure Shell connection', value: 'ssh' },
            { label: 'FTP', description: 'File Transfer Protocol', value: 'ftp' },
            { label: 'FTPS (Explicit)', description: 'FTP over TLS (explicit)', value: 'ftp' },
            { label: 'FTPS (Implicit)', description: 'FTP over TLS (implicit)', value: 'ftp' },
            { label: 'Agent', description: 'Custom Agent protocol', value: 'agent' },
        ], { placeHolder: 'Select connection protocol' });
        if (!protocol)
            return undefined;
        // Step 2: Host
        const host = await vscode.window.showInputBox({
            prompt: 'Enter hostname or IP address',
            placeHolder: '192.168.1.100',
            validateInput: (value) => (!value ? 'Host is required' : undefined),
        });
        if (host === undefined)
            return undefined;
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
                const num = parseInt(value, 10);
                return isNaN(num) || num < 1 || num > 65535 ? 'Invalid port number' : undefined;
            },
        });
        if (portStr === undefined)
            return undefined;
        const port = parseInt(portStr || defaultPort, 10);
        // Step 4: Username
        const username = await vscode.window.showInputBox({
            prompt: 'Enter username',
            placeHolder: 'root',
            validateInput: (value) => (!value ? 'Username is required' : undefined),
        });
        if (username === undefined)
            return undefined;
        if (!username) {
            vscode.window.showErrorMessage('Username is required');
            return undefined;
        }
        // Step 5: Auth type
        const authType = await vscode.window.showQuickPick([
            { label: 'Password', description: 'Authenticate with password', value: 'password' },
            { label: 'Private Key', description: 'Authenticate with SSH key', value: 'key' },
        ], { placeHolder: 'Select authentication method' });
        if (!authType)
            return undefined;
        // Step 6: Password/Key
        let password;
        let privateKeyPath;
        if (authType.value === 'password') {
            password = await vscode.window.showInputBox({
                prompt: 'Enter password',
                password: true,
                placeHolder: 'Password (stored securely)',
            });
            if (password === undefined)
                return undefined;
        }
        else {
            const keyUris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectMany: false,
                openLabel: 'Select Private Key',
                filters: { 'All Files': ['*'] },
            });
            if (!keyUris || keyUris.length === 0)
                return undefined;
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
        if (label === undefined)
            return undefined;
        // Step 8: Mounted paths (optional)
        const mountedPaths = [];
        let addMore = true;
        while (addMore) {
            const remotePath = await vscode.window.showInputBox({
                prompt: 'Enter remote path to mount (leave empty to skip)',
                placeHolder: '/var/www',
            });
            if (!remotePath)
                break;
            const pathLabel = await vscode.window.showInputBox({
                prompt: 'Enter label for this mount',
                placeHolder: remotePath.split('/').pop() || remotePath,
                value: remotePath.split('/').pop() || remotePath,
            });
            if (pathLabel === undefined)
                break;
            mountedPaths.push({ remotePath, label: pathLabel || remotePath });
            const more = await vscode.window.showQuickPick(['Add another path', 'Done'], {
                placeHolder: 'Add another mounted path?',
            });
            if (more !== 'Add another path')
                addMore = false;
        }
        // Generate ID
        const id = `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const config = {
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
     * Show edit connection dialog (pre-filled with existing values).
     */
    async showEditConnectionDialog(existing) {
        // For simplicity, show a QuickPick of fields to edit
        const field = await vscode.window.showQuickPick([
            { label: 'Label', description: existing.label },
            { label: 'Host', description: existing.host },
            { label: 'Port', description: String(existing.port) },
            { label: 'Username', description: existing.username },
            { label: 'Change Password', description: 'Update stored password' },
        ], { placeHolder: 'Select field to edit' });
        if (!field)
            return undefined;
        const updated = { ...existing };
        switch (field.label) {
            case 'Label':
                const label = await vscode.window.showInputBox({ prompt: 'New label', value: existing.label });
                if (label)
                    updated.label = label;
                break;
            case 'Host':
                const host = await vscode.window.showInputBox({ prompt: 'New host', value: existing.host });
                if (host)
                    updated.host = host;
                break;
            case 'Port':
                const portStr = await vscode.window.showInputBox({ prompt: 'New port', value: String(existing.port) });
                if (portStr)
                    updated.port = parseInt(portStr, 10);
                break;
            case 'Username':
                const username = await vscode.window.showInputBox({ prompt: 'New username', value: existing.username });
                if (username)
                    updated.username = username;
                break;
            case 'Change Password':
                const password = await vscode.window.showInputBox({ prompt: 'New password', password: true });
                if (password !== undefined)
                    updated.password = password;
                break;
        }
        return updated;
    }
    /**
     * Show delete confirmation dialog.
     */
    async showDeleteConfirmation(connectionLabel) {
        const choice = await vscode.window.showWarningMessage(`Are you sure you want to delete connection "${connectionLabel}"?`, { modal: true }, 'Delete', 'Cancel');
        return choice === 'Delete';
    }
    /**
     * Show connection list QuickPick for management.
     */
    async showConnectionList(connections) {
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
exports.ConnectionDialog = ConnectionDialog;
//# sourceMappingURL=ConnectionDialog.js.map