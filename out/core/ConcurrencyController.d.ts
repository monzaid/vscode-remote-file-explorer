/**
 * Concurrency control queue for remote file system operations.
 * Limits the number of simultaneous remote operations to prevent
 * overwhelming the remote connection or hitting resource limits.
 */
export declare class ConcurrencyController {
    private readonly maxConcurrent;
    private _activeCount;
    private queue;
    constructor(maxConcurrent?: number);
    /** Number of currently executing operations. */
    get activeCount(): number;
    /** Number of operations waiting in the queue. */
    get pendingCount(): number;
    /** Whether the controller is at max concurrency. */
    get isFull(): boolean;
    /**
     * Enqueue an async function for execution with concurrency control.
     * If under the maxConcurrent limit, executes immediately.
     * Otherwise, queues and waits for a slot to free up.
     *
     * @param fn - The async function to execute.
     * @param label - Optional label for status bar messaging.
     * @returns The result of fn.
     */
    enqueue<T>(fn: () => Promise<T>, label?: string): Promise<T>;
    /**
     * Execute a function and decrement activeCount on completion.
     * After completion, attempts to dequeue the next waiting operation.
     */
    private execute;
    /**
     * Dequeue and execute the next waiting operation, if any.
     */
    private dequeue;
}
//# sourceMappingURL=ConcurrencyController.d.ts.map