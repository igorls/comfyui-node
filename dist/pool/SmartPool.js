import { randomUUID } from "node:crypto";
import { hashWorkflow } from "src/pool/utils/hash.js";
import { ComfyApi } from "src/client.js";
import { PromptBuilder } from "src/prompt-builder.js";
import { MemoryQueueAdapter } from "./queue/adapters/memory.js";
import { TypedEventTarget } from "src/typed-event-target.js";
const DEFAULT_SMART_POOL_OPTIONS = {
    connectionTimeoutMs: 10000
};
export class SmartPool extends TypedEventTarget {
    // Clients managed by the pool
    clientMap = new Map();
    // Queue state of pool clients
    clientQueueStates = new Map();
    // In-memory store for job records
    jobStore = new Map();
    // Affinities mapping workflow hashes to preferred clients
    affinities = new Map();
    // Queue adapter for job persistence
    queueAdapter;
    // Flag to prevent concurrent queue processing
    processingNextJob = false;
    // Pool options
    options;
    // Hooks for pool-wide events
    hooks = {};
    constructor(clients, options) {
        super();
        if (options) {
            this.options = { ...DEFAULT_SMART_POOL_OPTIONS, ...options };
        }
        else {
            this.options = DEFAULT_SMART_POOL_OPTIONS;
        }
        // Initialize queue adapter
        this.queueAdapter = new MemoryQueueAdapter();
        for (const client of clients) {
            if (typeof client === "string") {
                const apiClient = new ComfyApi(client);
                this.clientMap.set(apiClient.apiHost, apiClient);
            }
            else {
                this.clientMap.set(client.apiHost, client);
            }
        }
    }
    emitLegacy(event) {
        if (this.hooks.any) {
            this.hooks.any(event);
        }
        const specificHook = this.hooks[event.type];
        if (specificHook) {
            specificHook(event);
        }
    }
    async connect() {
        const connectionPromises = [];
        const tRefZero = Date.now();
        for (const [url, client] of this.clientMap.entries()) {
            connectionPromises.push(new Promise(async (resolve, reject) => {
                const timeout = setTimeout(() => {
                    client.abortReconnect();
                    reject(new Error(`Connection to client at ${url} timed out`));
                }, this.options.connectionTimeoutMs);
                try {
                    const comfyApi = await client.init(1);
                    comfyApi.on("connected", (event) => {
                        if (event.type === "connected") {
                            const tRefDone = Date.now();
                            const tDelta = tRefDone - tRefZero;
                            console.log(`Client at ${url} (${event.target?.osType}) connected via websockets in ${tDelta} ms`);
                            resolve(comfyApi);
                        }
                    });
                }
                catch (reason) {
                    console.error(`Failed to connect to client at ${url}:`, reason);
                    reject(reason);
                }
                finally {
                    clearTimeout(timeout);
                }
            }));
        }
        // Wait for all connection attempts to settle
        const results = await Promise.allSettled(connectionPromises);
        // Check for any rejected connections
        const rejected = results.filter(result => result.status === "rejected");
        // Warn if there are any rejected connections
        if (rejected.length > 0) {
            console.warn(`${rejected.length} client(s) failed to connect.`);
            for (const rejectedClient of rejected) {
                console.warn(`Client rejection reason: ${rejectedClient.reason}`);
            }
        }
        // Sync queue states after connections
        await this.syncQueueStates();
    }
    shutdown() {
        for (const client of this.clientMap.values()) {
            try {
                client.destroy();
            }
            catch (reason) {
                console.error(`Error shutting down client at ${client.apiHost}:`, reason);
            }
        }
    }
    async syncQueueStates() {
        const promises = Array
            .from(this.clientMap.values())
            .filter(value => value.isReady)
            .map(value => {
            return new Promise(resolve => {
                value.getQueue().then(value1 => {
                    this.clientQueueStates.set(value.apiHost, {
                        queuedJobs: value1.queue_pending.length,
                        runningJobs: value1.queue_running.length
                    });
                    resolve(true);
                });
            });
        });
        await Promise.allSettled(promises);
    }
    // Add a job record to the pool
    addJob(jobId, jobRecord) {
        this.jobStore.set(jobId, jobRecord);
    }
    // Get a job record from the pool
    getJob(jobId) {
        return this.jobStore.get(jobId);
    }
    // Remove a job record from the pool
    removeJob(jobId) {
        this.jobStore.delete(jobId);
    }
    // Set the affinity for a workflow
    setAffinity(workflow, affinity) {
        const workflowHash = hashWorkflow(workflow);
        this.affinities.set(workflowHash, {
            workflowHash,
            ...affinity
        });
    }
    // Get the affinity for a workflow
    getAffinity(workflowHash) {
        return this.affinities.get(workflowHash);
    }
    // Remove the affinity for a workflow
    removeAffinity(workflowHash) {
        this.affinities.delete(workflowHash);
    }
    /**
     * Enqueue a workflow for execution by the pool.
     * Auto-triggers processing via setImmediate (batteries included).
     */
    async enqueue(workflow, opts) {
        const jobId = randomUUID();
        const workflowHash = workflow.structureHash || hashWorkflow(workflow.json || workflow);
        const workflowJson = workflow.json || workflow;
        const outputNodeIds = workflow.outputNodeIds || [];
        const outputAliases = workflow.outputAliases || {};
        // Create job record
        const jobRecord = {
            jobId,
            workflow: workflowJson,
            workflowHash,
            options: {
                maxAttempts: 3,
                retryDelayMs: 1000,
                priority: opts?.priority ?? 0,
                preferredClientIds: opts?.preferredClientIds ?? [],
                excludeClientIds: [],
                metadata: {}
            },
            attempts: 0,
            enqueuedAt: Date.now(),
            workflowMeta: {
                outputNodeIds,
                outputAliases
            },
            status: "queued"
        };
        // Store in job store
        this.jobStore.set(jobId, jobRecord);
        // Create payload for queue adapter
        const payload = jobRecord;
        // Enqueue with priority
        await this.queueAdapter.enqueue(payload, {
            priority: opts?.priority ?? 0
        });
        // Emit queued event
        this.dispatchEvent(new CustomEvent("job:queued", { detail: { job: jobRecord } }));
        // Auto-trigger queue processing immediately (not via setImmediate, so it processes right away)
        setImmediate(() => this.processNextJobQueued());
        return jobId;
    }
    /**
     * Entry point for queue processing with deduplication guard.
     * Prevents concurrent processing of jobs.
     * Poll-based approach: check idle servers, collect compatible jobs, enqueue only when slots available.
     */
    async processNextJobQueued() {
        if (this.processingNextJob) {
            return;
        }
        this.processingNextJob = true;
        try {
            // Continuously sync queue states and process available work
            while (true) {
                // Update queue states from all clients
                await this.syncQueueStates();
                // Find idle servers (not running, not pending)
                const idleServers = this.findIdleServers();
                if (idleServers.length === 0) {
                    // No idle servers, wait a bit then check again
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    continue;
                }
                // Try to assign jobs to idle servers
                const jobsAssigned = await this.assignJobsToIdleServers(idleServers);
                if (jobsAssigned === 0) {
                    // No jobs could be assigned, wait then try again
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    continue;
                }
                // Jobs were assigned, give them time to start then re-check
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        finally {
            this.processingNextJob = false;
        }
    }
    /**
     * Find servers that are currently idle (no running or pending jobs)
     */
    findIdleServers() {
        const idleServers = [];
        for (const [clientId, client] of this.clientMap) {
            if (!client.isReady)
                continue;
            const state = this.clientQueueStates.get(clientId);
            if (state && state.queuedJobs === 0 && state.runningJobs === 0) {
                idleServers.push(client);
            }
        }
        return idleServers;
    }
    /**
     * Assign compatible jobs from our queue to idle servers
     * Returns number of jobs assigned
     */
    async assignJobsToIdleServers(idleServers) {
        let jobsAssigned = 0;
        // Peek at pending jobs
        const pendingJobs = await this.queueAdapter.peek(100);
        if (pendingJobs.length === 0) {
            return 0;
        }
        const matches = [];
        for (const payload of pendingJobs) {
            const job = this.jobStore.get(payload.jobId);
            if (!job)
                continue;
            // Find compatible idle server for this job
            for (const server of idleServers) {
                if (this.isJobCompatibleWithServer(payload, job, server)) {
                    matches.push({
                        payload,
                        job,
                        compatibleServer: server
                    });
                    break; // Found a compatible server, move to next job
                }
            }
        }
        // Sort by selectivity (jobs with fewer compatible servers first)
        matches.sort((a, b) => {
            const aCompatCount = idleServers.filter(s => this.isJobCompatibleWithServer(a.payload, a.job, s)).length;
            const bCompatCount = idleServers.filter(s => this.isJobCompatibleWithServer(b.payload, b.job, s)).length;
            return aCompatCount - bCompatCount;
        });
        // Assign jobs to idle servers
        const assignedServers = new Set();
        for (const match of matches) {
            // Skip if we already assigned to this server
            if (assignedServers.has(match.compatibleServer.apiHost)) {
                continue;
            }
            // Reserve this specific job
            const reservation = await this.queueAdapter.reserveById(match.job.jobId);
            if (!reservation) {
                continue;
            }
            try {
                const result = await this.enqueueJobOnServer(match.job, match.compatibleServer);
                if (result) {
                    assignedServers.add(match.compatibleServer.apiHost);
                    jobsAssigned++;
                    // Commit to our queue
                    await this.queueAdapter.commit(reservation.reservationId);
                }
                else {
                    // Enqueue failed, retry later
                    await this.queueAdapter.retry(reservation.reservationId, { delayMs: 1000 });
                }
            }
            catch (error) {
                // Retry on error
                await this.queueAdapter.retry(reservation.reservationId, { delayMs: 1000 });
            }
        }
        return jobsAssigned;
    }
    /**
     * Check if a job is compatible with a server
     */
    isJobCompatibleWithServer(payload, job, server) {
        // Check preferred client IDs first
        if (payload.options.preferredClientIds && payload.options.preferredClientIds.length > 0) {
            return payload.options.preferredClientIds.includes(server.apiHost);
        }
        // Check workflow affinity
        const affinity = this.getAffinity(payload.workflowHash);
        if (affinity && affinity.preferredClientIds) {
            return affinity.preferredClientIds.includes(server.apiHost);
        }
        // No constraints, compatible with any server
        return true;
    }
    /**
     * Enqueue a job on a specific server
     * Returns true if successful, false if failed
     */
    async enqueueJobOnServer(job, server) {
        try {
            const workflowJson = job.workflow;
            const outputNodeIds = job.workflowMeta?.outputNodeIds || [];
            // Auto-randomize any seed fields set to -1
            try {
                for (const [_, node] of Object.entries(workflowJson)) {
                    const n = node;
                    if (n && n.inputs && Object.prototype.hasOwnProperty.call(n.inputs, 'seed')) {
                        if (n.inputs.seed === -1) {
                            const val = Math.floor(Math.random() * 2_147_483_647);
                            n.inputs.seed = val;
                        }
                    }
                }
            }
            catch { /* non-fatal */ }
            // Build prompt
            const pb = new PromptBuilder(workflowJson, [], outputNodeIds);
            for (const nodeId of outputNodeIds) {
                pb.setOutputNode(nodeId, nodeId);
            }
            const promptJson = pb.prompt;
            // Queue on client
            const queueResponse = await server.ext.queue.appendPrompt(promptJson);
            const promptId = queueResponse.prompt_id;
            // Update job record
            job.status = "running";
            job.clientId = server.apiHost;
            job.promptId = promptId;
            job.attempts += 1;
            this.dispatchEvent(new CustomEvent("job:accepted", { detail: { job } }));
            this.dispatchEvent(new CustomEvent("job:started", { detail: { job } }));
            // Run execution in background
            this.waitForExecutionCompletion(server, promptId, { json: workflowJson })
                .then((result) => {
                job.status = "completed";
                job.result = result;
                job.completedAt = Date.now();
                this.dispatchEvent(new CustomEvent("job:completed", { detail: { job } }));
                // Trigger next processing since job completed
                setImmediate(() => this.processNextJobQueued());
            })
                .catch((error) => {
                job.status = "failed";
                job.lastError = error;
                job.completedAt = Date.now();
                this.dispatchEvent(new CustomEvent("job:failed", { detail: { job, willRetry: false } }));
                // Trigger next processing since job completed
                setImmediate(() => this.processNextJobQueued());
            });
            return true;
        }
        catch (error) {
            console.error(`[SmartPool] Failed to enqueue job on ${server.apiHost}:`, error);
            return false;
        }
    }
    /**
     * Retrieve images from a completed job's execution.
     */
    async getJobOutputImages(jobId, nodeId) {
        const job = this.jobStore.get(jobId);
        if (!job) {
            throw new Error(`Job ${jobId} not found`);
        }
        if (!job.clientId) {
            throw new Error(`Job ${jobId} has no client assigned`);
        }
        if (!job.promptId) {
            throw new Error(`Job ${jobId} has no promptId assigned`);
        }
        const client = this.clientMap.get(job.clientId);
        if (!client) {
            throw new Error(`Client ${job.clientId} not found`);
        }
        // Fetch history
        const historyData = await client.ext.history.getHistory(job.promptId);
        if (!historyData?.outputs) {
            return [];
        }
        const images = [];
        // Find images in specified node or first node with images
        const outputEntries = Object.entries(historyData.outputs);
        for (const [nId, nodeOutput] of outputEntries) {
            if (nodeId && nId !== nodeId) {
                continue;
            }
            const output = nodeOutput;
            if (output.images && Array.isArray(output.images)) {
                for (const imageRef of output.images) {
                    try {
                        const blob = await client.ext.file.getImage(imageRef);
                        images.push({
                            filename: imageRef.filename || `image_${nId}`,
                            blob
                        });
                    }
                    catch (e) {
                        console.error(`Failed to fetch image from node ${nId}:`, e);
                    }
                }
                if (nodeId) {
                    // Found specified node, stop searching
                    break;
                }
            }
        }
        return images;
    }
    async executeImmediate(workflow, opts) {
        // Enqueue with maximum priority
        const jobId = await this.enqueue(workflow, {
            preferredClientIds: opts.preferableClientIds,
            priority: 1000 // High priority for immediate execution
        });
        // Wait for job completion via event listener
        return new Promise((resolve, reject) => {
            const onComplete = (event) => {
                const customEvent = event;
                if (customEvent.detail.job.jobId === jobId) {
                    cleanup();
                    const job = customEvent.detail.job;
                    this.buildExecuteImmediateResult(job)
                        .then(resolve)
                        .catch(reject);
                }
            };
            const onFailed = (event) => {
                const customEvent = event;
                if (customEvent.detail.job.jobId === jobId) {
                    cleanup();
                    reject(new Error(`Job failed: ${JSON.stringify(customEvent.detail.job.lastError)}`));
                }
            };
            let cleanup = () => {
                this.removeEventListener("job:completed", onComplete);
                this.removeEventListener("job:failed", onFailed);
                clearTimeout(timeoutHandle);
            };
            this.addEventListener("job:completed", onComplete);
            this.addEventListener("job:failed", onFailed);
            // Timeout after 5 minutes
            const timeoutHandle = setTimeout(() => {
                cleanup();
                reject(new Error("Execution timeout"));
            }, 5 * 60 * 1000);
        });
    }
    /**
     * Build the return value for executeImmediate() with images and blob.
     */
    async buildExecuteImmediateResult(job) {
        const images = [];
        let imageBlob;
        // Fetch images from job
        try {
            const jobImages = await this.getJobOutputImages(job.jobId);
            for (const img of jobImages) {
                images.push({
                    filename: img.filename
                });
                imageBlob = img.blob;
            }
        }
        catch (e) {
            console.log(`[SmartPool] Failed to fetch images: ${e}`);
        }
        return {
            ...job.result,
            images,
            imageBlob,
            _promptId: job.promptId
        };
    }
    async waitForExecutionCompletion(client, promptId, workflow) {
        return new Promise((resolve, reject) => {
            const result = {
                _promptId: promptId,
                _aliases: {},
                _nodes: []
            };
            const collectedNodes = new Set();
            const executedHandler = (ev) => {
                const eventPromptId = ev.detail.prompt_id;
                // Only process events for our specific prompt
                if (eventPromptId !== promptId) {
                    return;
                }
                const nodeId = ev.detail.node;
                const output = ev.detail.output;
                // Store output keyed by node ID
                result[nodeId] = output;
                collectedNodes.add(nodeId);
            };
            const executionSuccessHandler = async (ev) => {
                const eventPromptId = ev.detail.prompt_id;
                // Only process events for our specific prompt
                if (eventPromptId !== promptId) {
                    return;
                }
                // Try to fetch complete outputs from history
                for (let retries = 0; retries < 5; retries++) {
                    try {
                        const historyData = await client.ext.history.getHistory(promptId);
                        if (historyData?.outputs) {
                            // Populate result from history for any nodes we didn't get from websocket
                            for (const [nodeIdStr, nodeOutput] of Object.entries(historyData.outputs)) {
                                const nodeId = parseInt(nodeIdStr, 10).toString();
                                // Only add if we haven't collected this node yet
                                if (!collectedNodes.has(nodeId) && nodeOutput) {
                                    // Extract the actual output value
                                    const outputValue = Array.isArray(nodeOutput) ? nodeOutput[0] : Object.values(nodeOutput)[0];
                                    if (outputValue !== undefined) {
                                        result[nodeId] = outputValue;
                                        collectedNodes.add(nodeId);
                                    }
                                }
                            }
                            // Store collected node IDs
                            result._nodes = Array.from(collectedNodes);
                            cleanup();
                            resolve(result);
                            return;
                        }
                    }
                    catch (e) {
                        // Continue retrying
                    }
                    if (retries < 4) {
                        await new Promise(r => setTimeout(r, 100));
                    }
                }
                // Resolve even if we didn't get all outputs
                result._nodes = Array.from(collectedNodes);
                cleanup();
                resolve(result);
            };
            const executionErrorHandler = (ev) => {
                const eventPromptId = ev.detail.prompt_id;
                if (eventPromptId !== promptId) {
                    return;
                }
                console.error(`[SmartPool.waitForExecutionCompletion] Execution error:`, ev.detail);
                cleanup();
                reject(new Error(`Execution failed: ${JSON.stringify(ev.detail)}`));
            };
            const cleanup = () => {
                offExecuted?.();
                offExecutionSuccess?.();
                offExecutionError?.();
                clearTimeout(timeoutHandle);
            };
            const offExecuted = client.on("executed", executedHandler);
            const offExecutionSuccess = client.on("execution_success", executionSuccessHandler);
            const offExecutionError = client.on("execution_error", executionErrorHandler);
            // Timeout after 5 minutes
            const timeoutHandle = setTimeout(() => {
                cleanup();
                reject(new Error("Execution timeout"));
            }, 5 * 60 * 1000);
        });
    }
}
//# sourceMappingURL=SmartPool.js.map