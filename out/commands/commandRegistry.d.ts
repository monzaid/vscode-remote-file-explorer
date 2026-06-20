import * as vscode from 'vscode';
import { ConnectionManager } from '../core/ConnectionManager';
import { LocalCacheManager } from '../core/LocalCacheManager';
import { SearchEngine } from '../search/SearchEngine';
import { SidebarProvider } from '../providers/SidebarProvider';
import { SyncCommandHandler } from './syncCommands';
/**
 * Dependencies injected by extension.ts after initialization.
 * All fields are optional — commands check availability before use.
 */
export interface CommandDeps {
    connectionManager?: ConnectionManager;
    sidebarProvider?: SidebarProvider;
    cacheManager?: LocalCacheManager;
    searchEngine?: SearchEngine;
    /** Map of connectionId → SyncCommandHandler */
    syncHandlers?: Map<string, SyncCommandHandler>;
}
/** Called by extension.ts to inject dependencies */
export declare function setCommandDeps(d: CommandDeps): void;
export declare function registerAllCommands(_context: vscode.ExtensionContext): vscode.Disposable[];
//# sourceMappingURL=commandRegistry.d.ts.map