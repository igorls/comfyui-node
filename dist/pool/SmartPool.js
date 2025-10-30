import { hashWorkflow } from "src/pool/utils/hash.js";
import { ComfyApi } from "src/client.js";
import { PromptBuilder } from "src/prompt-builder.js";
const DEFAULT_SMART_POOL_OPTIONS = {
    connectionTimeoutMs: 10000
};
export class SmartPool {
    // Clients managed by the pool
    clientMap = new Map();
    // Queue state of pool clients
    clientQueueStates = new Map();
    // In-memory store for job records
    jobStore = new Map();
    // Affinities mapping workflow hashes to preferred clients
    affinities = new Map();
    // Pool options
    options;
    // Hooks for pool-wide events
    hooks = {};
    constructor(clients, options) {
        if (options) {
            this.options = { ...DEFAULT_SMART_POOL_OPTIONS, ...options };
        }
        else {
            this.options = DEFAULT_SMART_POOL_OPTIONS;
        }
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
    emit(event) {
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
                    console.log(value1);
                    this.clientQueueStates.set(value.apiHost, {
                        queuedJobs: value1.queue_pending.length,
                        runningJobs: value1.queue_running.length
                    });
                    resolve(true);
                });
            });
        });
        await Promise.allSettled(promises);
        console.log(this.clientQueueStates);
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
    async executeImmediate(workflow, opts) {
        const candidateClients = [];
        let workflowHash = workflow.structureHash;
        // Determine candidate clients based on preferred IDs
        if (opts.preferableClientIds && opts.preferableClientIds.length > 0) {
            for (const clientId of opts.preferableClientIds) {
                const client = this.clientMap.get(clientId);
                if (client && client.isReady) {
                    candidateClients.push(client);
                }
            }
        }
        else {
            // Check for affinity based on workflow hash
            console.log(`Looking up affinity for workflow hash: ${workflowHash}`);
            if (workflowHash) {
                const affinity = this.getAffinity(workflowHash);
                if (affinity && affinity.preferredClientIds) {
                    for (const clientId of affinity.preferredClientIds) {
                        const client = this.clientMap.get(clientId);
                        if (client && client.isReady) {
                            candidateClients.push(client);
                        }
                    }
                }
            }
        }
        if (candidateClients.length === 0) {
            // Fallback to any available client
            for (const client of this.clientMap.values()) {
                if (client.isReady) {
                    candidateClients.push(client);
                }
            }
        }
        if (candidateClients.length === 0) {
            throw new Error("No available clients match the preferred client IDs");
        }
        // For simplicity, pick the first available candidate client
        const selectedClient = candidateClients[0];
        workflowHash = workflowHash || workflow.structureHash || "";
        // Queue the workflow and get the prompt_id
        // Build PromptBuilder from the workflow to get proper prompt format
        const workflowJson = workflow.json || workflow;
        const outputNodeIds = workflow.outputNodeIds || [];
        // Auto-randomize any node input field named 'seed' whose value is -1 (common ComfyUI convention)
        const autoSeeds = {};
        try {
            for (const [nodeId, node] of Object.entries(workflowJson)) {
                const n = node;
                if (n && n.inputs && Object.prototype.hasOwnProperty.call(n.inputs, 'seed')) {
                    if (n.inputs.seed === -1) {
                        const val = Math.floor(Math.random() * 2_147_483_647); // 32-bit positive range typical for seeds
                        n.inputs.seed = val;
                        autoSeeds[nodeId] = val;
                    }
                }
            }
        }
        catch { /* non-fatal */ }
        const pb = new PromptBuilder(workflowJson, [], outputNodeIds);
        // Map output nodes
        for (const nodeId of outputNodeIds) {
            pb.setOutputNode(nodeId, nodeId);
        }
        const promptJson = pb.prompt;
        console.log(`[SmartPool] Queuing workflow with prompt containing nodes:`, Object.keys(promptJson || {}).slice(0, 5));
        try {
            const queueResponse = await selectedClient.ext.queue.appendPrompt(promptJson);
            const promptId = queueResponse.prompt_id;
            console.log(`[SmartPool] Queued workflow on ${selectedClient.apiHost} with promptId=${promptId.substring(0, 8)}...`);
            this.emit({
                type: "workflow:executeImmediate",
                promptId,
                workflowHash,
                clientId: selectedClient.apiHost
            });
            // Simple execution wrapper: collect outputs from executed events and handle completion
            const result = await this.waitForExecutionCompletion(selectedClient, promptId, workflow);
            console.log(`[SmartPool] Job completed with promptId: ${promptId.substring(0, 8)}...`);
            const images = [];
            // Fetch outputs using the authoritative prompt ID
            try {
                const historyData = await selectedClient.ext.history.getHistory(promptId);
                if (historyData && historyData.outputs) {
                    for (const nodeId of Object.keys(historyData.outputs)) {
                        const nodeOutput = historyData.outputs[nodeId];
                        if (nodeOutput.images && nodeOutput.images.length > 0) {
                            console.log(`[SmartPool] Found output from history node ${nodeId}: ${nodeOutput.images[0].filename}`);
                            images.push(...nodeOutput.images);
                            break;
                        }
                    }
                }
            }
            catch (e) {
                console.log(`[SmartPool] Failed to fetch history: ${e}`);
            }
            // Fallback to result object if history didn't give us images
            if (images.length === 0) {
                console.log(`[SmartPool] Falling back to result object`);
                const aliases = result._aliases || {};
                for (const aliasKey of Object.keys(aliases)) {
                    const aliasObject = result[aliases[aliasKey]];
                    if (aliasObject && aliasObject.images) {
                        images.push(...aliasObject.images);
                    }
                }
            }
            // Read images from the client that executed the workflow
            const imageBlob = await selectedClient.ext.file.getImage(images[0]);
            console.log(`[SmartPool] Fetched image blob for file: ${JSON.stringify(images[0])}`);
            console.log(`Workflow executed on client ${selectedClient.apiHost} with: `, result);
            return { ...result, images, imageBlob };
        }
        catch (err) {
            console.error(`[SmartPool] Failed to execute workflow:`, err);
            throw err;
        }
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
                console.log(`[SmartPool.waitForExecutionCompletion] Collected output from node: ${nodeId}`);
            };
            const executionSuccessHandler = async (ev) => {
                const eventPromptId = ev.detail.prompt_id;
                // Only process events for our specific prompt
                if (eventPromptId !== promptId) {
                    return;
                }
                console.log(`[SmartPool.waitForExecutionCompletion] execution_success fired for ${promptId.substring(0, 8)}...`);
                // Try to fetch complete outputs from history
                for (let retries = 0; retries < 5; retries++) {
                    try {
                        const historyData = await client.ext.history.getHistory(promptId);
                        if (historyData?.outputs) {
                            console.log(`[SmartPool.waitForExecutionCompletion] Found outputs in history (attempt ${retries + 1})`);
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