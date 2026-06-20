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
exports.FTPAdapter = void 0;
const ftp = __importStar(require("basic-ftp"));
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const stream_1 = require("stream");
/** Default socket timeout (ms) for FTP operations */
const FTP_SOCKET_TIMEOUT = 30000;
/** TTL for directory listing cache (ms) */
const DIR_LIST_CACHE_TTL = 5000;
/**
 * FTP/FTPS protocol adapter implementation using basic-ftp library.
 */
class FTPAdapter {
    constructor() {
        this.client = null;
        this.connected = false;
        /** Short-term cache for directory listings to reduce repeated list() calls */
        this.dirListCache = new Map();
    }
    /**
     * Establish FTP/FTPS connection.
     *
     * Security rules:
     * - Port 990 → FTPS (implicit TLS), always enforced with strict cert validation.
     * - Port 21  → plain FTP, blocked by default unless user explicitly enables
     *   `remote-fs.ftp.allowInsecure` in VSCode settings AND confirms a warning dialog.
     */
    async connect(config) {
        this.client = new ftp.Client();
        this.client.ftp.verbose = false;
        const port = config.port || 21;
        const isFtps = port === 990;
        const ftpConfig = {
            host: config.host,
            port,
            user: config.username,
            password: config.password || '',
            secure: isFtps,
        };
        // FTPS (port 990): enforce strict TLS certificate verification
        // secure: true already set above; secureOptions defaults to rejectUnauthorized: true — do NOT override
        if (!isFtps) {
            // Plain FTP (port 21): require explicit user opt-in via VSCode configuration
            const allowInsecure = vscode.workspace
                .getConfiguration('remote-fs.ftp')
                .get('allowInsecure', false);
            if (!allowInsecure) {
                throw new Error('Insecure FTP (port 21) is disabled by default. ' +
                    'Set "remote-fs.ftp.allowInsecure": true in your VSCode settings to enable plain FTP connections.');
            }
            // User has opted in — show a warning dialog for final confirmation
            const choice = await vscode.window.showWarningMessage(`You are connecting to ${config.host}:${port} using unencrypted FTP. ` +
                'Your password and all data will be transmitted in plaintext. Continue?', { modal: true }, 'Connect', 'Cancel');
            if (choice !== 'Connect') {
                this.client = null;
                throw new Error('FTP connection cancelled by user — insecure FTP was declined.');
            }
        }
        // Set socket timeout to prevent indefinite hangs
        this.client.ftp.socket.setTimeout(FTP_SOCKET_TIMEOUT);
        try {
            await this.client.access(ftpConfig);
            this.connected = true;
        }
        catch (err) {
            this.client = null;
            throw new Error(`FTP connection failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    }
    /**
     * Disconnect from FTP server.
     */
    async disconnect() {
        if (this.client) {
            this.client.close();
            this.client = null;
            this.connected = false;
        }
        this.dirListCache.clear();
    }
    /**
     * Check if connected.
     */
    isConnected() {
        return this.connected && this.client !== null && !this.client.closed;
    }
    /**
     * Ensure client is available.
     */
    ensureClient() {
        if (!this.client || !this.connected) {
            throw new Error('Not connected');
        }
        return this.client;
    }
    /**
     * Normalize path to ensure it starts with /.
     */
    normalizePath(p) {
        if (!p.startsWith('/')) {
            return '/' + p;
        }
        return p;
    }
    /**
     * Map FTP file info to RemoteFileStat.
     */
    mapFileInfo(info) {
        const type = info.isDirectory ? 'directory' : info.isSymbolicLink ? 'symlink' : 'file';
        // Build permission string from UnixPermissions (rwx for user/group/world)
        const perm = info.permissions;
        let permStr = info.isDirectory ? 'd' : '-';
        if (perm) {
            permStr += (perm.user & ftp.FileInfo.UnixPermission.Read) ? 'r' : '-';
            permStr += (perm.user & ftp.FileInfo.UnixPermission.Write) ? 'w' : '-';
            permStr += (perm.user & ftp.FileInfo.UnixPermission.Execute) ? 'x' : '-';
            permStr += (perm.group & ftp.FileInfo.UnixPermission.Read) ? 'r' : '-';
            permStr += (perm.group & ftp.FileInfo.UnixPermission.Write) ? 'w' : '-';
            permStr += (perm.group & ftp.FileInfo.UnixPermission.Execute) ? 'x' : '-';
            permStr += (perm.world & ftp.FileInfo.UnixPermission.Read) ? 'r' : '-';
            permStr += (perm.world & ftp.FileInfo.UnixPermission.Write) ? 'w' : '-';
            permStr += (perm.world & ftp.FileInfo.UnixPermission.Execute) ? 'x' : '-';
        }
        else {
            permStr += '---------';
        }
        return {
            type,
            ctime: info.modifiedAt || new Date(),
            mtime: info.modifiedAt || new Date(),
            size: info.size || 0,
            permissions: permStr,
        };
    }
    /**
     * Get a cached directory listing, or fetch and cache a fresh one.
     */
    async getCachedList(client, dirPath) {
        const cached = this.dirListCache.get(dirPath);
        const now = Date.now();
        if (cached && (now - cached.timestamp) < DIR_LIST_CACHE_TTL) {
            return cached.list;
        }
        const list = await client.list(dirPath);
        this.dirListCache.set(dirPath, { list, timestamp: now });
        return list;
    }
    /**
     * Get file/directory stat.
     */
    async stat(filePath) {
        const client = this.ensureClient();
        const normalizedPath = this.normalizePath(filePath);
        try {
            // Try listing the parent directory to find the file
            const parentDir = path.posix.dirname(normalizedPath);
            const fileName = path.posix.basename(normalizedPath);
            // Use cached listing to reduce repeated list() calls (P2-1)
            const list = await this.getCachedList(client, parentDir);
            const fileInfo = list.find((f) => f.name === fileName);
            if (!fileInfo) {
                throw new Error(`File not found: ${normalizedPath}`);
            }
            return this.mapFileInfo(fileInfo);
        }
        catch (err) {
            throw new Error(`stat failed for ${normalizedPath}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    }
    /**
     * List directory contents.
     */
    async readDirectory(dirPath) {
        const client = this.ensureClient();
        const normalizedPath = this.normalizePath(dirPath);
        try {
            // Use cached listing to reduce repeated list() calls (P2-1)
            const list = await this.getCachedList(client, normalizedPath);
            return list
                .filter((info) => info.name !== '.' && info.name !== '..')
                .map((info) => ({
                name: info.name,
                path: path.posix.join(normalizedPath, info.name),
                stat: this.mapFileInfo(info),
            }));
        }
        catch (err) {
            throw new Error(`readDirectory failed for ${normalizedPath}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    }
    /**
     * Read file contents.
     */
    async readFile(filePath) {
        const client = this.ensureClient();
        const normalizedPath = this.normalizePath(filePath);
        try {
            const chunks = [];
            const writable = new stream_1.Writable({
                write(chunk, _encoding, callback) {
                    chunks.push(chunk);
                    callback();
                },
            });
            await client.downloadTo(writable, normalizedPath);
            return new Uint8Array(Buffer.concat(chunks));
        }
        catch (err) {
            throw new Error(`readFile failed for ${normalizedPath}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    }
    /**
     * Write file contents.
     */
    async writeFile(filePath, content) {
        const client = this.ensureClient();
        const normalizedPath = this.normalizePath(filePath);
        try {
            const readable = stream_1.Readable.from(Buffer.from(content));
            await client.uploadFrom(readable, normalizedPath);
            // Invalidate cache for parent directory since its content changed
            this.dirListCache.delete(path.posix.dirname(normalizedPath));
        }
        catch (err) {
            throw new Error(`writeFile failed for ${normalizedPath}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    }
    /**
     * Delete file or directory.
     * Uses client.list to determine type first, avoiding exception-as-control-flow.
     */
    async delete(targetPath, recursive) {
        const client = this.ensureClient();
        const normalizedPath = this.normalizePath(targetPath);
        try {
            // Determine if target is a file or directory by listing its parent
            const parentDir = path.posix.dirname(normalizedPath);
            const targetName = path.posix.basename(normalizedPath);
            let isDirectory = false;
            let exists = false;
            try {
                const list = await this.getCachedList(client, parentDir);
                const entry = list.find((f) => f.name === targetName);
                if (entry) {
                    exists = true;
                    isDirectory = entry.isDirectory;
                }
            }
            catch {
                // If list fails, fall through to direct delete attempt
            }
            if (!exists) {
                // Target not found in listing — attempt direct removal anyway
                // (it might be outside the parent's listing or listing failed)
                await client.remove(normalizedPath);
                this.dirListCache.delete(parentDir);
                return;
            }
            if (isDirectory) {
                if (recursive) {
                    await client.removeDir(normalizedPath);
                }
                else {
                    await client.removeEmptyDir(normalizedPath);
                }
            }
            else {
                await client.remove(normalizedPath);
            }
            // Invalidate cache for parent directory
            this.dirListCache.delete(parentDir);
        }
        catch (err) {
            throw new Error(`delete failed for ${normalizedPath}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    }
    /**
     * Rename/move file or directory.
     */
    async rename(oldPath, newPath) {
        const client = this.ensureClient();
        try {
            await client.rename(this.normalizePath(oldPath), this.normalizePath(newPath));
            // Invalidate cache for both parent directories
            this.dirListCache.delete(path.posix.dirname(this.normalizePath(oldPath)));
            this.dirListCache.delete(path.posix.dirname(this.normalizePath(newPath)));
        }
        catch (err) {
            throw new Error(`rename failed from ${oldPath} to ${newPath}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    }
    /**
     * Create a new directory.
     */
    async createDirectory(dirPath) {
        const client = this.ensureClient();
        const normalizedPath = this.normalizePath(dirPath);
        try {
            await client.ensureDir(normalizedPath);
            // Invalidate cache for parent directory since its content changed
            this.dirListCache.delete(path.posix.dirname(normalizedPath));
        }
        catch (err) {
            throw new Error(`createDirectory failed for ${normalizedPath}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    }
    /**
     * Search is not supported for FTP.
     */
    async search(_rootPath, _pattern, _options) {
        throw new Error('Search is not supported for FTP connections');
    }
    /**
     * Shell is not supported for FTP.
     */
    async createShell() {
        throw new Error('Shell is not supported for FTP connections');
    }
}
exports.FTPAdapter = FTPAdapter;
//# sourceMappingURL=FTPAdapter.js.map