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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const ConnectionManager_1 = require("./core/ConnectionManager");
const ConcurrencyController_1 = require("./core/ConcurrencyController");
const LocalCacheManager_1 = require("./core/LocalCacheManager");
const StatusBarManager_1 = require("./ui/StatusBarManager");
const SidebarProvider_1 = require("./providers/SidebarProvider");
const RemoteFSProvider_1 = require("./providers/RemoteFSProvider");
const ConflictResolver_1 = require("./providers/ConflictResolver");
const TerminalManager_1 = require("./terminal/TerminalManager");
const SearchEngine_1 = require("./search/SearchEngine");
const SearchPanelProvider_1 = require("./providers/SearchPanelProvider");
const SSHAdapter_1 = require("./adapters/SSHAdapter");
const ConnectionDialog_1 = require("./ui/ConnectionDialog");
const commandRegistry_1 = require("./commands/commandRegistry");
const menuCommands_1 = require("./commands/menuCommands");
const syncCommands_1 = require("./commands/syncCommands");
/**
 * Activate the extension.
 * Initializes all modules and registers providers, commands, and UI components.
 */
async function activate(context) {
    const outputChannel = vscode.window.createOutputChannel('Remote FS', { log: true });
    context.subscriptions.push(outputChannel);
    outputChannel.info('Remote File Explorer extension activating...');
    // ========================================================================
    // CRITICAL: Register the two essential commands FIRST.
    // These are the commands that trigger extension activation via activationEvents.
    // If they are not registered before any later initialization step throws,
    // the user sees "command 'remote-fs.xxx' not found" and the extension is
    // effectively bricked. By registering them first, we guarantee they are
    // always available even if later initialization fails.
    // ========================================================================
    // Placeholder for objects created during initialization.
    // The real implementations below capture these via closure after init.
    let sidebarProvider = null;
    let connectionDialog = null;
    let connectionManager = null;
    let terminalManager = null;
    // Register refresh first — always safe, always works
    context.subscriptions.push(vscode.commands.registerCommand('remote-fs.refresh', () => {
        if (sidebarProvider) {
            sidebarProvider.refresh();
        }
        else {
            outputChannel.warn('remote-fs.refresh called before initialization complete');
        }
    }));
    // Register addConnection — triggers ConnectionDialog
    context.subscriptions.push(vscode.commands.registerCommand('remote-fs.addConnection', async () => {
        if (!connectionDialog || !connectionManager || !sidebarProvider) {
            outputChannel.error('remote-fs.addConnection called before initialization complete');
            vscode.window.showErrorMessage('Remote FS is still initializing. Please try again in a moment.');
            return;
        }
        const config = await connectionDialog.showAddConnectionDialog();
        if (config) {
            await connectionManager.addConnection(config);
            vscode.window.showInformationMessage(`Connection "${config.label}" added.`);
            sidebarProvider.refresh();
        }
    }));
    // ========================================================================
    // Now perform initialization. If any step fails, the two critical commands
    // above are already registered and will show a user-friendly message.
    // ========================================================================
    try {
        // Initialize RemoteFSProvider static config (one-time with change listener)
        RemoteFSProvider_1.RemoteFSProvider.initConfig(context);
        // Initialize core managers
        connectionManager = new ConnectionManager_1.ConnectionManager(context);
        const cacheManager = new LocalCacheManager_1.LocalCacheManager(context);
        const concurrencyController = new ConcurrencyController_1.ConcurrencyController();
        const statusBarManager = new StatusBarManager_1.StatusBarManager();
        // Initialize UI components
        sidebarProvider = new SidebarProvider_1.SidebarProvider(connectionManager);
        connectionDialog = new ConnectionDialog_1.ConnectionDialog();
        // Initialize search and terminal managers
        const searchEngine = new SearchEngine_1.SearchEngine();
        const searchPanelProvider = new SearchPanelProvider_1.SearchPanelProvider(context.extensionUri, searchEngine);
        terminalManager = new TerminalManager_1.TerminalManager(connectionManager);
        // Register adapter factory
        connectionManager.setAdapterFactory((protocol) => {
            switch (protocol) {
                case 'ssh':
                    return new SSHAdapter_1.SSHAdapter();
                // FTP and Agent adapters will be added in subsequent waves
                default:
                    throw new Error(`Unsupported protocol: ${protocol}`);
            }
        });
        // Load saved configurations
        await connectionManager.loadConfigurations();
        // Register TreeDataProvider for sidebar
        const treeView = vscode.window.createTreeView('remote-fs-explorer', {
            treeDataProvider: sidebarProvider,
            showCollapseAll: true,
        });
        context.subscriptions.push(treeView);
        // Register SearchPanelProvider as a webview view
        context.subscriptions.push(vscode.window.registerWebviewViewProvider(SearchPanelProvider_1.SearchPanelProvider.viewType, searchPanelProvider));
        // Register FileSystemProvider for each active connection
        // (will be dynamically registered when connections are established)
        const fsProviderDisposables = [];
        // Listen for connection status changes to register/unregister FS providers
        connectionManager.onConnectionStatusChange.on('statusChange', async (event) => {
            statusBarManager.updateStatus(event.status, connectionManager.getActiveCount());
            if (event.status === 'connected') {
                const adapter = connectionManager.getAdapter(event.connectionId);
                if (adapter) {
                    // Determine protocol for this connection
                    const connConfig = await connectionManager.getConnection(event.connectionId);
                    const protocol = connConfig?.protocol ?? 'ssh';
                    // Register FileSystemProvider for this connection
                    const conflictResolver = new ConflictResolver_1.ConflictResolver(adapter);
                    const remoteFsProvider = new RemoteFSProvider_1.RemoteFSProvider(event.connectionId, protocol, adapter, cacheManager, conflictResolver, concurrencyController);
                    const scheme = RemoteFSProvider_1.RemoteFSProvider.schemeFor(protocol);
                    const fsDisposable = vscode.workspace.registerFileSystemProvider(scheme, remoteFsProvider, {
                        isCaseSensitive: true,
                        isReadonly: false,
                    });
                    fsProviderDisposables.push(fsDisposable);
                    context.subscriptions.push(fsDisposable);
                    // Register adapter with sidebar
                    sidebarProvider.registerAdapter(event.connectionId, adapter);
                    // Register adapter with search panel
                    searchPanelProvider.setAdapter(event.connectionId, adapter);
                    searchPanelProvider.updateConnections(connectionManager.getActiveConnectionIds().map((id) => {
                        const c = connectionManager.getAllConnections().find((x) => x.id === id);
                        return { id, protocol: c?.protocol ?? 'ssh' };
                    }));
                    // Set up sync command handlers
                    const syncHandler = new syncCommands_1.SyncCommandHandler(event.connectionId, adapter, cacheManager, conflictResolver, protocol);
                    // Store sync handler reference for command use
                    context.syncHandlers = context.syncHandlers || new Map();
                    context.syncHandlers.set(event.connectionId, syncHandler);
                }
            }
            if (event.status === 'disconnected' || event.status === 'error') {
                sidebarProvider.unregisterAdapter(event.connectionId);
                searchPanelProvider.removeAdapter(event.connectionId);
                searchPanelProvider.updateConnections(connectionManager.getActiveConnectionIds().map((id) => {
                    const c = connectionManager.getAllConnections().find((x) => x.id === id);
                    return { id, protocol: c?.protocol ?? 'ssh' };
                }));
            }
        });
        // Inject dependencies into command registry so all commands have access
        // to the live managers. syncHandlers Map is mutated in-place as connections
        // are established, so commands resolve handlers lazily at call time.
        (0, commandRegistry_1.setCommandDeps)({
            connectionManager,
            sidebarProvider,
            cacheManager,
            searchEngine,
            syncHandlers: context.syncHandlers,
        });
        // Register all commands
        const commandDisposables = (0, commandRegistry_1.registerAllCommands)(context);
        const menuDisposables = (0, menuCommands_1.registerMenuCommands)(context);
        context.subscriptions.push(...commandDisposables, ...menuDisposables);
        // Register remaining commands with actual implementations
        context.subscriptions.push(vscode.commands.registerCommand('remote-fs.toggleConnection', async (connectionId) => {
            if (!connectionId) {
                const connections = connectionManager.getAllConnections();
                const selected = await connectionDialog.showConnectionList(connections);
                if (selected)
                    connectionId = selected.id;
                else
                    return;
            }
            const status = connectionManager.getStatus(connectionId);
            if (status === 'connected') {
                await connectionManager.disconnect(connectionId);
            }
            else {
                try {
                    await connectionManager.connect(connectionId);
                    vscode.window.showInformationMessage('Connected successfully.');
                }
                catch (err) {
                    vscode.window.showErrorMessage(`Connection failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
                }
            }
            sidebarProvider.refresh();
        }));
        context.subscriptions.push(vscode.commands.registerCommand('remote-fs.openTerminal', async (node) => {
            await terminalManager.openTerminal(node?.connectionId);
        }));
        // Register command to focus the search panel
        context.subscriptions.push(vscode.commands.registerCommand('remote-fs.searchPanel', async () => {
            // The search panel is a webviewView in the "Remote Search" panel container.
            // Opening it is done by VS Code when the user clicks the panel, but
            // we can help focus it by executing the focus command on the view.
            await vscode.commands.executeCommand('remote-fs-search.view.focus');
        }));
        context.subscriptions.push(vscode.commands.registerCommand('remote-fs.manageConnections', async () => {
            const connections = connectionManager.getAllConnections();
            const selected = await connectionDialog.showConnectionList(connections);
            if (!selected)
                return;
            const action = await vscode.window.showQuickPick([
                { label: 'Connect/Disconnect', description: 'Toggle connection' },
                { label: 'Edit', description: 'Modify connection settings' },
                { label: 'Delete', description: 'Remove this connection' },
            ], { placeHolder: `Manage "${selected.label}"` });
            if (!action)
                return;
            switch (action.label) {
                case 'Connect/Disconnect':
                    await vscode.commands.executeCommand('remote-fs.toggleConnection', selected.id);
                    break;
                case 'Edit':
                    const updated = await connectionDialog.showEditConnectionDialog(selected);
                    if (updated) {
                        await connectionManager.updateConnection(selected.id, updated);
                        vscode.window.showInformationMessage('Connection updated.');
                        sidebarProvider.refresh();
                    }
                    break;
                case 'Delete':
                    const confirmed = await connectionDialog.showDeleteConfirmation(selected.label);
                    if (confirmed) {
                        await connectionManager.removeConnection(selected.id);
                        vscode.window.showInformationMessage('Connection deleted.');
                        sidebarProvider.refresh();
                    }
                    break;
            }
        }));
        // Register all disposables for cleanup
        context.subscriptions.push(connectionManager, cacheManager, statusBarManager, terminalManager, ...fsProviderDisposables);
        outputChannel.info('Remote File Explorer extension activated successfully.');
    }
    catch (err) {
        outputChannel.error(`Remote File Explorer initialization failed: ${err instanceof Error ? err.message : String(err)}`);
        vscode.window.showErrorMessage(`Remote FS initialization failed: ${err instanceof Error ? err.message : 'Unknown error'}. Some features may be unavailable.`);
        // The critical commands (refresh, addConnection) are already registered above,
        // so the user can still interact with the extension to retry or diagnose.
    }
}
/**
 * Deactivate the extension.
 * Clean up all resources.
 */
async function deactivate() {
    // Use console.log for deactivate since context/outputChannel may already be disposed
    console.log('Remote File Explorer extension deactivating...');
    // All disposables are handled by context.subscriptions
    console.log('Remote File Explorer extension deactivated.');
}
//# sourceMappingURL=extension.js.map