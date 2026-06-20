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
exports.registerMenuCommands = registerMenuCommands;
const vscode = __importStar(require("vscode"));
/**
 * Register additional menu-specific command handlers.
 * These complement the commands in commandRegistry.ts with
 * implementations specific to context menu actions.
 */
function registerMenuCommands(context) {
    const disposables = [];
    // Menu command implementations are handled by commandRegistry.ts
    // This file provides additional menu-specific behavior
    // Re-register connect with menu context awareness
    disposables.push(vscode.commands.registerCommand('remote-fs.menuConnect', async (node) => {
        if (node?.connectionId) {
            await vscode.commands.executeCommand('remote-fs.connect', node);
        }
    }));
    // Re-register disconnect with menu context awareness
    disposables.push(vscode.commands.registerCommand('remote-fs.menuDisconnect', async (node) => {
        if (node?.connectionId) {
            await vscode.commands.executeCommand('remote-fs.disconnect', node);
        }
    }));
    return disposables;
}
//# sourceMappingURL=menuCommands.js.map