import * as vscode from 'vscode';
import { ConnectionManager } from './core/ConnectionManager';
import { ConcurrencyController } from './core/ConcurrencyController';
import { LocalCacheManager } from './core/LocalCacheManager';
import { StatusBarManager } from './ui/StatusBarManager';
import { SidebarProvider } from './providers/SidebarProvider';
import { RemoteFSProvider } from './providers/RemoteFSProvider';
import { ConflictResolver } from './providers/ConflictResolver';
import { TerminalManager } from './terminal/TerminalManager';
import { SearchEngine } from './search/SearchEngine';
import { SSHAdapter } from './adapters/SSHAdapter';
import { ConnectionDialog } from './ui/ConnectionDialog';
import { registerAllCommands, setCommandDeps } from './commands/commandRegistry';
import { registerMenuCommands } from './commands/menuCommands';
import { SyncCommandHandler } from './commands/syncCommands';
import { IProtocolAdapter } from './core/IProtocolAdapter';
import { ConnectionStatus } from './core/types';

/**
 * Activate the extension.
 * Initializes all modules and registers providers, commands, and UI components.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
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
  let sidebarProvider: SidebarProvider | null = null;
  let connectionDialog: ConnectionDialog | null = null;
  let connectionManager: ConnectionManager | null = null;
  let terminalManager: TerminalManager | null = null;

  // Register refresh first — always safe, always works
  context.subscriptions.push(
    vscode.commands.registerCommand('remote-fs.refresh', () => {
      if (sidebarProvider) {
        sidebarProvider.refresh();
      } else {
        outputChannel.warn('remote-fs.refresh called before initialization complete');
      }
    }),
  );

  // Register addConnection — triggers ConnectionDialog
  context.subscriptions.push(
    vscode.commands.registerCommand('remote-fs.addConnection', async () => {
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
    }),
  );

  // ========================================================================
  // Now perform initialization. If any step fails, the two critical commands
  // above are already registered and will show a user-friendly message.
  // ========================================================================
  try {
    // Initialize RemoteFSProvider static config (one-time with change listener)
    RemoteFSProvider.initConfig(context);

    // Initialize core managers
    connectionManager = new ConnectionManager(context);
    const cacheManager = new LocalCacheManager(context);
    const concurrencyController = new ConcurrencyController();
    const statusBarManager = new StatusBarManager();

    // Initialize UI components
    sidebarProvider = new SidebarProvider(connectionManager);
    connectionDialog = new ConnectionDialog();

    // Initialize search and terminal managers
    const searchEngine = new SearchEngine();
    terminalManager = new TerminalManager(connectionManager);

    // Register adapter factory
    connectionManager.setAdapterFactory((protocol: string): IProtocolAdapter => {
      switch (protocol) {
        case 'ssh':
          return new SSHAdapter();
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

    // Register FileSystemProvider for each active connection
    // (will be dynamically registered when connections are established)
    const fsProviderDisposables: vscode.Disposable[] = [];

    // Create sync handlers Map NOW — shared reference between event callback and command deps.
    // Must be created before setCommandDeps so commands see the same Map instance,
    // even though handlers are added later when connections become active.
    const syncHandlers = new Map<string, SyncCommandHandler>();

    // Listen for connection status changes to register/unregister FS providers
    connectionManager.onConnectionStatusChange.on('statusChange', async (event: { connectionId: string; status: string }) => {
      statusBarManager.updateStatus(
        event.status as ConnectionStatus,
        connectionManager!.getActiveCount(),
      );

      if (event.status === 'connected') {
        const adapter = connectionManager!.getAdapter(event.connectionId);
        if (adapter) {
          // Determine protocol for this connection
          const connConfig = await connectionManager!.getConnection(event.connectionId);
          const protocol = connConfig?.protocol ?? 'ssh';

          // Register FileSystemProvider for this connection
          const conflictResolver = new ConflictResolver(adapter);
          const remoteFsProvider = new RemoteFSProvider(
            event.connectionId,
            protocol,
            adapter,
            cacheManager,
            conflictResolver,
            concurrencyController,
          );

          const scheme = RemoteFSProvider.schemeFor(protocol);
          const fsDisposable = vscode.workspace.registerFileSystemProvider(
            scheme,
            remoteFsProvider,
            {
              isCaseSensitive: true,
              isReadonly: false,
            },
          );
          fsProviderDisposables.push(fsDisposable);
          context.subscriptions.push(fsDisposable);

          // Register adapter with sidebar
          sidebarProvider!.registerAdapter(event.connectionId, adapter);

          // Set up sync command handlers
          const syncHandler = new SyncCommandHandler(
            event.connectionId,
            adapter,
            cacheManager,
            conflictResolver,
            protocol,
          );
          // Store sync handler reference for command use
          syncHandlers.set(event.connectionId, syncHandler);
        }
      }

      if (event.status === 'disconnected' || event.status === 'error') {
        sidebarProvider!.unregisterAdapter(event.connectionId);
      }
    });

    // Inject dependencies into command registry so all commands have access
    // to the live managers. syncHandlers Map is mutated in-place as connections
    // are established, so commands resolve handlers lazily at call time.
    setCommandDeps({
      connectionManager,
      sidebarProvider,
      cacheManager,
      searchEngine,
      syncHandlers,
    });

    // Register all commands
    const commandDisposables = registerAllCommands(context);
    const menuDisposables = registerMenuCommands(context);
    context.subscriptions.push(...commandDisposables, ...menuDisposables);

    // Register remaining commands with actual implementations
    context.subscriptions.push(
      vscode.commands.registerCommand('remote-fs.toggleConnection', async (connectionId?: string) => {
        if (!connectionId) {
          const connections = connectionManager!.getAllConnections();
          const selected = await connectionDialog!.showConnectionList(connections);
          if (selected) connectionId = selected.id;
          else return;
        }

        const status = connectionManager!.getStatus(connectionId);
        if (status === 'connected') {
          await connectionManager!.disconnect(connectionId);
        } else {
          try {
            await connectionManager!.connect(connectionId);
            vscode.window.showInformationMessage('Connected successfully.');
          } catch (err) {
            vscode.window.showErrorMessage(
              `Connection failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
            );
          }
        }
        sidebarProvider!.refresh();
      }),
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('remote-fs.openTerminal', async (node?: { connectionId?: string }) => {
        await terminalManager!.openTerminal(node?.connectionId);
      }),
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('remote-fs.manageConnections', async () => {
        const connections = connectionManager!.getAllConnections();
        const selected = await connectionDialog!.showConnectionList(connections);
        if (!selected) return;

        const action = await vscode.window.showQuickPick(
          [
            { label: 'Connect/Disconnect', description: 'Toggle connection' },
            { label: 'Edit', description: 'Modify connection settings' },
            { label: 'Delete', description: 'Remove this connection' },
          ],
          { placeHolder: `Manage "${selected.label}"` },
        );

        if (!action) return;

        switch (action.label) {
          case 'Connect/Disconnect':
            await vscode.commands.executeCommand('remote-fs.toggleConnection', selected.id);
            break;
          case 'Edit':
            const updated = await connectionDialog!.showEditConnectionDialog(selected);
            if (updated) {
              await connectionManager!.updateConnection(selected.id, updated);
              vscode.window.showInformationMessage('Connection updated.');
              sidebarProvider!.refresh();
            }
            break;
          case 'Delete':
            const confirmed = await connectionDialog!.showDeleteConfirmation(selected.label);
            if (confirmed) {
              await connectionManager!.removeConnection(selected.id);
              vscode.window.showInformationMessage('Connection deleted.');
              sidebarProvider!.refresh();
            }
            break;
        }
      }),
    );

    // Register all disposables for cleanup
    context.subscriptions.push(
      connectionManager,
      cacheManager,
      statusBarManager,
      terminalManager,
      ...fsProviderDisposables,
    );

    outputChannel.info('Remote File Explorer extension activated successfully.');
  } catch (err) {
    outputChannel.error(
      `Remote File Explorer initialization failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    vscode.window.showErrorMessage(
      `Remote FS initialization failed: ${err instanceof Error ? err.message : 'Unknown error'}. Some features may be unavailable.`,
    );
    // The critical commands (refresh, addConnection) are already registered above,
    // so the user can still interact with the extension to retry or diagnose.
  }
}

/**
 * Deactivate the extension.
 * Clean up all resources.
 */
export async function deactivate(): Promise<void> {
  // Use console.log for deactivate since context/outputChannel may already be disposed
  console.log('Remote File Explorer extension deactivating...');
  // All disposables are handled by context.subscriptions
  console.log('Remote File Explorer extension deactivated.');
}
