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
exports.ConcurrencyController = void 0;
const vscode = __importStar(require("vscode"));
/**
 * Concurrency control queue for remote file system operations.
 * Limits the number of simultaneous remote operations to prevent
 * overwhelming the remote connection or hitting resource limits.
 */
class ConcurrencyController {
    constructor(maxConcurrent = 5) {
        this._activeCount = 0;
        this.queue = [];
        this.maxConcurrent = maxConcurrent;
    }
    /** Number of currently executing operations. */
    get activeCount() {
        return this._activeCount;
    }
    /** Number of operations waiting in the queue. */
    get pendingCount() {
        return this.queue.length;
    }
    /** Whether the controller is at max concurrency. */
    get isFull() {
        return this._activeCount >= this.maxConcurrent;
    }
    /**
     * Enqueue an async function for execution with concurrency control.
     * If under the maxConcurrent limit, executes immediately.
     * Otherwise, queues and waits for a slot to free up.
     *
     * @param fn - The async function to execute.
     * @param label - Optional label for status bar messaging.
     * @returns The result of fn.
     */
    enqueue(fn, label) {
        if (this._activeCount < this.maxConcurrent) {
            return this.execute(fn, label ?? 'remote-op');
        }
        // Queue the operation — return a promise that resolves when dequeued
        return new Promise((resolve, reject) => {
            this.queue.push({
                resolve: resolve,
                reject,
                fn: fn,
                label: label ?? 'remote-op',
            });
            // Show non-blocking status bar message
            if (this.queue.length === 1) {
                vscode.window.setStatusBarMessage(`$(sync~spin) Remote FS: ${this.queue.length} operation(s) queued...`, 3000);
            }
        });
    }
    /**
     * Execute a function and decrement activeCount on completion.
     * After completion, attempts to dequeue the next waiting operation.
     */
    async execute(fn, label) {
        this._activeCount++;
        try {
            return await fn();
        }
        finally {
            this._activeCount--;
            this.dequeue();
        }
    }
    /**
     * Dequeue and execute the next waiting operation, if any.
     */
    dequeue() {
        const entry = this.queue.shift();
        if (!entry)
            return;
        // Update status bar for remaining queued ops
        if (this.queue.length > 0) {
            vscode.window.setStatusBarMessage(`$(sync~spin) Remote FS: ${this.queue.length} operation(s) queued...`, 3000);
        }
        this.execute(entry.fn, entry.label).then(entry.resolve).catch(entry.reject);
    }
}
exports.ConcurrencyController = ConcurrencyController;
//# sourceMappingURL=ConcurrencyController.js.map