import * as vscode from 'vscode';

interface QueueEntry {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  fn: () => Promise<unknown>;
  label: string;
}

/**
 * Concurrency control queue for remote file system operations.
 * Limits the number of simultaneous remote operations to prevent
 * overwhelming the remote connection or hitting resource limits.
 */
export class ConcurrencyController {
  private readonly maxConcurrent: number;
  private _activeCount: number = 0;
  private queue: QueueEntry[] = [];

  constructor(maxConcurrent: number = 5) {
    this.maxConcurrent = maxConcurrent;
  }

  /** Number of currently executing operations. */
  get activeCount(): number {
    return this._activeCount;
  }

  /** Number of operations waiting in the queue. */
  get pendingCount(): number {
    return this.queue.length;
  }

  /** Whether the controller is at max concurrency. */
  get isFull(): boolean {
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
  enqueue<T>(fn: () => Promise<T>, label?: string): Promise<T> {
    if (this._activeCount < this.maxConcurrent) {
      return this.execute(fn, label ?? 'remote-op');
    }

    // Queue the operation — return a promise that resolves when dequeued
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        resolve: resolve as (value: unknown) => void,
        reject,
        fn: fn as () => Promise<unknown>,
        label: label ?? 'remote-op',
      });

      // Show non-blocking status bar message
      if (this.queue.length === 1) {
        vscode.window.setStatusBarMessage(
          `$(sync~spin) Remote FS: ${this.queue.length} operation(s) queued...`,
          3000,
        );
      }
    });
  }

  /**
   * Execute a function and decrement activeCount on completion.
   * After completion, attempts to dequeue the next waiting operation.
   * Protected against dequeue() failures that could otherwise stall the queue.
   */
  private async execute<T>(fn: () => Promise<T>, label: string): Promise<T> {
    this._activeCount++;
    try {
      return await fn();
    } finally {
      this._activeCount--;
      try {
        this.dequeue();
      } catch {
        // Prevent dequeue failures from silently stalling the queue.
        // The next completed operation will retry dequeue naturally.
      }
    }
  }

  /**
   * Dequeue and execute the next waiting operation, if any.
   * Protected against reject() failures to prevent queue stall.
   */
  private dequeue(): void {
    const entry = this.queue.shift();
    if (!entry) return;

    // Update status bar for remaining queued ops
    if (this.queue.length > 0) {
      vscode.window.setStatusBarMessage(
        `$(sync~spin) Remote FS: ${this.queue.length} operation(s) queued...`,
        3000,
      );
    }

    this.execute(entry.fn, entry.label)
      .then(entry.resolve)
      .catch((err) => {
        try {
          entry.reject(err);
        } catch {
          // Reject itself failed — log and continue.
          // The queue is safe: execute()'s finally already called dequeue()
          // for the NEXT entry, so the cascade continues.
          console.error('[ConcurrencyController] entry.reject threw:', err);
        }
      });
  }
}
