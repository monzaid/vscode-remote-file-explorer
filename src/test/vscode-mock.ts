/**
 * Minimal mock for the 'vscode' module.
 * Provides just enough stubs for unit tests that import modules
 * which reference vscode at the top level (e.g., ConcurrencyController
 * uses vscode.window.setStatusBarMessage).
 *
 * Usage: register this mock before importing any module that depends on vscode.
 */

// @ts-nocheck
/* eslint-disable */

const vscodeMock: any = {
  window: {
    showWarningMessage: () => Promise.resolve(undefined),
    showInformationMessage: () => Promise.resolve(undefined),
    showErrorMessage: () => Promise.resolve(undefined),
    showInputBox: () => Promise.resolve(undefined),
    setStatusBarMessage: () => ({ dispose: () => {} }),
    createStatusBarItem: () => ({ show: () => {}, dispose: () => {} }),
    createOutputChannel: () => ({
      appendLine: () => {},
      show: () => {},
      dispose: () => {},
    }),
    createTextEditorDecorationType: () => ({ dispose: () => {} }),
    onDidChangeActiveTextEditor: () => ({ dispose: () => {} }),
  },
  workspace: {
    getConfiguration: () => ({
      get: (key: string, defaultValue: any) => defaultValue,
      update: () => Promise.resolve(),
    }),
    fs: {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: () => Promise.resolve(),
      delete: () => Promise.resolve(),
      stat: () => Promise.resolve({ type: 1, ctime: 0, mtime: 0, size: 0 }),
      readDirectory: () => Promise.resolve([]),
      createDirectory: () => Promise.resolve(),
      rename: () => Promise.resolve(),
    },
    onDidChangeConfiguration: () => ({ dispose: () => {} }),
    onDidSaveTextDocument: () => ({ dispose: () => {} }),
  },
  Uri: {
    file: (path: string) => ({ fsPath: path, scheme: 'file', path }),
    parse: (value: string) => ({ scheme: 'file', fsPath: value }),
  },
  ExtensionContext: class {
    globalStorageUri = { fsPath: '/tmp/vscode-mock-global-storage' };
    subscriptions: any[] = [];
    get globalState() {
      return { get: () => undefined, update: () => Promise.resolve() };
    }
  },
  Disposable: {
    from: (...disposables: any[]) => ({
      dispose: () => disposables.forEach((d) => d.dispose()),
    }),
  },
  EventEmitter: class {
    private listeners: Array<(...args: any[]) => void> = [];
    event = (callback: (...args: any[]) => void) => {
      this.listeners.push(callback);
      return { dispose: () => { this.listeners = []; } };
    };
    fire(...args: any[]) {
      for (const listener of this.listeners) {
        listener(...args);
      }
    }
    dispose() { this.listeners = []; }
  },
  TreeItem: class {
    label?: string;
    collapsibleState?: number;
    constructor(label: string, collapsibleState?: number) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: {
    None: 0,
    Collapsed: 1,
    Expanded: 2,
  },
  ThemeIcon: class {
    constructor(public id: string) {}
  },
  commands: {
    executeCommand: () => Promise.resolve(),
    registerCommand: () => ({ dispose: () => {} }),
  },
  ProgressLocation: {
    Notification: 15,
    Window: 10,
    SourceControl: 1,
  },
  StatusBarAlignment: {
    Left: 1,
    Right: 2,
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3,
  },
  ViewColumn: {
    Active: -1,
    Beside: -2,
    One: 1,
    Two: 2,
  },
  env: {
    machineId: 'test-machine',
    sessionId: 'test-session',
    language: 'en',
    appName: 'Visual Studio Code',
  },
  version: '1.75.0',
};

module.exports = vscodeMock;
