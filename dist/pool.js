import { delay } from "./tools.js";
import { TypedEventTarget } from "./typed-event-target.js";
/**
 * Represents the mode for picking clients from a queue.
 *
 * - "PICK_ZERO": Picks the client which has zero queue remaining. This is the default mode. (For who using along with ComfyUI web interface)
 * - "PICK_LOWEST": Picks the client which has the lowest queue remaining.
 * - "PICK_ROUTINE": Picks the client in a round-robin manner.
 */
export var EQueueMode;
(function (EQueueMode) {
    /**
     * Picks the client which has zero queue remaining. This is the default mode. (For who using along with ComfyUI web interface)
     */
    EQueueMode[EQueueMode["PICK_ZERO"] = 0] = "PICK_ZERO";
    /**
     * Picks the client which has the lowest queue remaining.
     */
    EQueueMode[EQueueMode["PICK_LOWEST"] = 1] = "PICK_LOWEST";
    /**
     * Picks the client in a round-robin manner.
     */
    EQueueMode[EQueueMode["PICK_ROUTINE"] = 2] = "PICK_ROUTINE";
})(EQueueMode || (EQueueMode = {}));
export class ComfyPool extends TypedEventTarget {
    clients = [];
    clientStates = [];
    mode = EQueueMode.PICK_ZERO;
    jobQueue = [];
    routineIdx = 0;
    maxQueueSize = 1000;
    poolMonitoringInterval;
    claimTimeoutMs = -1;
    /** Cache of available checkpoints per client (clientId -> checkpoint names) */
    checkpointCache = new Map();
    /** Timestamp of last checkpoint cache refresh per client (for cache invalidation) */
    checkpointCacheTime = new Map();
    /** How long to cache checkpoint lists (default: 5 minutes) */
    checkpointCacheTTL = 5 * 60 * 1000;
    constructor(clients, 
    /**
     * The mode for picking clients from the queue. Defaults to "PICK_ZERO".
     */
    mode = EQueueMode.PICK_ZERO, opts) {
        super();
        this.mode = mode;
        if (opts && typeof opts.maxQueueSize === "number") {
            if (opts.maxQueueSize < 0) {
                throw new Error("maxQueueSize cannot be negative");
            }
            this.maxQueueSize = opts.maxQueueSize;
        }
        if (typeof opts?.claimTimeoutMs === "number") {
            this.claimTimeoutMs = opts.claimTimeoutMs;
        }
        this.poolMonitoringInterval = setInterval(() => {
            this.processJobQueue().catch((err) => {
                console.error("[ComfyPool] Error processing job queue:", err);
            });
        }, 5000);
        this.initPool(clients).then(() => {
            this.dispatchEvent(new CustomEvent("init"));
        }).catch(reason => {
            console.error("[ComfyPool] Error initializing pool:", reason);
            this.dispatchEvent(new CustomEvent("error", { detail: reason }));
        });
    }
    async initPool(clients) {
        for (const client of clients) {
            await this.addClient(client);
        }
        await this.processJobQueue();
    }
    // Use inherited on/off which return unsubscriber; provide chain helpers if desired.
    chainOn(type, callback, options) {
        super.on(type, callback, options);
        return this;
    }
    chainOff(type, callback, options) {
        super.off(type, callback, options);
        return this;
    }
    /**
     * Removes all event listeners from the pool.
     */
    removeAllListeners() {
        // No internal registry now; rely on GC for one-off handlers or keep a manual registry later if needed.
    }
    /**
     * Adds a client to the pool.
     *
     * @param client - The client to be added.
     * @returns Promise<void>
     */
    async addClient(client) {
        const index = this.clients.push(client) - 1;
        this.clientStates.push({
            id: client.id,
            queueRemaining: 0,
            locked: false,
            online: false
        });
        await this.initializeClient(client, index);
        this.dispatchEvent(new CustomEvent("added", { detail: { client, clientIdx: index } }));
    }
    /**
     * Destroys the pool and all its clients.
     * Ensures all connections, timers and event listeners are properly closed.
     */
    destroy() {
        // Cancel any pending jobs
        this.jobQueue = [];
        // Destroy all clients properly and ensure they're cleaned up
        this.clients.forEach((client, index) => {
            try {
                client.destroy();
            }
            catch (e) {
                console.error(`[ComfyPool] Error destroying client ${client.id}:`, e);
            }
        });
        // Clear arrays
        this.clients = [];
        this.clientStates = [];
        // Clear checkpoint cache
        this.checkpointCache.clear();
        this.checkpointCacheTime.clear();
        // Remove all event listeners
        this.removeAllListeners();
        if (this.poolMonitoringInterval) {
            clearInterval(this.poolMonitoringInterval);
            this.poolMonitoringInterval = undefined;
        }
    }
    /**
     * Gets the list of available checkpoints for a specific client.
     * Uses caching to avoid repeated API calls.
     * @param client - The ComfyApi client to query
     * @param forceRefresh - Force a cache refresh (default: false)
     * @returns A Set of checkpoint filenames available on this client
     */
    async getClientCheckpoints(client, forceRefresh = false) {
        const now = Date.now();
        const cachedTime = this.checkpointCacheTime.get(client.id) || 0;
        const isCacheValid = !forceRefresh && (now - cachedTime) < this.checkpointCacheTTL;
        if (isCacheValid && this.checkpointCache.has(client.id)) {
            return this.checkpointCache.get(client.id);
        }
        try {
            const checkpoints = await client.getCheckpoints();
            const checkpointSet = new Set(checkpoints);
            this.checkpointCache.set(client.id, checkpointSet);
            this.checkpointCacheTime.set(client.id, now);
            return checkpointSet;
        }
        catch (error) {
            console.error(`[ComfyPool] Failed to fetch checkpoints for client ${client.id}:`, error);
            // Return empty set on error (will exclude this client from checkpoint-specific jobs)
            return new Set();
        }
    }
    /**
     * Checks if a client has the required checkpoint(s).
     * @param client - The ComfyApi client to check
     * @param requiredCheckpoints - Array of checkpoint filenames that must be available
     * @returns Promise<boolean> - true if client has all required checkpoints
     */
    async clientHasCheckpoints(client, requiredCheckpoints) {
        if (!requiredCheckpoints || requiredCheckpoints.length === 0) {
            return true; // No checkpoint requirement
        }
        const availableCheckpoints = await this.getClientCheckpoints(client);
        return requiredCheckpoints.every(ckpt => availableCheckpoints.has(ckpt));
    }
    /**
     * Removes a client from the pool.
     *
     * @param client - The client to be removed.
     * @returns void
     */
    removeClient(client) {
        const index = this.clients.indexOf(client);
        this.removeClientByIndex(index);
    }
    /**
     * Removes a client from the pool by its index.
     *
     * @param index - The index of the client to remove.
     * @returns void
     * @fires removed - Fires a "removed" event with the removed client and its index as detail.
     */
    removeClientByIndex(index) {
        if (index >= 0 && index < this.clients.length) {
            const client = this.clients.splice(index, 1)[0];
            client.destroy();
            this.clientStates.splice(index, 1);
            this.dispatchEvent(new CustomEvent("removed", { detail: { client, clientIdx: index } }));
        }
    }
    /**
     * Changes the mode of the queue.
     *
     * @param mode - The new mode to set for the queue.
     * @returns void
     */
    changeMode(mode) {
        this.mode = mode;
        this.dispatchEvent(new CustomEvent("change_mode", { detail: { mode } }));
    }
    /**
     * Picks a ComfyApi client from the pool based on the given index.
     *
     * @param idx - The index of the client to pick. Defaults to 0 if not provided.
     * @returns The picked ComfyApi client.
     */
    pick(idx = 0) {
        return this.clients[idx];
    }
    /**
     * Retrieves a `ComfyApi` object from the pool based on the provided ID.
     * @param id - The ID of the `ComfyApi` object to retrieve.
     * @returns The `ComfyApi` object with the matching ID, or `undefined` if not found.
     */
    pickById(id) {
        return this.clients.find((c) => c.id === id);
    }
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
    run(job, weight, clientFilter, options) {
        const enableFailover = options?.enableFailover !== false; // Default to true
        const retryDelay = options?.retryDelay || 1000;
        return new Promise(async (resolve, reject) => {
            let excludedIds = clientFilter?.excludeIds ? [...clientFilter.excludeIds] : [];
            let attempt = 0;
            const onlineClients = this.clientStates.filter((c) => c.online);
            const maxRetries = options?.maxRetries || onlineClients.length;
            let lastError = null;
            const tryExecute = async () => {
                attempt++;
                const fn = async (client, idx) => {
                    this.dispatchEvent(new CustomEvent("executing", { detail: { client, clientIdx: idx } }));
                    try {
                        const result = await job(client, idx);
                        this.dispatchEvent(new CustomEvent("executed", { detail: { client, clientIdx: idx } }));
                        resolve(result);
                    }
                    catch (e) {
                        lastError = e;
                        console.error(`[ComfyPool] Job failed on client ${client.id} (attempt ${attempt}/${maxRetries}):`, e);
                        // If failover is enabled and we have more attempts, exclude this client and retry
                        if (enableFailover && attempt < maxRetries && onlineClients.length > excludedIds.length) {
                            excludedIds.push(client.id);
                            this.dispatchEvent(new CustomEvent("execution_error", {
                                detail: { client, clientIdx: idx, error: e, willRetry: true, attempt, maxRetries }
                            }));
                            // Wait before retrying
                            setTimeout(() => {
                                tryExecute().catch(reject);
                            }, retryDelay);
                        }
                        else {
                            // No more retries or failover disabled, reject with the error
                            this.dispatchEvent(new CustomEvent("execution_error", {
                                detail: { client, clientIdx: idx, error: e, willRetry: false, attempt, maxRetries }
                            }));
                            reject(e);
                        }
                    }
                };
                try {
                    await this.claim(fn, weight, {
                        includeIds: clientFilter?.includeIds,
                        excludeIds: excludedIds,
                        requiredCheckpoints: clientFilter?.requiredCheckpoints
                    }, (err) => {
                        // onError from claim (e.g. timeout acquiring client)
                        lastError = err;
                        reject(err);
                    });
                }
                catch (claimError) {
                    reject(lastError || claimError);
                }
            };
            // Start the first attempt
            tryExecute().catch(reject);
        });
    }
    /**
     * Executes a batch of asynchronous jobs concurrently and returns an array of results.
     *
     * @template T - The type of the result returned by each job.
     * @param jobs - An array of functions that represent the asynchronous jobs to be executed.
     * @param weight - An optional weight value to assign to each job.
     * @param clientFilter - An optional object containing client filtering options.
     * @returns A promise that resolves to an array of results, in the same order as the jobs array.
     */
    batch(jobs, weight, clientFilter) {
        return Promise.all(jobs.map((task) => this.run(task, weight, clientFilter)));
    }
    /** Convenience: pick a client and run a Workflow / raw workflow JSON via its api.runWorkflow */
    async runWorkflow(wf, weight, clientFilter, options) {
        // Auto-detect checkpoints from workflow if not explicitly provided
        let checkpoints = clientFilter?.requiredCheckpoints;
        if (!checkpoints || checkpoints.length === 0) {
            try {
                // Try to extract checkpoints from the workflow
                const workflowObj = typeof wf === 'object' && wf.extractCheckpoints ? wf : null;
                if (workflowObj) {
                    checkpoints = workflowObj.extractCheckpoints();
                }
                else if (typeof wf === 'object') {
                    // Try to detect checkpoints from raw JSON
                    const { Workflow } = await import('./workflow.js');
                    const tempWf = Workflow.from(wf);
                    checkpoints = tempWf.extractCheckpoints();
                }
            }
            catch (e) {
                // Non-fatal: proceed without checkpoint filtering
                console.warn('[ComfyPool] Failed to extract checkpoints from workflow:', e);
            }
        }
        return this.run(async (api) => api.runWorkflow(wf, { includeOutputs: options?.includeOutputs }), weight, {
            ...clientFilter,
            requiredCheckpoints: checkpoints
        }, options);
    }
    async initializeClient(client, index) {
        this.dispatchEvent(new CustomEvent("loading_client", {
            detail: { client, clientIdx: index }
        }));
        const states = this.clientStates[index];
        client.on("status", (ev) => {
            if (states.online === false) {
                this.dispatchEvent(new CustomEvent("connected", { detail: { client, clientIdx: index } }));
            }
            states.online = true;
            if (ev.detail.status.exec_info && ev.detail.status.exec_info.queue_remaining !== states.queueRemaining) {
                if (ev.detail.status.exec_info.queue_remaining > 0) {
                    this.dispatchEvent(new CustomEvent("have_job", {
                        detail: { client, remain: states.queueRemaining }
                    }));
                }
                if (ev.detail.status.exec_info.queue_remaining === 0) {
                    this.dispatchEvent(new CustomEvent("idle", { detail: { client } }));
                }
            }
            states.queueRemaining = ev.detail.status.exec_info.queue_remaining;
            if (this.mode !== EQueueMode.PICK_ZERO) {
                states.locked = false;
            }
        });
        client.on("terminal", (ev) => {
            this.dispatchEvent(new CustomEvent("terminal", {
                detail: {
                    clientIdx: index,
                    ...ev.detail
                }
            }));
        });
        client.on("disconnected", () => {
            states.online = false;
            states.locked = false;
            this.dispatchEvent(new CustomEvent("disconnected", {
                detail: { client, clientIdx: index }
            }));
        });
        client.on("reconnected", () => {
            states.online = true;
            states.locked = false;
            this.dispatchEvent(new CustomEvent("reconnected", {
                detail: { client, clientIdx: index }
            }));
        });
        client.on("execution_success", (ev) => {
            states.locked = false;
        });
        client.on("execution_interrupted", (ev) => {
            states.locked = false;
            this.dispatchEvent(new CustomEvent("execution_interrupted", {
                detail: {
                    client,
                    clientIdx: index
                }
            }));
        });
        client.on("execution_error", (ev) => {
            states.locked = false;
            this.dispatchEvent(new CustomEvent("execution_error", {
                detail: {
                    client,
                    clientIdx: index,
                    error: new Error(ev.detail.exception_type, { cause: ev.detail })
                }
            }));
        });
        client.on("queue_error", (ev) => {
            states.locked = false;
        });
        client.on("auth_error", (ev) => {
            this.dispatchEvent(new CustomEvent("auth_error", {
                detail: { client, clientIdx: index, res: ev.detail }
            }));
        });
        client.on("auth_success", (ev) => {
            this.dispatchEvent(new CustomEvent("auth_success", {
                detail: { client, clientIdx: index }
            }));
        });
        client.on("connection_error", (ev) => {
            this.dispatchEvent(new CustomEvent("connection_error", {
                detail: { client, clientIdx: index, res: ev.detail }
            }));
        });
        /**
         * Wait for the client to be ready before start using it
         * Note: init() now returns the client instance and sets isReady=true internally
         */
        await client.init();
        // No need to call waitForReady() as init() already does that
        this.bindClientSystemMonitor(client, index);
        this.dispatchEvent(new CustomEvent("ready", { detail: { client, clientIdx: index } }));
    }
    async bindClientSystemMonitor(client, index) {
        if (client.ext.monitor.isSupported) {
            client.ext.monitor.on("system_monitor", (ev) => {
                this.dispatchEvent(new CustomEvent("system_monitor", {
                    detail: {
                        client,
                        data: ev.detail,
                        clientIdx: index
                    }
                }));
            });
        }
    }
    pushJobByWeight(item) {
        const idx = this.jobQueue.findIndex((job) => job.weight > item.weight);
        if (idx === -1) {
            return this.jobQueue.push(item);
        }
        else {
            this.jobQueue.splice(idx, 0, item);
            return idx;
        }
    }
    async claim(fn, weight, clientFilter, onError) {
        if (this.jobQueue.length >= this.maxQueueSize) {
            throw new Error("Job queue limit reached");
        }
        const inputWeight = weight === undefined ? this.jobQueue.length : weight;
        const idx = this.pushJobByWeight({
            weight: inputWeight,
            fn,
            excludeClientIds: clientFilter?.excludeIds,
            includeClientIds: clientFilter?.includeIds,
            requiredCheckpoints: clientFilter?.requiredCheckpoints,
            onError
        });
        this.dispatchEvent(new CustomEvent("add_job", {
            detail: { jobIdx: idx, weight: inputWeight }
        }));
        await this.processJobQueue();
    }
    async getAvailableClient(includeIds, excludeIds, requiredCheckpoints, timeout = -1) {
        let tries = 1;
        const start = Date.now();
        while (true) {
            if (timeout > 0 && Date.now() - start > timeout) {
                const msg = requiredCheckpoints && requiredCheckpoints.length > 0
                    ? `Timeout waiting for an available client with checkpoints: ${requiredCheckpoints.join(', ')}`
                    : `Timeout waiting for an available client`;
                throw new Error(msg);
            }
            if (tries < 100)
                tries++;
            let index = -1;
            // First, filter clients by online status, include/exclude lists
            let acceptedClients = this.clientStates.filter((c) => {
                if (!c.online)
                    return false;
                if (includeIds && includeIds.length > 0) {
                    return includeIds.includes(c.id);
                }
                if (excludeIds && excludeIds.length > 0) {
                    return !excludeIds.includes(c.id);
                }
                return true;
            });
            // If checkpoint requirements exist, further filter by checkpoint availability
            if (requiredCheckpoints && requiredCheckpoints.length > 0) {
                const checkpointFilteredClients = [];
                for (const clientState of acceptedClients) {
                    const client = this.clients.find(c => c.id === clientState.id);
                    if (!client)
                        continue;
                    const hasCheckpoints = await this.clientHasCheckpoints(client, requiredCheckpoints);
                    if (hasCheckpoints) {
                        checkpointFilteredClients.push(clientState);
                    }
                }
                if (checkpointFilteredClients.length === 0) {
                    // No clients have the required checkpoints
                    await delay(Math.min(tries * 10));
                    continue;
                }
                acceptedClients = checkpointFilteredClients;
            }
            // Now pick from the filtered list based on mode
            switch (this.mode) {
                case EQueueMode.PICK_ZERO:
                    index = acceptedClients.findIndex((c) => c.queueRemaining === 0 && !c.locked && c.id);
                    break;
                case EQueueMode.PICK_LOWEST:
                    const queueSizes = acceptedClients.map((state) => state.online ? state.queueRemaining : Number.MAX_SAFE_INTEGER);
                    index = queueSizes.indexOf(Math.min(...queueSizes));
                    break;
                case EQueueMode.PICK_ROUTINE:
                    index = this.routineIdx++ % acceptedClients.length;
                    this.routineIdx = this.routineIdx % acceptedClients.length;
                    break;
            }
            if (index !== -1 && acceptedClients[index]) {
                const trueIdx = this.clientStates.findIndex((c) => c.id === acceptedClients[index].id);
                this.clientStates[trueIdx].locked = true;
                return this.clients[trueIdx];
            }
            await delay(Math.min(tries * 10));
        }
    }
    async processJobQueue() {
        if (this.jobQueue.length === 0) {
            return;
        }
        while (this.jobQueue.length > 0) {
            const job = this.jobQueue.shift();
            if (!job)
                continue;
            try {
                const client = await this.getAvailableClient(job.includeClientIds, job.excludeClientIds, job.requiredCheckpoints, this.claimTimeoutMs);
                const clientIdx = this.clients.indexOf(client);
                await job.fn(client, clientIdx);
            }
            catch (error) {
                console.error("[ComfyPool] Error processing job:", error);
                try {
                    job?.onError?.(error);
                }
                catch { }
            }
        }
    }
}
// Test-only helpers (non-breaking; ignored at runtime usage)
export const __TEST_ONLY__ = {
    snapshotQueue(pool) {
        const queue = pool.jobQueue;
        return queue.map((j) => ({ weight: j.weight, include: j.includeClientIds, exclude: j.excludeClientIds }));
    }
};
//# sourceMappingURL=pool.js.map