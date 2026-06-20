import { Client, ConnectConfig, SFTPWrapper } from 'ssh2';
import { readFile } from 'fs/promises';
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

/**
 * SSH/SFTP protocol adapter implementation using ssh2 library.
 */
export class SSHAdapter implements IProtocolAdapter {
  private client: Client | null = null;
  private sftp: SFTPWrapper | null = null;
  private config: ConnectionConfig | null = null;
  private connected = false;

  /**
   * Establish SSH connection with password or key authentication.
   */
  async connect(config: ConnectionConfig): Promise<void> {
    this.config = config;

    return new Promise<void>((resolve, reject) => {
      this.client = new Client();
      let settled = false;

      const sshConfig: ConnectConfig = {
        host: config.host,
        port: config.port || 22,
        username: config.username,
        readyTimeout: 60000,
        keepaliveInterval: 10000,
        debug: (message: string) => {
          // Log ssh2-level debug messages for diagnostics
          console.log(`[ssh2 debug] ${message}`);
        },
      };

      // ✅ 1. Register event listeners FIRST (always, before any auth path)
      this.client.on('ready', () => {
        if (settled) return;
        settled = true;
        this.connected = true;
        // Initialize SFTP session
        this.client!.sftp((err, sftp) => {
          if (err) {
            this.connected = false;
            reject(new Error(`SFTP session failed: ${err.message}`));
            return;
          }
          this.sftp = sftp;
          resolve();
        });
      });

      this.client.on('error', (err) => {
        if (settled) return;
        settled = true;
        this.connected = false;
        reject(new Error(`SSH connection failed: ${err.message}`));
      });

      this.client.on('close', () => {
        this.connected = false;
        this.sftp = null;
      });

      // ✅ 2. Auth setup (readFile for key, set password, etc.)
      if (config.authType === 'password' && config.password) {
        sshConfig.password = config.password;
      } else if (config.authType === 'key') {
        // Prefer config.passphrase over config.password for key auth
        // to avoid semantic confusion between login password and key passphrase.
        const keyPassphrase = config.passphrase ?? config.password;
        if (config.privateKeyPath) {
          readFile(config.privateKeyPath)
            .then((keyData) => {
              sshConfig.privateKey = keyData;
              if (keyPassphrase) {
                sshConfig.passphrase = keyPassphrase;
              }
              this.client!.connect(sshConfig);
            })
            .catch((err) => {
              if (settled) return;
              settled = true;
              reject(new Error(`Failed to read private key: ${err.message}`));
            });
          return; // Early return — connect is handled inside the then() callback
        }
        if (keyPassphrase) {
          sshConfig.passphrase = keyPassphrase;
        }
      }

      // ✅ 3. Verify that at least one auth method is configured before connecting
      if (!sshConfig.password && !sshConfig.privateKey && !sshConfig.passphrase) {
        settled = true;
        reject(new Error('No authentication method configured for SSH connection'));
        return;
      }

      // ✅ 4. connect() for non-readFile paths
      this.client.connect(sshConfig);
    });
  }

  /**
   * Disconnect from the remote server.
   */
  async disconnect(): Promise<void> {
    if (!this.client) {
      return;
    }
    return new Promise<void>((resolve) => {
      this.client!.on('close', () => {
        this.client = null;
        this.sftp = null;
        this.connected = false;
        resolve();
      });
      this.client!.end();
    });
  }

  /**
   * Check if the connection is active.
   */
  isConnected(): boolean {
    return this.connected && this.sftp !== null;
  }

  /**
   * Ensure SFTP session is available.
   */
  private ensureConnected(): SFTPWrapper {
    if (!this.sftp || !this.connected) {
      throw new Error('Not connected');
    }
    return this.sftp;
  }

