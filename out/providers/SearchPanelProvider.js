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
exports.SearchPanelProvider = void 0;
const vscode = __importStar(require("vscode"));
/**
 * WebviewViewProvider that provides a custom HTML search panel
 * for searching files across active remote connections.
 */
class SearchPanelProvider {
    constructor(extensionUri, searchEngine) {
        this.extensionUri = extensionUri;
        this.adapters = new Map();
        this.activeConnections = [];
        this.searchEngine = searchEngine;
    }
    /** Update the list of active connections for the dropdown */
    updateConnections(connections) {
        this.activeConnections = connections;
        this.postMessage({ type: 'connections', data: connections });
    }
    /** Register an adapter for a connection */
    setAdapter(connectionId, adapter) {
        this.adapters.set(connectionId, adapter);
    }
    /** Remove an adapter */
    removeAdapter(connectionId) {
        this.adapters.delete(connectionId);
    }
    resolveWebviewView(webviewView) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };
        webviewView.webview.html = this.getHtml();
        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'search':
                    await this.doSearch(message.connectionId, message.pattern, message.rootPath, message.options);
                    break;
                case 'openFile':
                    await this.openFile(message.connectionId, message.remotePath, message.line, message.column);
                    break;
                case 'ready':
                    this.postMessage({ type: 'connections', data: this.activeConnections });
                    break;
            }
        });
    }
    postMessage(message) {
        this._view?.webview.postMessage(message);
    }
    async doSearch(connectionId, pattern, rootPath, webviewOptions) {
        const adapter = this.adapters.get(connectionId);
        if (!adapter) {
            this.postMessage({ type: 'error', message: 'Connection not found' });
            return;
        }
        try {
            this.postMessage({ type: 'searching', searching: true });
            const searchOptions = {
                pattern,
                caseSensitive: webviewOptions?.caseSensitive,
                wholeWord: webviewOptions?.wholeWord,
                useRegex: webviewOptions?.useRegex,
            };
            const results = await this.searchEngine.search(adapter, rootPath, pattern, searchOptions);
            this.postMessage({
                type: 'results',
                data: results.slice(0, 500).map((r) => ({
                    file: r.filePath,
                    line: r.lineNumber,
                    column: r.columnNumber,
                    content: r.lineContent,
                    match: pattern,
                })),
                connectionId,
            });
        }
        catch (err) {
            this.postMessage({
                type: 'error',
                message: err instanceof Error ? err.message : 'Search failed'
            });
        }
        finally {
            this.postMessage({ type: 'searching', searching: false });
        }
    }
    async openFile(connectionId, remotePath, line, column) {
        const conn = this.activeConnections.find(c => c.id === connectionId);
        if (!conn)
            return;
        const scheme = `remote-${conn.protocol}`;
        const uri = vscode.Uri.parse(`${scheme}://${connectionId}${remotePath}`);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc, {
            preview: false,
            selection: new vscode.Range(line - 1, column - 1, line - 1, column - 1),
        });
        // Reveal the line
        editor.revealRange(new vscode.Range(line - 1, 0, line - 1, 100), vscode.TextEditorRevealType.InCenter);
    }
    getHtml() {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family, sans-serif);
            font-size: var(--vscode-font-size, 13px);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            padding: 0;
            height: 100vh;
            display: flex; flex-direction: column;
        }
        .search-bar {
            padding: 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex; flex-direction: column; gap: 6px;
        }
        .search-row {
            display: flex; gap: 4px;
        }
        .search-input {
            flex: 1;
            padding: 4px 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            font-size: 13px;
        }
        .search-input:focus {
            outline: 1px solid var(--vscode-focusBorder);
            border-color: var(--vscode-focusBorder);
        }
        select, button {
            padding: 4px 8px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-button-secondaryBackground);
            border-radius: 2px;
            cursor: pointer;
            font-size: 12px;
        }
        button:hover { background: var(--vscode-button-secondaryHoverBackground); }
        button.primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-color: var(--vscode-button-background);
        }
        button.primary:hover { background: var(--vscode-button-hoverBackground); }
        .options-row {
            display: flex; gap: 8px; align-items: center; font-size: 12px;
        }
        label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
        input[type="checkbox"] { cursor: pointer; }
        .results {
            flex: 1; overflow-y: auto; padding: 4px 0;
        }
        .result-item {
            padding: 4px 12px; cursor: pointer;
            border-bottom: 1px solid var(--vscode-panel-border, transparent);
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 12px; line-height: 1.5;
        }
        .result-item:hover { background: var(--vscode-list-hoverBackground); }
        .result-file {
            color: var(--vscode-textLink-foreground);
            font-weight: 600;
            margin-bottom: 2px;
        }
        .result-line { color: var(--vscode-descriptionForeground); }
        .result-content {
            white-space: pre; overflow-x: auto;
        }
        .match-highlight {
            background: var(--vscode-editor-findMatchHighlightBackground);
            color: var(--vscode-editor-findMatchHighlightForeground);
            font-weight: bold;
        }
        .status-bar {
            padding: 4px 8px;
            border-top: 1px solid var(--vscode-panel-border);
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
        .spinner {
            display: inline-block; width: 12px; height: 12px;
            border: 2px solid var(--vscode-descriptionForeground);
            border-top-color: var(--vscode-foreground);
            border-radius: 50%;
            animation: spin 0.6s linear infinite;
            margin-right: 4px; vertical-align: middle;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .hidden { display: none !important; }
    </style>
</head>
<body>
    <div class="search-bar">
        <div class="search-row">
            <select id="connectionSelect" style="flex:0 0 auto">
                <option value="">-- Select Connection --</option>
            </select>
            <input class="search-input" id="pathInput" placeholder="Search path (default: /)" value="/" />
        </div>
        <div class="search-row">
            <input class="search-input" id="searchInput" placeholder="Search pattern..." autofocus />
            <button class="primary" id="searchBtn">Search</button>
        </div>
        <div class="options-row">
            <label><input type="checkbox" id="caseSensitive" /> Case</label>
            <label><input type="checkbox" id="wholeWord" /> Word</label>
            <label><input type="checkbox" id="useRegex" /> Regex</label>
            <span style="flex:1"></span>
            <span id="resultCount" class="status-text"></span>
        </div>
    </div>
    <div class="results" id="results">
        <div style="padding:16px;text-align:center;color:var(--vscode-descriptionForeground)">
            Enter a search pattern and press Enter or click Search
        </div>
    </div>
    <div class="status-bar">
        <span id="searchStatus"></span>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let lastConnectionId = '';
        let lastResults = [];

        // Handle Enter key in search input
        document.getElementById('searchInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') doSearch();
        });
        document.getElementById('pathInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') document.getElementById('searchInput').focus();
        });

        document.getElementById('searchBtn').addEventListener('click', doSearch);

        document.getElementById('connectionSelect').addEventListener('change', () => {
            lastConnectionId = document.getElementById('connectionSelect').value;
        });

        function doSearch() {
            const connId = document.getElementById('connectionSelect').value;
            if (!connId) { showError('Please select a connection'); return; }
            const pattern = document.getElementById('searchInput').value;
            if (!pattern) { showError('Please enter a search pattern'); return; }
            const rootPath = document.getElementById('pathInput').value || '/';
            const options = {
                caseSensitive: document.getElementById('caseSensitive').checked,
                wholeWord: document.getElementById('wholeWord').checked,
                useRegex: document.getElementById('useRegex').checked,
            };
            lastConnectionId = connId;
            vscode.postMessage({ type: 'search', connectionId: connId, pattern, rootPath, options });
        }

        function showError(msg) {
            document.getElementById('searchStatus').innerHTML =
                '<span style="color:var(--vscode-errorForeground)">' + msg + '</span>';
        }

        // Handle messages from extension
        window.addEventListener('message', (event) => {
            const msg = event.data;
            switch (msg.type) {
                case 'connections':
                    updateConnections(msg.data);
                    break;
                case 'searching':
                    document.getElementById('searchStatus').innerHTML = msg.searching
                        ? '<span class="spinner"></span> Searching...'
                        : '';
                    break;
                case 'results':
                    lastResults = msg.data;
                    renderResults(msg.data, msg.connectionId);
                    break;
                case 'error':
                    showError(msg.message);
                    break;
            }
        });

        function updateConnections(connections) {
            const sel = document.getElementById('connectionSelect');
            sel.innerHTML = '<option value="">-- Select Connection --</option>';
            connections.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.id + ' (' + c.protocol + ')';
                sel.appendChild(opt);
            });
            if (lastConnectionId) sel.value = lastConnectionId;
        }

        function renderResults(results, connectionId) {
            const container = document.getElementById('results');
            document.getElementById('resultCount').textContent = results.length + ' results';

            if (!results.length) {
                container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--vscode-descriptionForeground)">No results found</div>';
                return;
            }

            // Group by file
            const grouped = {};
            results.forEach(r => {
                if (!grouped[r.file]) grouped[r.file] = [];
                grouped[r.file].push(r);
            });

            let html = '';
            for (const [file, items] of Object.entries(grouped)) {
                html += '<div class="result-file" style="padding:6px 12px;font-size:12px">' +
                    escapeHtml(file) + ' (' + (items as any[]).length + ' matches)</div>';
                (items as any[]).forEach(item => {
                    const matchContent = highlightMatch(item.content, item.match);
                    html += '<div class="result-item" data-file="' + escapeAttr(file) +
                        '" data-line="' + item.line + '" data-column="' + (item.column || 1) +
                        '" data-conn="' + escapeAttr(connectionId) + '" onclick="openResult(this)">' +
                        '<span class="result-line">' + item.line + ':</span> ' +
                        '<span class="result-content">' + matchContent + '</span></div>';
                });
            }
            container.innerHTML = html;
        }

        function highlightMatch(content, match) {
            if (!match) return escapeHtml(content);
            var escaped = escapeHtml(content);
            var matchEscaped = escapeHtml(match);
            // Escape regex special characters in the match string
            var specialsRe = /[.*+?^\${}()|[\\]\\\\]/g;
            var safeMatch = matchEscaped.replace(specialsRe, '\\\\$&');
            var regex = new RegExp('(' + safeMatch + ')', 'gi');
            return escaped.replace(regex, '<span class="match-highlight">$1</span>');
        }

        function escapeHtml(str) {
            return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        }
        function escapeAttr(str) {
            return str.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        }

        // Make openResult global for onclick
        window.openResult = function(el) {
            const file = el.dataset.file;
            const line = parseInt(el.dataset.line) || 1;
            const column = parseInt(el.dataset.column) || 1;
            const connId = el.dataset.conn;
            vscode.postMessage({ type: 'openFile', connectionId: connId, remotePath: file, line, column });
        };

        // Signal ready
        vscode.postMessage({ type: 'ready' });
    </script>
</body>
</html>`;
    }
}
exports.SearchPanelProvider = SearchPanelProvider;
SearchPanelProvider.viewType = 'remote-fs-search.view';
//# sourceMappingURL=SearchPanelProvider.js.map