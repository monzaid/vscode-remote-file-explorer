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
exports.SSHAdapter = void 0;
const ssh2_1 = require("ssh2");
const promises_1 = require("fs/promises");
const path = __importStar(require("path"));
/**
 * SSH/SFTP protocol adapter implementation using ssh2 library.
 */
class SSHAdapter {
    constructor() {
        this.client = null;
        this.sftp = null;
        this.config = null;
        this.connected = false;
        this.terminalOnly = false;
    }
    /**
     * Establish SSH connection with SFTP (for file browsing).
     */
    async connect(config) {
        return this.doConnect(config, true);
    }
    /**
     * Establish SSH connection WITHOUT SFTP — for terminal-only use.
     * No FTP/SFTP logic is involved. Only SSH shell is available.
     */
    async connectTerminalOnly(config) {
        return this.doConnect(config, false);
    }
    /** Shared SSH connection logic. `withSftp` controls whether SFTP is initialized. */
    doConnect(config, withSftp) {
        this.config = config;
        return new Promise((resolve, reject) => {
            this.client = new ssh2_1.Client();
            let settled = false;
            const sshConfig = {
                host: config.host,
                port: config.port || 22,
                username: config.username,
                readyTimeout: 60000,
                keepaliveInterval: 10000,
                debug: (message) => {
                    console.log(`[ssh2 debug] ${message}`);
                },
            };
            this.client.on('ready', () => {
                if (settled)
                    return;
                settled = true;
                this.connected = true;
                if (withSftp) {
                    this.client.sftp((err, sftp) => {
                        if (err) {
                            console.log(`[ssh2] SFTP session unavailable: ${err.message}`);
                            // SFTP failure is non-fatal — resolve so terminal still works
                        }
                        else {
                            this.sftp = sftp;
                        }
                        this.terminalOnly = !withSftp;
                        resolve();
                    });
                }
                else {
                    // Terminal-only: no SFTP at all
                    this.terminalOnly = true;
                    resolve();
                }
            });
            this.client.on('error', (err) => {
                if (settled)
                    return;
                settled = true;
                this.connected = false;
                reject(new Error(`SSH connection failed: ${err.message}`));
            });
            this.client.on('close', () => {
                this.connected = false;
                this.sftp = null;
            });
            if (config.authType === 'password' && config.password) {
                sshConfig.password = config.password;
            }
            else if (config.authType === 'key') {
                if (config.passphrase) {
                    sshConfig.passphrase = config.passphrase;
                }
                if (config.privateKeyPath) {
                    (0, promises_1.readFile)(config.privateKeyPath)
                        .then((keyData) => {
                        sshConfig.privateKey = keyData;
                        this.client.connect(sshConfig);
                    })
                        .catch((err) => {
                        if (settled)
                            return;
                        settled = true;
                        reject(new Error(`Failed to read private key: ${err.message}`));
                    });
                    return;
                }
            }
            if (!sshConfig.password && !sshConfig.privateKey && !sshConfig.passphrase) {
                settled = true;
                reject(new Error('No authentication method configured for SSH connection'));
                return;
            }
            this.client.connect(sshConfig);
        });
    }
    /**
     * Disconnect from the remote server.
     */
    async disconnect() {
        if (!this.client) {
            return;
        }
        return new Promise((resolve) => {
            this.client.removeAllListeners('close');
            const timer = setTimeout(() => {
                this.client?.destroy();
                this.client = null;
                this.sftp = null;
                this.connected = false;
                this.terminalOnly = false;
                resolve();
            }, 10000);
            this.client.on('close', () => {
                clearTimeout(timer);
                this.client = null;
                this.sftp = null;
                this.connected = false;
                this.terminalOnly = false;
                resolve();
            });
            this.client.end();
        });
    }
    /**
     * Check if the connection is active.
     */
    isConnected() {
        if (this.terminalOnly)
            return this.connected;
        return this.connected && this.sftp !== null;
    }
    /**
     * Ensure SFTP session is available.
     */
    ensureConnected() {
        if (!this.sftp || !this.connected) {
            throw new Error('Not connected');
        }
        return this.sftp;
    }
    /**
     * Map SFTP stats to RemoteFileStat.
     */
    mapStat(sftpStat) {
        const isDirectory = (sftpStat.mode & 0o040000) !== 0;
        const isSymlink = (sftpStat.mode & 0o120000) !== 0;
        // Build permission string
        const permStr = (isDirectory ? 'd' : isSymlink ? 'l' : '-') +
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
            // SSH SFTP protocol does not expose ctime (creation time).
            // Using mtime as best-available approximation.
            ctime: new Date(sftpStat.mtime * 1000),
            mtime: new Date(sftpStat.mtime * 1000),
            size: sftpStat.size,
            permissions: permStr,
        };
    }
    /**
     * Get file/directory stat.
     */
    async stat(filePath) {
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
    async readDirectory(dirPath) {
        const sftp = this.ensureConnected();
        return new Promise((resolve, reject) => {
            sftp.readdir(dirPath, (err, list) => {
                if (err) {
                    reject(new Error(`readdir failed for ${dirPath}: ${err.message}`));
                    return;
                }
                const entries = list
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
    async readFile(filePath) {
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
    async writeFile(filePath, content) {
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
    async delete(targetPath, recursive) {
        const sftp = this.ensureConnected();
        // Helper: recursively delete a directory by reading entries, deleting children, then rmdir.
        const recursiveDelete = (dirPath) => {
            return new Promise((resolve, reject) => {
                sftp.readdir(dirPath, (readErr, entries) => {
                    if (readErr) {
                        reject(new Error(`readdir failed for ${dirPath}: ${readErr.message}`));
                        return;
                    }
                    const children = entries.filter((e) => e.filename !== '.' && e.filename !== '..');
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
                    const onChildDone = (err) => {
                        if (failed)
                            return;
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
                        }
                        else {
                            sftp.unlink(childPath, (unlinkErr) => {
                                if (unlinkErr) {
                                    onChildDone(new Error(`unlink failed for ${childPath}: ${unlinkErr.message}`));
                                }
                                else {
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
                    }
                    else {
                        sftp.rmdir(targetPath, (err) => {
                            if (err) {
                                reject(new Error(`rmdir failed for ${targetPath}: ${err.message}`));
                                return;
                            }
                            resolve();
                        });
                    }
                }
                else {
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
    async rename(oldPath, newPath) {
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
    async createDirectory(dirPath) {
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
    escapeShellArg(value) {
        return value.replace(/'/g, "'\\''");
    }
    /**
     * Validate that a path does not contain shell metacharacters.
     * Allowed: alphanumeric, underscore, dash, dot, forward slash, tilde, spaces, asterisks (globs).
     */
    validateSafePath(value) {
        const safePathPattern = /^[a-zA-Z0-9_\-.\/~\s\*]+$/;
        if (!safePathPattern.test(value)) {
            throw new Error(`Unsafe path rejected: "${value}". Path must not contain shell metacharacters.`);
        }
    }
    /**
     * Validate that a generic argument does not contain dangerous shell metacharacters
     * that could be used for command injection.
     */
    validateSafeArg(value) {
        if (/[;&|`$(){}!#~<>]/.test(value)) {
            throw new Error(`Unsafe search pattern rejected: "${value}"`);
        }
    }
    /**
     * Search for pattern using remote grep/rg.
     */
    async search(rootPath, pattern, options) {
        if (!this.client || !this.connected) {
            throw new Error('Not connected');
        }
        // Validate rootPath against shell metacharacters
        this.validateSafePath(rootPath);
        // Validate pattern against command injection
        this.validateSafeArg(pattern);
        return new Promise((resolve, reject) => {
            let cmd;
            const escapedPattern = this.escapeShellArg(pattern);
            const escapedRootPath = this.escapeShellArg(rootPath);
            // Prefer rg (ripgrep), fallback to grep
            // Default to fixed-string (-F) to prevent ReDoS; only use regex if explicitly requested
            cmd = `which rg > /dev/null 2>&1 && rg --line-number --no-heading --color never `;
            if (!options?.caseSensitive)
                cmd += '-i ';
            if (options?.wholeWord)
                cmd += '-w ';
            if (!options?.useRegex)
                cmd += '-F ';
            cmd += `'${escapedPattern}' '${escapedRootPath}'`;
            cmd += ` || grep -rn --color=never `;
            if (!options?.caseSensitive)
                cmd += '-i ';
            if (options?.wholeWord)
                cmd += '-w ';
            if (!options?.useRegex)
                cmd += '-F ';
            cmd += `'${escapedPattern}' '${escapedRootPath}'`;
            // P3 fix: overall search timeout via Promise.race.
            // Timer is reset on each data event to avoid killing a slow-but-active search.
            let timeoutTimer = null;
            const resetTimeout = () => {
                if (timeoutTimer)
                    clearTimeout(timeoutTimer);
                timeoutTimer = setTimeout(() => {
                    timeoutTimer = null;
                    reject(new Error(`Search timed out after ${SSHAdapter.SEARCH_TIMEOUT / 1000}s`));
                }, SSHAdapter.SEARCH_TIMEOUT);
            };
            resetTimeout(); // start initial timeout
            this.client.exec(cmd, (err, stream) => {
                if (err) {
                    if (timeoutTimer)
                        clearTimeout(timeoutTimer);
                    reject(new Error(`search exec failed: ${err.message}`));
                    return;
                }
                let output = '';
                let errorOutput = '';
                const MAX_OUTPUT_SIZE = 10 * 1024 * 1024; // 10MB
                stream.on('data', (data) => {
                    resetTimeout(); // keep-alive: data is flowing, reset the timeout
                    if (output.length < MAX_OUTPUT_SIZE) {
                        output += data.toString();
                    }
                });
                stream.stderr.on('data', (data) => {
                    errorOutput += data.toString();
                });
                stream.on('close', (code) => {
                    if (timeoutTimer)
                        clearTimeout(timeoutTimer);
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
                    }
                    else {
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
    parseSearchOutput(output) {
        const lines = output.trim().split('\n').filter((l) => l.length > 0);
        const results = [];
        for (const line of lines) {
            // Format: file:line:content or file:line:column:content
            // Use indexOf instead of split(':') to handle paths with colons (e.g. C:\...)
            const firstColon = line.indexOf(':');
            if (firstColon === -1)
                continue;
            const filePath = line.substring(0, firstColon);
            const rest = line.substring(firstColon + 1);
            const secondColon = rest.indexOf(':');
            if (secondColon === -1)
                continue;
            const lineStr = rest.substring(0, secondColon);
            const lineNumber = parseInt(lineStr, 10);
            if (isNaN(lineNumber))
                continue;
            // Check if the next part is a column number
            const afterLine = rest.substring(secondColon + 1);
            const thirdColon = afterLine.indexOf(':');
            let columnNumber = 1;
            let lineContent;
            const possibleColumn = thirdColon > 0 ? afterLine.substring(0, thirdColon) : '';
            const columnNum = parseInt(possibleColumn, 10);
            if (!isNaN(columnNum) && possibleColumn.length <= 4) {
                // This is likely a column number (column numbers are 1-9999)
                columnNumber = columnNum;
                lineContent = afterLine.substring(thirdColon + 1);
            }
            else {
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
    async createShell() {
        if (!this.client || !this.connected) {
            throw new Error('Not connected');
        }
        return new Promise((resolve, reject) => {
            this.client.shell((err, stream) => {
                if (err) {
                    reject(new Error(`shell creation failed: ${err.message}`));
                    return;
                }
                const shellSession = {
                    onData: (callback) => {
                        stream.on('data', (data) => {
                            callback(data.toString());
                        });
                    },
                    write: (data) => {
                        stream.write(data);
                    },
                    resize: (cols, rows) => {
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
exports.SSHAdapter = SSHAdapter;
/** P3 fix: search command timeout (ms). Large directories or stale mounts
 * can cause grep/rg to hang indefinitely. */
SSHAdapter.SEARCH_TIMEOUT = 60000; // 60s
//# sourceMappingURL=SSHAdapter.js.map