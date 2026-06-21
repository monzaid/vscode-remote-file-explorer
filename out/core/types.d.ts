/**
 * Shared TypeScript types for all modules of Remote File Explorer.
 */
/** Supported connection protocols */
export type ConnectionProtocol = 'ssh' | 'ftp' | 'agent';
/** Authentication type */
export type AuthType = 'password' | 'key' | 'agent';
/** Connection status */
export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
/** Conflict resolution action */
export type ConflictAction = 'keep-remote' | 'force-overwrite' | 'manual-merge';
/** Connection configuration */
export interface ConnectionConfig {
    id: string;
    label: string;
    protocol: ConnectionProtocol;
    host: string;
    port: number;
    username: string;
    authType: AuthType;
    password?: string;
    privateKeyPath?: string;
    passphrase?: string;
    passphraseStored?: boolean;
    mountedPaths: MountedPath[];
    /** Agent-specific: URL for Agent protocol */
    agentUrl?: string;
    /** Agent-specific: authentication token */
    agentToken?: string;
}
/** Mounted path definition */
export interface MountedPath {
    remotePath: string;
    label: string;
}
/** Remote file stat information */
export interface RemoteFileStat {
    type: 'file' | 'directory' | 'symlink';
    ctime: Date;
    mtime: Date;
    size: number;
    permissions: string;
}
/** Remote file entry (for directory listing) */
export interface RemoteFileEntry {
    name: string;
    path: string;
    stat: RemoteFileStat;
}
/** Search options */
export interface SearchOptions {
    pattern: string;
    caseSensitive?: boolean;
    wholeWord?: boolean;
    maxResults?: number;
    /** Use regex search instead of fixed-string (default: false). Enabling this carries ReDoS risk. */
    useRegex?: boolean;
}
/** Search result */
export interface SearchResult {
    filePath: string;
    lineNumber: number;
    columnNumber: number;
    lineContent: string;
    matchLength: number;
}
/** Shell session interface (only for SSH) */
export interface ShellSession {
    onData: (callback: (data: string) => void) => void;
    write: (data: string) => void;
    resize: (cols: number, rows: number) => void;
    dispose: () => void;
}
/** Conflict detection result — uses content hash, not timestamps */
export interface ConflictResult {
    hasConflict: boolean;
}
/** Local cache file stat */
export interface LocalCacheStat {
    exists: boolean;
    mtime?: Date;
    size?: number;
}
/** Connection event data */
export interface ConnectionStatusEvent {
    connectionId: string;
    status: ConnectionStatus;
    error?: Error;
}
/** Configuration file structure */
export interface RemoteFSConfig {
    version: string;
    connections: ConnectionConfig[];
}
//# sourceMappingURL=types.d.ts.map