  /**
   * Map SFTP stats to RemoteFileStat.
   */
  private mapStat(sftpStat: any): RemoteFileStat {
    const isDirectory = (sftpStat.mode & 0o040000) !== 0;
    const isSymlink = (sftpStat.mode & 0o120000) !== 0;

    // Build permission string
    const permStr =
      (isDirectory ? 'd' : isSymlink ? 'l' : '-') +
      ((sftpStat.mode & 0o400) ? 'r' : '-') +
      ((sftpStat.mode & 0o200) ? 'w' : '-') +
      ((sftpStat.mode & 0o100) ? 'x' : '-') +
      ((sftpStat.mode & 0o040) ? 'r' : '-') +
      ((sftpStat.mode & 0o020) ? 'w' : '-') +
      ((sftpStat.mode & 0o010) ? 'x' : '-') +
      ((sftpStat.mode & 0o004) ? 'r' : '-') +
      ((sftpStat.mode & 0o002) ? 'w' : '-') +
      ((sftpStat.mode & 0o001) ? 'x' : '-');

    return {
      type: isDirectory ? 'directory' : isSymlink ? 'symlink' : 'file',
      ctime: new Date(sftpStat.mtime * 1000),
      mtime: new Date(sftpStat.mtime * 1000),
      size: sftpStat.size,
      permissions: permStr,
    };
  }

  /**
   * Get file/directory stat.
   */
  async stat(filePath: string): Promise<RemoteFileStat> {
    const sftp = this.ensureConnected();
    return new Promise((resolve, reject) => {
      sftp.stat(filePath, (err, stats) => {
        if (err) {
          reject(new Error(`stat failed for ${filePath}: ${err.message}`));
          return;
        }
        resolve(this.mapStat(stats));
      });
    });
  }

  /**
   * List directory contents.
   */
  async readDirectory(dirPath: string): Promise<RemoteFileEntry[]> {
    const sftp = this.ensureConnected();
    return new Promise((resolve, reject) => {
      sftp.readdir(dirPath, (err, list) => {
        if (err) {
          reject(new Error(`readdir failed for ${dirPath}: ${err.message}`));
          return;
        }
        const entries: RemoteFileEntry[] = list
          .filter((entry) => entry.filename !== '.' && entry.filename !== '..')
          .map((entry) => ({
            name: entry.filename,
            path: path.posix.join(dirPath, entry.filename),
            stat: this.mapStat(entry.attrs),
          }));
        resolve(entries);
      });
    });
  }

  /**
   * Read file contents.
   */
  async readFile(filePath: string): Promise<Uint8Array> {
    const sftp = this.ensureConnected();
    return new Promise((resolve, reject) => {
      sftp.readFile(filePath, (err, data) => {
        if (err) {
          reject(new Error(`readFile failed for ${filePath}: ${err.message}`));
          return;
        }
        resolve(new Uint8Array(data));
      });
    });
  }

  /**
   * Write file contents.
   */
  async writeFile(filePath: string, content: Uint8Array): Promise<void> {
    const sftp = this.ensureConnected();
    return new Promise((resolve, reject) => {
      sftp.writeFile(filePath, Buffer.from(content), (err) => {
        if (err) {
          reject(new Error(`writeFile failed for ${filePath}: ${err.message}`));
          return;
        }
        resolve();
      });
    });
  }

