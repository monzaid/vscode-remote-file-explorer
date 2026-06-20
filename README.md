# Remote File Explorer

A VSCode extension for browsing, editing, and managing files on remote servers via SSH/SFTP, FTP/FTPS, and custom Agent protocols.

## Features

- 🌲 **Sidebar TreeView** — Browse remote directories in a familiar file tree interface
- ✏️ **Remote Editing** — Open and edit remote files using VSCode's native editor via FileSystemProvider
- 🔍 **Remote Search** — Search file contents using grep/ripgrep on the remote server
- 🖥️ **SSH Terminal** — Open integrated terminals connected to remote servers
- 🔒 **Credential Security** — Passwords and keys stored in system keychain via VSCode SecretStorage
- ⚠️ **Conflict Detection** — Detects when remote files have changed and offers 3 resolution options
- 📊 **Status Bar** — Connection status indicator with quick sync/upload buttons
- 🔐 **Permission Icons** — Read-only files marked with 🔒 icon
- 🔄 **Auto Reconnect** — Exponential backoff reconnection on disconnect
- 🐳 **Docker Test Environment** — Full SSH + FTP test infrastructure

## Installation

### From VSIX

```bash
npm run package
code --install-extension remote-file-explorer-0.1.0.vsix
```

### From Source

```bash
git clone <repo-url>
cd remote-file-explorer
npm install
npm run compile
```

Then press F5 in VSCode to launch Extension Development Host.

## Quick Start

1. Click the **Remote Explorer** icon in the sidebar
2. Click **+** to add a new connection
3. Select **SSH/SFTP** protocol
4. Enter your server hostname, port, username, and password
5. Enter a remote path to mount (e.g., `/var/www`)
6. Click **Connect** to browse your remote files
7. Click any file to open it in the editor
8. Edit and save — changes are automatically uploaded

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `remote-fs.maxFileSize` | 104857600 (100MB) | Maximum file size to open |
| `remote-fs.warnFileSize` | 5242880 (5MB) | File size threshold for warning |
| `remote-fs.cacheMaxSize` | 524288000 (500MB) | Maximum local cache size |
| `remote-fs.autoReconnect` | true | Auto-reconnect on disconnect |
| `remote-fs.reconnectMaxAttempts` | 3 | Max reconnection attempts |
| `remote-fs.connectTimeout` | 30000 | Connection timeout in ms |

## Protocol Support

| Feature | SSH/SFTP | FTP/FTPS | Agent |
|---------|----------|----------|-------|
| Browse files | ✅ | ✅ | ✅ |
| Read/Write files | ✅ | ✅ | ✅ |
| Create/Delete dirs | ✅ | ✅ | ✅ |
| Rename files | ✅ | ✅ | ✅ |
| Search (grep/rg) | ✅ | ❌ | ✅ |
| SSH Terminal | ✅ | ❌ | ❌ |

## Development

### Prerequisites

- Node.js 18+
- VSCode ^1.74.0
- Docker (for integration tests)

### Setup

```bash
npm install
npm run compile
```

### Testing

```bash
# Unit tests
npm run test:unit

# Integration tests (requires Docker)
cd docker && docker compose up -d
npm run test:integration

# E2E tests
npm run test:e2e
```

### Packaging

```bash
npm run package
```

## FAQ

**Q: Connection fails with "Authentication failed"?**
A: Verify your username, password, and port. For key-based auth, ensure the private key path is correct.

**Q: Large files are slow to open?**
A: Files >5MB show a warning. Files >100MB are rejected. Adjust `remote-fs.maxFileSize` to change this limit.

**Q: Can I use FTP with TLS?**
A: Yes, select FTPS (Explicit) or FTPS (Implicit) when adding a connection. Port 990 for implicit FTPS.

## License

MIT
