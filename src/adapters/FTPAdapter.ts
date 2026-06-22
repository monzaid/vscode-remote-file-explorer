import * as ftp from 'basic-ftp';
import * as vscode from 'vscode';
import { IProtocolAdapter } from '../core/IProtocolAdapter';
import {
  ConnectionConfig,
  RemoteFileStat,
  RemoteFileEntry,
  SearchOptions,
  SearchResult,
  ShellSession,
} from '../core/types';
import * as path from 'path';
import { Readable, Writable } from 'stream';

/** Default socket timeout (ms) for FTP operations */
const FTP_SOCKET_TIMEOUT = 30000;

/** TTL for directory listing cache (ms) */
const DIR_LIST_CACHE_TTL = 5000;

/**
 * FTP/FTPS protocol adapter implementation using basic-ftp library.
 */
export class FTPAdapter implements IProtocolAdapter {
  private client: ftp.Client | null = null;
  private connected = false;

  /** Short-term cache for directory listings to reduce repeated list() calls */
  private dirListCache: Map<string, { list: ftp.FileInfo[]; timestamp: number }> = new Map();

  /**
   * Establish FTP/FTPS connection.
   *
   * Security rules:
   * - Port 990 → FTPS (implicit TLS), always enforced with strict cert validation.
   * - Port 21  → plain FTP, blocked by default unless user explicitly enables
   *   `remote-fs.ftp.allowInsecure` in VSCode settings AND confirms a warning dialog.
   */
  async connect(config: ConnectionConfig): Promise<void> {
    this.client = new ftp.Client();
    this.client.ftp.verbose = false;

    const port = config.port || 21;
    const isFtps = port === 990;

    const ftpConfig: ftp.AccessOptions = {
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
        .get<boolean>('allowInsecure', false);

      if (!allowInsecure) {
        throw new Error(
          'Insecure FTP (port 21) is disabled by default. ' +
            'Set "remote-fs.ftp.allowInsecure": true in your VSCode settings to enable plain FTP connections.',
        );
      }

      // User has opted in — show a warning dialog for final confirmation
      const choice = await vscode.window.showWarningMessage(
        `You are connecting to ${config.host}:${port} using unencrypted FTP. ` +
          'Your password and all data will be transmitted in plaintext. Continue?',
        { modal: true },
        'Connect',
        'Cancel',
      );

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
    } catch (err) {
      this.client = null;
      throw new Error(`FTP connection failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  /**
   * Disconnect from FTP server.
   * basic-ftp: client.close() sends QUIT synchronously, no await needed.
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.close();
      this.client = null;
      this.connected = false;
    }
    this.dirListCache.clear();
  }

  /**
   * Check if connected.
   * P3 simplification: trust this.connected flag (set in connect/disconnect/error)
   * instead of defensive getter call to this.client.closed.
   */
  isConnected(): boolean {
    return this.connected && this.client !== null;
  }

  /**
   * Ensure client is available.
   */
  private ensureClient(): ftp.Client {
    if (!this.client || !this.connected) {
      throw new Error('Not connected');
    }
    return this.client;
  }

  /**
   * Normalize path to ensure it starts with /.
   */
  private normalizePath(p: string): string {
    if (!p.startsWith('/')) {
      return '/' + p;
    }
    return p;
  }

  /**
   * Map FTP file info to RemoteFileStat.
   */
  private mapFileInfo(info: ftp.FileInfo): RemoteFileStat {
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
    } else {
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
  private async getCachedList(client: ftp.Client, dirPath: string): Promise<ftp.FileInfo[]> {
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
  async stat(filePath: string): Promise<RemoteFileStat> {
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
    } catch (err) {
      throw new Error(`stat failed for ${normalizedPath}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  /**
   * List directory contents.
   */
  async readDirectory(dirPath: string): Promise<RemoteFileEntry[]> {
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
    } catch (err) {
      throw new Error(`readDirectory failed for ${normalizedPath}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  /**
   * Read file contents.
   */
  async readFile(filePath: string): Promise<Uint8Array> {
    const client = this.ensureClient();
    const normalizedPath = this.normalizePath(filePath);

    try {
      const chunks: Buffer[] = [];
      const writable = new Writable({
        write(chunk: Buffer, _encoding: string, callback: () => void) {
          chunks.push(chunk);
          callback();
        },
      });

      await client.downloadTo(writable, normalizedPath);
      return new Uint8Array(Buffer.concat(chunks));
    } catch (err) {
      throw new Error(`readFile failed for ${normalizedPath}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  /**
   * Write file contents.
   */
  async writeFile(filePath: string, content: Uint8Array): Promise<void> {
    const client = this.ensureClient();
    const normalizedPath = this.normalizePath(filePath);

    try {
      const readable = Readable.from(Buffer.from(content));
      await client.uploadFrom(readable, normalizedPath);
      // Invalidate cache for parent directory since its content changed
      this.dirListCache.delete(path.posix.dirname(normalizedPath));
    } catch (err) {
      throw new Error(`writeFile failed for ${normalizedPath}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete file or directory.
   * Uses client.list to determine type first, avoiding exception-as-control-flow.
   */
  async delete(targetPath: string, recursive?: boolean): Promise<void> {
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
      } catch {
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
        } else {
          await client.removeEmptyDir(normalizedPath);
        }
      } else {
        await client.remove(normalizedPath);
      }

      // Invalidate cache for parent directory
      this.dirListCache.delete(parentDir);
    } catch (err) {
      throw new Error(`delete failed for ${normalizedPath}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  /**
   * Rename/move file or directory.
   */
  async rename(oldPath: string, newPath: string): Promise<void> {
    const client = this.ensureClient();

    try {
      await client.rename(this.normalizePath(oldPath), this.normalizePath(newPath));
      // Invalidate cache for both parent directories
      this.dirListCache.delete(path.posix.dirname(this.normalizePath(oldPath)));
      this.dirListCache.delete(path.posix.dirname(this.normalizePath(newPath)));
    } catch (err) {
      throw new Error(
        `rename failed from ${oldPath} to ${newPath}: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Create a new directory.
   */
  async createDirectory(dirPath: string): Promise<void> {
    const client = this.ensureClient();
    const normalizedPath = this.normalizePath(dirPath);

    try {
      await client.ensureDir(normalizedPath);
      // Invalidate cache for parent directory since its content changed
      this.dirListCache.delete(path.posix.dirname(normalizedPath));
    } catch (err) {
      throw new Error(`createDirectory failed for ${normalizedPath}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  /**
   * Search is not supported for FTP.
   */
  async search(_rootPath: string, _pattern: string, _options?: SearchOptions): Promise<SearchResult[]> {
    throw new Error('Search is not supported for FTP connections');
  }

  /**
   * Shell is not supported for FTP.
   */
  async createShell(): Promise<ShellSession> {
    throw new Error('Shell is not supported for FTP connections');
  }
}