  /**
   * Delete file or directory.
   */
  async delete(targetPath: string, recursive?: boolean): Promise<void> {
    const sftp = this.ensureConnected();

    // Helper: recursively delete a directory by reading entries, deleting children, then rmdir.
    const recursiveDelete = (dirPath: string): Promise<void> => {
      return new Promise<void>((resolve, reject) => {
        sftp.readdir(dirPath, (readErr, entries) => {
          if (readErr) {
            reject(new Error(`readdir failed for ${dirPath}: ${readErr.message}`));
            return;
          }

          const children = entries.filter(
            (e) => e.filename !== '.' && e.filename !== '..'
          );

          if (children.length === 0) {
            // Directory is empty — remove it directly
            sftp.rmdir(dirPath, (rmdirErr) => {
              if (rmdirErr) {
                reject(new Error(`rmdir failed for ${dirPath}: ${rmdirErr.message}`));
                return;
              }
              resolve();
            });
            return;
          }

          // Delete all children, then remove the directory
          let completed = 0;
          let failed = false;

          const onChildDone = (err?: Error) => {
            if (failed) return;
            if (err) {
              failed = true;
              reject(err);
              return;
            }
            completed++;
            if (completed === children.length) {
              // All children deleted, now remove the empty directory
              sftp.rmdir(dirPath, (rmdirErr) => {
                if (rmdirErr) {
                  reject(new Error(`rmdir failed for ${dirPath}: ${rmdirErr.message}`));
                  return;
                }
                resolve();
              });
            }
          };

          for (const entry of children) {
            const childPath = path.posix.join(dirPath, entry.filename);
            const childIsDir = (entry.attrs.mode & 0o040000) !== 0;

            if (childIsDir) {
              recursiveDelete(childPath).then(() => onChildDone()).catch(onChildDone);
            } else {
              sftp.unlink(childPath, (unlinkErr) => {
                if (unlinkErr) {
                  onChildDone(new Error(`unlink failed for ${childPath}: ${unlinkErr.message}`));
                } else {
                  onChildDone();
                }
              });
            }
          }
        });
      });
    };

    return new Promise((resolve, reject) => {
      // Try to stat first to determine type
      sftp.stat(targetPath, (statErr, stats) => {
        if (statErr) {
          reject(new Error(`delete failed for ${targetPath}: ${statErr.message}`));
          return;
        }

        const isDirectory = (stats.mode & 0o040000) !== 0;

        if (isDirectory) {
          if (recursive) {
            recursiveDelete(targetPath).then(resolve).catch(reject);
          } else {
            sftp.rmdir(targetPath, (err) => {
              if (err) {
                reject(new Error(`rmdir failed for ${targetPath}: ${err.message}`));
                return;
              }
              resolve();
            });
          }
        } else {
          sftp.unlink(targetPath, (err) => {
            if (err) {
              reject(new Error(`unlink failed for ${targetPath}: ${err.message}`));
              return;
            }
            resolve();
          });
        }
      });
    });
  }

  /**
   * Rename/move file or directory.
   */
  async rename(oldPath: string, newPath: string): Promise<void> {
    const sftp = this.ensureConnected();
    return new Promise((resolve, reject) => {
      sftp.rename(oldPath, newPath, (err) => {
        if (err) {
          reject(new Error(`rename failed from ${oldPath} to ${newPath}: ${err.message}`));
          return;
        }
        resolve();
      });
    });
  }

  /**
   * Create a new directory.
   */
  async createDirectory(dirPath: string): Promise<void> {
    const sftp = this.ensureConnected();
    return new Promise((resolve, reject) => {
      sftp.mkdir(dirPath, (err) => {
        if (err) {
          reject(new Error(`mkdir failed for ${dirPath}: ${err.message}`));
          return;
        }
        resolve();
      });
    });
  }

