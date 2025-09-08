import { TComfyPoolEventMap } from "./types/event.js";
import { ComfyApi } from "./client.js";
import { TypedEventTarget } from "./typed-event-target.js";
/**
 * Represents the mode for picking clients from a queue.
 *
 * - "PICK_ZERO": Picks the client which has zero queue remaining. This is the default mode. (For who using along with ComfyUI web interface)
 * - "PICK_LOWEST": Picks the client which has the lowest queue remaining.
 * - "PICK_ROUTINE": Picks the client in a round-robin manner.
 */
export declare enum EQueueMode {
    /**
     * Picks the client which has zero queue remaining. This is the default mode. (For who using along with ComfyUI web interface)
     */
    "PICK_ZERO" = 0,
    /**
     * Picks the client which has the lowest queue remaining.
     */
    "PICK_LOWEST" = 1,
    /**
     * Picks the client in a round-robin manner.
     */
    "PICK_ROUTINE" = 2
}
export declare class ComfyPool extends TypedEventTarget<TComfyPoolEventMap> {
    clients: ComfyApi[];
    private clientStates;
    private mode;
    private jobQueue;
    private routineIdx;
    private readonly maxQueueSize;
    private poolMonitoringInterval;
    private claimTimeoutMs;
    constructor(clients: ComfyApi[], 
    /**
     * The mode for picking clients from the queue. Defaults to "PICK_ZERO".
     */
    mode?: EQueueMode, opts?: {
        /**
         * The maximum size of the job queue. Defaults to 1000.
         */
        maxQueueSize?: number;
        /**
         * Optional timeout (ms) while waiting for a free / acceptable client. -1 disables timeout (default).
         */
        claimTimeoutMs?: number;
    });
    initPool(clients: ComfyApi[]): Promise<void>;
    chainOn<K extends keyof TComfyPoolEventMap>(type: K, callback: (event: TComfyPoolEventMap[K]) => void, options?: AddEventListenerOptions | boolean): this;
    chainOff<K extends keyof TComfyPoolEventMap>(type: K, callback: (event: TComfyPoolEventMap[K]) => void, options?: EventListenerOptions | boolean): this;
    /**
     * Removes all event listeners from the pool.
     */
    removeAllListeners(): void;
    /**
     * Adds a client to the pool.
     *
     * @param client - The client to be added.
     * @returns Promise<void>
     */
    addClient(client: ComfyApi): Promise<void>;
    /**
     * Destroys the pool and all its clients.
     * Ensures all connections, timers and event listeners are properly closed.
     */
    destroy(): void;
    /**
     * Removes a client from the pool.
     *
     * @param client - The client to be removed.
     * @returns void
     */
    removeClient(client: ComfyApi): void;
    /**
     * Removes a client from the pool by its index.
     *
     * @param index - The index of the client to remove.
     * @returns void
     * @fires removed - Fires a "removed" event with the removed client and its index as detail.
     */
    removeClientByIndex(index: number): void;
    /**
     * Changes the mode of the queue.
     *
     * @param mode - The new mode to set for the queue.
     * @returns void
     */
    changeMode(mode: EQueueMode): void;
    /**
     * Picks a ComfyApi client from the pool based on the given index.
     *
     * @param idx - The index of the client to pick. Defaults to 0 if not provided.
     * @returns The picked ComfyApi client.
     */
    pick(idx?: number): ComfyApi;
    /**
     * Retrieves a `ComfyApi` object from the pool based on the provided ID.
     * @param id - The ID of the `ComfyApi` object to retrieve.
     * @returns The `ComfyApi` object with the matching ID, or `undefined` if not found.
     */
    pickById(id: string): ComfyApi | undefined;
    /**
     * Executes a job using the provided client and optional client index.
     *
     * @template T The type of the result returned by the job.
     * @param {Function} job The job to be executed.
     * @param {number} [weight] The weight of the job.
     * @param {Object} [clientFilter] An object containing client filtering options.
     * @param {Object} [options] Additional options for job execution.
     * @returns {Promise<T>} A promise that resolves with the result of the job.
     */
    run<T>(job: (client: ComfyApi, clientIdx?: number) => Promise<T>, weight?: number, clientFilter?: {
        /**
         * Only one of the following clientIds will be picked.
         */
        includeIds?: string[];
        /**
         * The following clientIds will be excluded from the picking list.
         */
        excludeIds?: string[];
    }, options?: {
        /**
         * Whether to enable automatic failover to other clients when one fails.
         * Defaults to true.
         */
        enableFailover?: boolean;
        /**
         * Maximum number of retry attempts on different clients.
         * Defaults to the number of available clients.
         */
        maxRetries?: number;
        /**
         * Delay between retry attempts in milliseconds.
         * Defaults to 1000ms.
         */
        retryDelay?: number;
    }): Promise<T>;
    /**
     * Executes a batch of asynchronous jobs concurrently and returns an array of results.
     *
     * @template T - The type of the result returned by each job.
     * @param jobs - An array of functions that represent the asynchronous jobs to be executed.
     * @param weight - An optional weight value to assign to each job.
     * @param clientFilter - An optional object containing client filtering options.
     * @returns A promise that resolves to an array of results, in the same order as the jobs array.
     */
    batch<T>(jobs: Array<(client: ComfyApi, clientIdx?: number) => Promise<T>>, weight?: number, clientFilter?: {
        /**
         * Only one of the following clientIds will be picked.
         */
        includeIds?: string[];
        /**
         * The following clientIds will be excluded from the picking list.
         */
        excludeIds?: string[];
    }): Promise<T[]>;
    /** Convenience: pick a client and run a Workflow / raw workflow JSON via its api.runWorkflow */
    runWorkflow(wf: any, weight?: number, clientFilter?: {
        includeIds?: string[];
        excludeIds?: string[];
    }, options?: {
        enableFailover?: boolean;
        maxRetries?: number;
        retryDelay?: number;
        includeOutputs?: string[];
    }): Promise<import("./workflow.js").WorkflowJob<import("./workflow.js").WorkflowResult>>;
    private initializeClient;
    private bindClientSystemMonitor;
    private pushJobByWeight;
    private claim;
    private getAvailableClient;
    private processJobQueue;
}
export declare const __TEST_ONLY__: {
    snapshotQueue(pool: ComfyPool): {
        weight: number;
        include: string[] | undefined;
        exclude: string[] | undefined;
    }[];
};
//# sourceMappingURL=pool.d.ts.map