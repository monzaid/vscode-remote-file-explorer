import * as vscode from 'vscode';
import { SearchEngine } from '../search/SearchEngine';
import { IProtocolAdapter } from '../core/IProtocolAdapter';
/**
 * WebviewViewProvider that provides a custom HTML search panel
 * for searching files across active remote connections.
 */
export declare class SearchPanelProvider implements vscode.WebviewViewProvider {
    private readonly extensionUri;
    static readonly viewType = "remote-fs-search.view";
    private _view?;
    private searchEngine;
    private adapters;
    private activeConnections;
    constructor(extensionUri: vscode.Uri, searchEngine: SearchEngine);
    /** Update the list of active connections for the dropdown */
    updateConnections(connections: Array<{
        id: string;
        protocol: string;
    }>): void;
    /** Register an adapter for a connection */
    setAdapter(connectionId: string, adapter: IProtocolAdapter): void;
    /** Remove an adapter */
    removeAdapter(connectionId: string): void;
    resolveWebviewView(webviewView: vscode.WebviewView): void;
    private postMessage;
    private doSearch;
    private openFile;
    private getHtml;
}
//# sourceMappingURL=SearchPanelProvider.d.ts.map