  /**
   * Escape a value for safe use inside single-quoted shell strings.
   * Strategy: replace every ' with '\'' (end quote, escaped quote, start quote).
   */
  private escapeShellArg(value: string): string {
    return value.replace(/'/g, "'\\''");
  }

  /**
   * Validate that a path does not contain shell metacharacters.
   * Allowed: alphanumeric, underscore, dash, dot, forward slash, tilde, spaces, asterisks (globs).
   */
  private validateSafePath(value: string): void {
    const safePathPattern = /^[a-zA-Z0-9_\-.\/~\s\*]+$/;
    if (!safePathPattern.test(value)) {
      throw new Error(
        `Unsafe path rejected: "${value}". Path must not contain shell metacharacters.`
      );
    }
  }

  /**
   * Search for pattern using remote grep/rg.
   */
  async search(rootPath: string, pattern: string, options?: SearchOptions): Promise<SearchResult[]> {
    if (!this.client || !this.connected) {
      throw new Error('Not connected');
    }

    // Validate rootPath against shell metacharacters
    this.validateSafePath(rootPath);

    return new Promise((resolve, reject) => {
      let cmd: string;
      const escapedPattern = this.escapeShellArg(pattern);
      const escapedRootPath = this.escapeShellArg(rootPath);
      // Prefer rg (ripgrep), fallback to grep
      // Default to fixed-string (-F) to prevent ReDoS; only use regex if explicitly requested
      cmd = `which rg > /dev/null 2>&1 && rg --line-number --no-heading --color never `;
      if (!options?.caseSensitive) cmd += '-i ';
      if (options?.wholeWord) cmd += '-w ';
      if (!options?.useRegex) cmd += '-F ';
      cmd += `'${escapedPattern}' '${escapedRootPath}'`;
      cmd += ` || grep -rn --color=never `;
      if (!options?.caseSensitive) cmd += '-i ';
      if (options?.wholeWord) cmd += '-w ';
      if (!options?.useRegex) cmd += '-F ';
      cmd += `'${escapedPattern}' '${escapedRootPath}'`;

      this.client!.exec(cmd, (err, stream) => {
        if (err) {
          reject(new Error(`search exec failed: ${err.message}`));
          return;
        }

        let output = '';
        let errorOutput = '';

        stream.on('data', (data: Buffer) => {
          output += data.toString();
        });

        stream.stderr.on('data', (data: Buffer) => {
          errorOutput += data.toString();
        });

        stream.on('close', (code: number) => {
          if (code !== 0 && code !== 1) {
            // grep returns 1 when no matches found — that's fine
            if (code === 1 && !errorOutput) {
              resolve([]);
              return;
            }
            reject(new Error(`search command exited with code ${code}: ${errorOutput}`));
            return;
          }

          const results = this.parseSearchOutput(output);
          if (options?.maxResults && results.length > options.maxResults) {
            resolve(results.slice(0, options.maxResults));
          } else {
            resolve(results);
          }
        });
      });
    });
  }

  /**
   * Parse grep/rg output into SearchResult array.
   * Uses indexOf to correctly handle file paths containing colons.
   */
  private parseSearchOutput(output: string): SearchResult[] {
    const lines = output.trim().split('\n').filter((l) => l.length > 0);
    const results: SearchResult[] = [];

    for (const line of lines) {
      // Format: file:line:content or file:line:column:content
      // Use indexOf instead of split(':') to handle paths with colons (e.g. C:\...)
      const firstColon = line.indexOf(':');
      if (firstColon === -1) continue;

      const filePath = line.substring(0, firstColon);
      const rest = line.substring(firstColon + 1);

      const secondColon = rest.indexOf(':');
      if (secondColon === -1) continue;

      const lineStr = rest.substring(0, secondColon);
      const lineNumber = parseInt(lineStr, 10);
      if (isNaN(lineNumber)) continue;

      // Check if the next part is a column number
      const afterLine = rest.substring(secondColon + 1);
      const thirdColon = afterLine.indexOf(':');
      let columnNumber = 1;
      let lineContent: string;

      const possibleColumn = thirdColon > 0 ? afterLine.substring(0, thirdColon) : '';
      const columnNum = parseInt(possibleColumn, 10);

      if (!isNaN(columnNum) && possibleColumn.length <= 4) {
        // This is likely a column number (column numbers are 1-9999)
        columnNumber = columnNum;
        lineContent = afterLine.substring(thirdColon + 1);
      } else {
        lineContent = afterLine;
      }

      results.push({
        filePath,
        lineNumber,
        columnNumber,
        lineContent: lineContent.trim(),
        matchLength: lineContent.trim().length,
      });
    }

    return results;
  }

  /**
   * Create an interactive shell session.
   */
  async createShell(): Promise<ShellSession> {
    if (!this.client || !this.connected) {
      throw new Error('Not connected');
    }

    return new Promise((resolve, reject) => {
      this.client!.shell((err, stream) => {
        if (err) {
          reject(new Error(`shell creation failed: ${err.message}`));
          return;
        }

        const shellSession: ShellSession = {
          onData: (callback: (data: string) => void) => {
            stream.on('data', (data: Buffer) => {
              callback(data.toString());
            });
          },
          write: (data: string) => {
            stream.write(data);
          },
          resize: (cols: number, rows: number) => {
            stream.setWindow(rows, cols, 0, 0);
          },
          dispose: () => {
            stream.end();
          },
        };

        resolve(shellSession);
      });
    });
  }
}
