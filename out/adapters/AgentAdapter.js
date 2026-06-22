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
exports.AgentAdapter = void 0;
const http = __importStar(require("http"));
const https = __importStar(require("https"));
/** Maximum response size to prevent memory exhaustion (100MB) */
const MAX_RESPONSE_SIZE = 100 * 1024 * 1024;
/** Maximum allowed path length to prevent path traversal attacks */
const MAX_PATH_LENGTH = 4096;
/**
 * Agent protocol adapter using HTTP/WebSocket communication.
 * Connects to a custom agent server that provides file system operations via REST API.
 */
class AgentAdapter {
    constructor() {
        this.config = null;
        this.connected = false;
        this.baseUrl = '';
        this.token = '';
        // P2-3: Connection pool agents for HTTP keep-alive reuse
        // P2-1: Agents are lazily created on first connect to avoid idle pools
        this.httpAgent = null;
        this.httpsAgent = null;
        // P1-3: Security flags
        this.agentSecure = true;
        this.allowLocalhost = false;
        // P2-1: Agents created lazily in getOrCreateAgents()
    }
    /**
     * P2-1: Lazily create or return existing connection-pooled agents.
     */
    getOrCreateAgents() {
        if (!this.httpAgent) {
            this.httpAgent = new http.Agent({
                keepAlive: true,
                maxSockets: 10,
                keepAliveMsecs: 30000,
            });
        }
        if (!this.httpsAgent) {
            this.httpsAgent = new https.Agent({
                keepAlive: true,
                maxSockets: 10,
                keepAliveMsecs: 30000,
            });
        }
        return { httpAgent: this.httpAgent, httpsAgent: this.httpsAgent };
    }
    /**
     * P1-2: Validate a file path to prevent path traversal attacks.
     * Rejects paths containing '..', null bytes, or exceeding maximum length.
     */
    validatePath(path) {
        if (!path || typeof path !== 'string') {
            throw new Error('Path validation failed: path must be a non-empty string');
        }
        // Reject null bytes (path traversal / null byte injection)
        if (path.includes('\0')) {
            throw new Error('Path validation failed: path contains null bytes');
        }
        // Reject path traversal sequences
        if (path.includes('..')) {
            throw new Error('Path validation failed: path traversal detected (..)');
        }
        // P2-2: Reject Windows absolute paths (C:\, \\server\share)
        // Agent servers may run on Windows; these paths could bypass path restrictions.
        if (/^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\')) {
            throw new Error('Path validation failed: Windows absolute paths not allowed');
        }
        // Reject excessively long paths
        if (path.length > MAX_PATH_LENGTH) {
            throw new Error(`Path validation failed: path exceeds maximum length of ${MAX_PATH_LENGTH} characters`);
        }
        // Reject paths that are only whitespace
        if (path.trim().length === 0) {
            throw new Error('Path validation failed: path is empty or whitespace only');
        }
    }
    /**
     * P1-3: Validate the agent host to prevent SSRF attacks.
     * Rejects localhost/loopback addresses unless explicitly allowed.
     */
    validateHost(host) {
        if (!host || typeof host !== 'string') {
            throw new Error('Host validation failed: host must be a non-empty string');
        }
        const normalizedHost = host.toLowerCase().trim();
        // Check for localhost/loopback addresses
        const localhostNames = ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'];
        if (localhostNames.includes(normalizedHost)) {
            if (!this.allowLocalhost) {
                throw new Error('Host validation failed: connection to localhost/loopback is not allowed. ' +
                    'Set remote-fs.agent.allowLocalhost to true to enable.');
            }
        }
        // Check for private network ranges (additional SSRF protection)
        if (/^\d+\.\d+\.\d+\.\d+$/.test(normalizedHost)) {
            const parts = normalizedHost.split('.').map(Number);
            if (parts.length === 4 && parts.every(p => p >= 0 && p <= 255)) {
                // 10.0.0.0/8
                if (parts[0] === 10) {
                    if (!this.allowLocalhost) {
                        throw new Error('Host validation failed: connection to private network (10.0.0.0/8) is not allowed. ' +
                            'Set remote-fs.agent.allowLocalhost to true to enable.');
                    }
                }
                // 172.16.0.0/12
                if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
                    if (!this.allowLocalhost) {
                        throw new Error('Host validation failed: connection to private network (172.16.0.0/12) is not allowed. ' +
                            'Set remote-fs.agent.allowLocalhost to true to enable.');
                    }
                }
                // 192.168.0.0/16
                if (parts[0] === 192 && parts[1] === 168) {
                    if (!this.allowLocalhost) {
                        throw new Error('Host validation failed: connection to private network (192.168.0.0/16) is not allowed. ' +
                            'Set remote-fs.agent.allowLocalhost to true to enable.');
                    }
                }
                // P2-3: 169.254.0.0/16 (link-local, APIPA)
                if (parts[0] === 169 && parts[1] === 254) {
                    if (!this.allowLocalhost) {
                        throw new Error('Host validation failed: connection to link-local network (169.254.0.0/16) is not allowed. ' +
                            'Set remote-fs.agent.allowLocalhost to true to enable.');
                    }
                }
            }
        }
        // P2-3: IPv6 private / link-local address check (simplified prefix matching)
        // ULA: fc00::/7  — starts with "fc" or "fd"
        // Link-local: fe80::/10 — starts with "fe8", "fe9", "fea", "feb"
        const lowerHost = normalizedHost.toLowerCase();
        if (lowerHost.startsWith('[') && lowerHost.endsWith(']')) {
            const ipv6 = lowerHost.slice(1, -1);
            // IPv6 ULA (fc00::/7)
            if (/^fc/i.test(ipv6) || /^fd/i.test(ipv6)) {
                if (!this.allowLocalhost) {
                    throw new Error('Host validation failed: connection to IPv6 ULA (fc00::/7) is not allowed. ' +
                        'Set remote-fs.agent.allowLocalhost to true to enable.');
                }
            }
            // IPv6 link-local (fe80::/10)
            if (/^fe[89ab]/i.test(ipv6)) {
                if (!this.allowLocalhost) {
                    throw new Error('Host validation failed: connection to IPv6 link-local (fe80::/10) is not allowed. ' +
                        'Set remote-fs.agent.allowLocalhost to true to enable.');
                }
            }
        }
        // Reject hostnames with null bytes or invalid characters
        if (normalizedHost.includes('\0') || normalizedHost.includes('\n') || normalizedHost.includes('\r')) {
            throw new Error('Host validation failed: host contains invalid control characters');
        }
        // P2-3: DNS rebinding defense note —
        // This validation happens once at connect() time. DNS rebinding attacks
        // could cause a hostname to resolve to a private IP after validation.
        // For production deployments, consider re-resolving the hostname before
        // each request and validating the resolved IP address against this list.
    }
    /**
     * P1-3: Validate a full URL string for format correctness.
     */
    validateUrl(urlStr) {
        try {
            const parsed = new URL(urlStr);
            // Must be http or https
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                throw new Error(`URL validation failed: unsupported protocol "${parsed.protocol}"`);
            }
            // Validate the host portion
            this.validateHost(parsed.hostname);
        }
        catch (err) {
            if (err instanceof Error && err.message.startsWith('Host validation failed')) {
                throw err;
            }
            if (err instanceof Error && err.message.startsWith('URL validation failed')) {
                throw err;
            }
            throw new Error(`URL validation failed: invalid URL format - "${urlStr}"`);
        }
    }
    /**
     * Establish connection to the agent server.
     * Performs a health check to verify connectivity.
     */
    async connect(config) {
        this.config = config;
        // P1-3: Read allowLocalhost from config (via ConnectionConfig extension or default)
        this.allowLocalhost = config['remote-fs.agent.allowLocalhost'] === true;
        // Determine protocol and security
        if (config.agentUrl) {
            // P1-3: User-provided agentUrl — validate format
            this.validateUrl(config.agentUrl);
            this.baseUrl = config.agentUrl.replace(/\/$/, '');
            this.agentSecure = this.baseUrl.startsWith('https://');
        }
        else {
            // P1-3: Construct URL from host/port — validate host first
            this.validateHost(config.host);
            // P2-1: Default to HTTPS unless agentSecure explicitly set to false
            // Check if user explicitly requested insecure via config
            const explicitSecure = config.agentSecure;
            this.agentSecure = explicitSecure !== undefined ? explicitSecure : true;
            const protocol = this.agentSecure ? 'https' : 'http';
            this.baseUrl = `${protocol}://${config.host}:${config.port}`;
        }
        this.token = config.agentToken || '';
        // P2-1: Warn if using HTTP with token (plaintext transmission)
        if (!this.agentSecure && this.token) {
            console.warn('[SECURITY WARNING] Agent Token is being transmitted over HTTP (plaintext). ' +
                'Consider enabling HTTPS or setting agentSecure to true.');
        }
        // Health check
        try {
            await this.apiRequest('GET', '/api/health');
            this.connected = true;
        }
        catch (err) {
            this.connected = false;
            throw new Error(`Agent connection failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    }
    /**
     * Disconnect from the agent server.
     */
    async disconnect() {
        this.connected = false;
        this.config = null;
        this.token = '';
        // P2-1: Destroy connection pool agents to prevent socket leaks
        // on multiple connect/disconnect cycles. Agents will be recreated
        // lazily on the next connect() call.
        if (this.httpAgent) {
            this.httpAgent.destroy();
            this.httpAgent = null;
        }
        if (this.httpsAgent) {
            this.httpsAgent.destroy();
            this.httpsAgent = null;
        }
    }
    /**
     * Check if connected.
     */
    isConnected() {
        return this.connected;
    }
    /**
     * Make an HTTP request to the agent API.
     * P2-3: Uses connection-pooled agents for keep-alive.
     * P2-9: Enforces response size limit and handles redirects.
     */
    apiRequest(method, endpoint, body, redirectCount = 0) {
        const MAX_REDIRECTS = 5;
        return new Promise((resolve, reject) => {
            const url = new URL(endpoint, this.baseUrl);
            const isHttps = url.protocol === 'https:';
            const httpModule = isHttps ? https : http;
            const headers = {
                'Content-Type': 'application/json',
            };
            if (this.token) {
                headers['Authorization'] = `Bearer ${this.token}`;
            }
            const agents = this.getOrCreateAgents();
            const options = {
                method,
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search,
                headers,
                timeout: 30000,
                // P2-3: Use connection-pooled agent for keep-alive reuse
                agent: isHttps ? agents.httpsAgent : agents.httpAgent,
            };
            const req = httpModule.request(options, (res) => {
                // SECURITY: Redirects only change path, never host.
                // The original baseUrl host (validated in connect()) is always used.
                // If future changes allow redirect to different hosts, re-validate host here.
                // P2-9: Handle redirects (301, 302, 307, 308)
                if (res.statusCode &&
                    [301, 302, 307, 308].includes(res.statusCode) &&
                    res.headers.location) {
                    if (redirectCount >= MAX_REDIRECTS) {
                        reject(new Error('Agent API error: too many redirects'));
                        return;
                    }
                    // Consume the response body to free the socket back to the pool
                    res.resume();
                    const redirectUrl = res.headers.location;
                    // Handle relative vs absolute redirect URLs
                    let resolvedEndpoint;
                    try {
                        const redirectParsed = new URL(redirectUrl, this.baseUrl);
                        resolvedEndpoint = redirectParsed.pathname + redirectParsed.search;
                    }
                    catch {
                        resolvedEndpoint = redirectUrl;
                    }
                    this.apiRequest(method, resolvedEndpoint, body, redirectCount + 1)
                        .then(resolve)
                        .catch(reject);
                    return;
                }
                // P3: Check Content-Length header before accumulating response body.
                // Reject early if the declared size exceeds the limit to avoid
                // unnecessary memory allocation and data transfer.
                const contentLength = res.headers['content-length'];
                if (contentLength) {
                    const len = parseInt(contentLength, 10);
                    if (!isNaN(len) && len > MAX_RESPONSE_SIZE) {
                        req.destroy();
                        reject(new Error(`Agent API response Content-Length ${len} exceeds maximum ${MAX_RESPONSE_SIZE} bytes`));
                        return;
                    }
                }
                // P2-9: Track response size to prevent memory exhaustion
                let dataSize = 0;
                const chunks = [];
                res.on('data', (chunk) => {
                    dataSize += chunk.length;
                    if (dataSize > MAX_RESPONSE_SIZE) {
                        // P2-9: Exceeded max size — destroy the request
                        req.destroy();
                        reject(new Error(`Agent API response exceeds maximum size of ${MAX_RESPONSE_SIZE} bytes`));
                        return;
                    }
                    chunks.push(chunk);
                });
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            // P2-9: Use Buffer.concat for reliable binary-to-string conversion
                            const data = Buffer.concat(chunks).toString('utf-8');
                            // Only parse if there's actual content (handle empty responses)
                            if (data.trim().length > 0) {
                                try {
                                    resolve(JSON.parse(data));
                                }
                                catch {
                                    resolve(data);
                                }
                            }
                            else {
                                resolve(undefined);
                            }
                        }
                        catch (err) {
                            reject(new Error(`Agent API response processing failed: ${err instanceof Error ? err.message : 'Unknown error'}`));
                        }
                    }
                    else {
                        const errorBody = Buffer.concat(chunks).toString('utf-8');
                        reject(new Error(`Agent API error: ${res.statusCode} ${errorBody}`));
                    }
                });
                res.on('error', (err) => {
                    reject(new Error(`Agent API response error: ${err.message}`));
                });
            });
            req.on('error', (err) => {
                reject(new Error(`Agent API request failed: ${err.message}`));
            });
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Agent API request timeout'));
            });
            if (body) {
                req.write(JSON.stringify(body));
            }
            req.end();
        });
    }
    /**
     * Map agent API response to RemoteFileStat.
     */
    mapStat(data) {
        return {
            type: data.type || 'file',
            ctime: data.ctime ? new Date(data.ctime) : new Date(),
            mtime: data.mtime ? new Date(data.mtime) : new Date(),
            size: data.size || 0,
            permissions: data.permissions || '----------',
        };
    }
    /**
     * Get file/directory stat.
     */
    async stat(path) {
        this.validatePath(path);
        const data = await this.apiRequest('POST', '/api/stat', { path });
        return this.mapStat(data);
    }
    /**
     * List directory contents.
     */
    async readDirectory(dirPath) {
        this.validatePath(dirPath);
        const data = await this.apiRequest('POST', '/api/list', { path: dirPath });
        if (!Array.isArray(data)) {
            throw new Error('Invalid response from agent /api/list');
        }
        return data.map((entry) => ({
            name: entry.name,
            path: entry.path,
            stat: this.mapStat(entry.stat || entry),
        }));
    }
    /**
     * Read file contents.
     */
    async readFile(filePath) {
        this.validatePath(filePath);
        const data = await this.apiRequest('POST', '/api/read', { path: filePath });
        // Response could be base64 encoded
        if (typeof data === 'string') {
            return new Uint8Array(Buffer.from(data, 'utf-8'));
        }
        if (data.content) {
            return new Uint8Array(Buffer.from(data.content, data.encoding === 'base64' ? 'base64' : 'utf-8'));
        }
        if (data.data) {
            return new Uint8Array(Buffer.from(data.data, 'base64'));
        }
        throw new Error('Invalid response from agent /api/read');
    }
    /**
     * Write file contents.
     */
    async writeFile(filePath, content) {
        this.validatePath(filePath);
        await this.apiRequest('POST', '/api/write', {
            path: filePath,
            content: Buffer.from(content).toString('base64'),
            encoding: 'base64',
        });
    }
    /**
     * Delete file or directory.
     */
    async delete(targetPath, recursive) {
        this.validatePath(targetPath);
        await this.apiRequest('POST', '/api/delete', {
            path: targetPath,
            recursive: recursive || false,
        });
    }
    /**
     * Rename/move file or directory.
     */
    async rename(oldPath, newPath) {
        this.validatePath(oldPath);
        this.validatePath(newPath);
        await this.apiRequest('POST', '/api/rename', {
            oldPath,
            newPath,
        });
    }
    /**
     * Create a new directory.
     */
    async createDirectory(dirPath) {
        this.validatePath(dirPath);
        await this.apiRequest('POST', '/api/mkdir', { path: dirPath });
    }
    /**
     * Search for pattern using agent API.
     */
    async search(rootPath, pattern, options) {
        this.validatePath(rootPath);
        const data = await this.apiRequest('POST', '/api/search', {
            rootPath,
            pattern,
            options,
        });
        if (!Array.isArray(data)) {
            throw new Error('Invalid response from agent /api/search');
        }
        return data.map((item) => ({
            filePath: item.filePath,
            lineNumber: item.lineNumber,
            columnNumber: item.columnNumber || 1,
            lineContent: item.lineContent,
            matchLength: item.matchLength || item.lineContent?.length || 0,
        }));
    }
    /**
     * Shell is not typically supported for Agent connections.
     */
    async createShell() {
        throw new Error('Shell is not supported for Agent connections');
    }
}
exports.AgentAdapter = AgentAdapter;
//# sourceMappingURL=AgentAdapter.js.map