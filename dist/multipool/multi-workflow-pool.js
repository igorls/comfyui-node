import { ClientRegistry } from "./client-registry.js";
import { PoolEventManager } from "./pool-event-manager.js";
import { JobStateRegistry } from "./job-state-registry.js";
import { JobQueueProcessor } from "./job-queue-processor.js";
import { createLogger } from "./logger.js";
/**
 * MultiWorkflowPool class to manage heterogeneous clusters of ComfyUI workers with different workflow capabilities.
 * Using a fully event driven architecture to handle client connections, job submissions, and failover strategies.
 * Zero polling is used; all operations are event driven. Maximizes responsiveness and scalability.
 */
export class MultiWorkflowPool {
    // Event manager for handling pool events
    events;
    // Registry for managing clients in the pool
    clientRegistry;
    // Registry for managing job state
    jobRegistry;
    // Multi queue map, one per workflow based on the workflow hash
    queues = new Map();
    // Pool configuration
    options;
    // Logger instance
    logger;
    monitoringInterval;
    constructor(options) {
        this.options = {
            connectionTimeoutMs: options?.connectionTimeoutMs ?? 10000,
            enableMonitoring: options?.enableMonitoring ?? false,
            monitoringIntervalMs: options?.monitoringIntervalMs ?? 60000,
            logLevel: options?.logLevel ?? "warn",
            enableProfiling: options?.enableProfiling ?? false
        };
        this.logger = createLogger("MultiWorkflowPool", this.options.logLevel);
        this.events = new PoolEventManager(this);
        this.clientRegistry = new ClientRegistry(this, this.logger);
        this.jobRegistry = new JobStateRegistry(this, this.clientRegistry);
        // Create general queue for workflows without specific hashes
        this.queues.set("general", new JobQueueProcessor(this.jobRegistry, this.clientRegistry, "general", this.logger));
        // Monitoring
        if (this.options.enableMonitoring) {
            this.monitoringInterval = setInterval(() => {
                this.printStatusSummary();
            }, this.options.monitoringIntervalMs);
        }
    }
    // PUBLIC API
    async init() {
        if (this.clientRegistry.clients.size === 0) {
            throw new Error("No clients registered in the pool. Please add clients before initializing the pool.");
        }
        const connectionPromises = [];
        for (const client of this.clientRegistry.clients.values()) {
            connectionPromises.push(new Promise(async (resolve, reject) => {
                let timeout = setTimeout(() => {
                    client.api.abortReconnect();
                    reject(new Error(`Connection to client ${client.url} timed out`));
                }, this.options.connectionTimeoutMs);
                try {
                    const readyApi = await client.api.init(1);
                    clearTimeout(timeout);
                    timeout = null;
                    this.logger.info(`Connected to ${client.url}`);
                    client.api = readyApi;
                    this.attachHandlersToClient(client);
                    const queueStatus = await client.api.getQueue();
                    if (queueStatus.queue_running.length === 0 && queueStatus.queue_pending.length === 0) {
                        this.logger.debug(`Client ${client.url} is idle.`);
                        client.state = "idle";
                    }
                    else {
                        client.state = "busy";
                    }
                    resolve();
                }
                catch (e) {
                    client.state = "offline";
                    reject(e);
                }
                finally {
                    if (timeout) {
                        clearTimeout(timeout);
                    }
                }
            }));
        }
        const promiseResults = await Promise.allSettled(connectionPromises);
        const failedConnections = promiseResults.filter(result => result.status === "rejected");
        if (failedConnections.length > 0) {
            this.logger.warn(`Warning: ${failedConnections.length} client(s) failed to connect.`);
            failedConnections.forEach((result) => {
                if (result.status === "rejected") {
                    this.logger.error("Connection failed:", result.reason);
                }
            });
        }
        // Throw error if all connections failed
        if (failedConnections.length === this.clientRegistry.clients.size) {
            throw new Error("All clients failed to connect. Pool initialization failed.");
        }
        this.logger.info(`Initialization complete. ${this.clientRegistry.clients.size - failedConnections.length} client(s) connected successfully.`);
    }
    async shutdown() {
        this.logger.info("Shutting down MultiWorkflowPool...");
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
        }
        // Disconnect all clients
        const disconnectPromises = [];
        for (const client of this.clientRegistry.clients.values()) {
            disconnectPromises.push(new Promise(async (resolve) => {
                try {
                    client.api.destroy();
                    this.logger.debug(`Disconnected from client ${client.url}`);
                }
                catch (e) {
                    this.logger.error(`Error disconnecting from client ${client.url}:`, e);
                }
                finally {
                    resolve();
                }
            }));
        }
        await Promise.allSettled(disconnectPromises);
    }
    addClient(clientUrl, options) {
        this.clientRegistry.addClient(clientUrl, options);
    }
    removeClient(clientUrl) {
        this.clientRegistry.removeClient(clientUrl);
    }
    async submitJob(workflow) {
        let workflowHash = workflow.structureHash;
        if (!workflowHash) {
            workflow.updateHash();
            workflowHash = workflow.structureHash;
        }
        // check if there are clients with affinity for this workflow
        let queue;
        if (workflowHash && this.clientRegistry.hasClientsForWorkflow(workflowHash)) {
            queue = this.assertQueue(workflowHash);
        }
        else {
            queue = this.queues.get("general");
            this.logger.debug(`No clients with affinity for workflow hash ${workflowHash}, using general queue.`);
        }
        if (!queue) {
            throw new Error("Failed to create or retrieve job queue for workflow.");
        }
        const newJobId = this.jobRegistry.addJob(workflow);
        await queue.enqueueJob(newJobId, workflow);
        return newJobId;
    }
    getJobStatus(jobId) {
        return this.jobRegistry.getJobStatus(jobId);
    }
    async cancelJob(jobId) {
        return this.jobRegistry.cancelJob(jobId);
    }
    attachEventHook(event, listener) {
        if (event && listener) {
            this.events.attachHook(event, listener);
        }
    }
    // PRIVATE METHODS
    assertQueue(workflowHash) {
        if (!workflowHash) {
            return null;
        }
        let queue = this.queues.get(workflowHash);
        if (!queue) {
            queue = new JobQueueProcessor(this.jobRegistry, this.clientRegistry, workflowHash, this.logger);
            this.queues.set(workflowHash, queue);
        }
        return queue;
    }
    attachHandlersToClient(client) {
        // client.api.on("all", event => {
        //   console.log(client.nodeName, event.detail.type, event.detail.data);
        // });
        client.api.on("status", event => {
            this.logger.client(client.nodeName, event.type, `Queue Remaining: ${event.detail.status.exec_info.queue_remaining}`);
            // Update client state based on status
            if (event.detail.status.exec_info.queue_remaining === 0) {
                client.state = "idle";
                // Trigger queue processing
                client.workflowAffinity?.forEach(value => {
                    this.logger.debug(`Triggering queue processing for workflow hash ${value} due to client ${client.nodeName} becoming idle.`);
                    const queue = this.queues.get(value);
                    if (queue) {
                        queue.processQueue().catch(reason => {
                            this.logger.error(`Error processing job queue for workflow hash ${value}:`, reason);
                        });
                    }
                });
            }
            else {
                client.state = "busy";
            }
        });
        client.api.on("b_preview_meta", event => {
            const prompt_id = event.detail.metadata.prompt_id;
            if (prompt_id) {
                this.jobRegistry.updateJobPreviewMetadata(prompt_id, event.detail.metadata, event.detail.blob);
                this.logger.debug(`[${event.type}@${client.nodeName}] Preview metadata for prompt ID: ${prompt_id} | blob size: ${event.detail.blob.size} (${event.detail.metadata.image_type})`);
            }
            else {
                this.logger.warn(`[${event.type}@${client.nodeName}] Preview metadata received without prompt ID.`);
            }
        });
        // Handle finished nodes, extract image for prompt_id
        client.api.on("executed", event => {
            const prompt_id = event.detail.prompt_id;
            if (prompt_id) {
                const output = event.detail.output;
                if (output && output.images) {
                    this.jobRegistry.addJobImages(prompt_id, output.images);
                }
                this.logger.debug(`[${event.type}@${client.nodeName}] Node executed for prompt ID: ${prompt_id}`, event.detail.output);
            }
            else {
                this.logger.warn(`[${event.type}@${client.nodeName}] Executed event received without prompt ID.`);
            }
        });
        client.api.on("progress", event => {
            const prompt_id = event.detail.prompt_id;
            if (prompt_id) {
                const nodeId = event.detail.node;
                this.jobRegistry.updateJobProgress(prompt_id, event.detail.value, event.detail.max, nodeId !== null ? nodeId : undefined);
                this.logger.debug(`[${event.type}@${client.nodeName}] Progress for prompt ID: ${prompt_id} | ${Math.round(event.detail.value / event.detail.max * 100)}%`);
            }
            else {
                this.logger.warn(`[${event.type}@${client.nodeName}] Progress event received without prompt ID.`);
            }
        });
        // Track node execution for profiling
        client.api.on("executing", event => {
            const prompt_id = event.detail.prompt_id;
            const nodeId = event.detail.node;
            if (prompt_id) {
                if (nodeId === null) {
                    // Execution completed (node: null event)
                    this.logger.debug(`[${event.type}@${client.nodeName}] Execution complete for prompt ID: ${prompt_id}`);
                }
                else {
                    // Node started executing
                    this.jobRegistry.onNodeExecuting(prompt_id, String(nodeId));
                    this.logger.debug(`[${event.type}@${client.nodeName}] Node ${nodeId} executing for prompt ID: ${prompt_id}`);
                }
            }
        });
        // Track cached nodes for profiling
        client.api.on("execution_cached", event => {
            const prompt_id = event.detail.prompt_id;
            const nodeIds = event.detail.nodes;
            if (prompt_id && nodeIds && Array.isArray(nodeIds)) {
                this.jobRegistry.onCachedNodes(prompt_id, nodeIds.map(String));
                this.logger.debug(`[${event.type}@${client.nodeName}] ${nodeIds.length} nodes cached for prompt ID: ${prompt_id}`);
            }
        });
        client.api.on("execution_success", event => {
            const prompt_id = event.detail.prompt_id;
            if (prompt_id) {
                this.logger.client(client.nodeName, event.type, `Execution success for prompt ID: ${prompt_id}`);
                // Mark client as idle first
                client.state = "idle";
                // Mark job as completed, it will trigger queue processing
                this.jobRegistry.completeJob(prompt_id);
            }
        });
    }
    printStatusSummary() {
        console.log("\n" + "=".repeat(80));
        console.log("MULTI-WORKFLOW POOL STATUS SUMMARY");
        console.log("=".repeat(80));
        // Print client states using console.table
        if (this.clientRegistry.clients.size > 0) {
            console.log("\n📋 CLIENT STATES:");
            const clientData = Array.from(this.clientRegistry.clients.values()).map(client => ({
                "URL": client.url,
                "Node Name": client.nodeName,
                "State": client.state,
                "Priority": client.priority !== undefined ? client.priority : "N/A"
            }));
            console.table(clientData);
        }
        else {
            console.log("\n📋 CLIENT STATES: No clients registered");
        }
        // Print queue states using console.table
        if (this.queues.size > 0) {
            console.log("\n📬 QUEUE STATES:");
            const queueData = Array.from(this.queues.entries()).map(([workflowHash, queue]) => ({
                "Workflow Hash": workflowHash.length > 50 ? workflowHash.substring(0, 47) + "..." : workflowHash,
                "Jobs Pending": queue.queue.length,
                "Type": workflowHash === "general" ? "General" : "Specific"
            }));
            console.table(queueData);
        }
        else {
            console.log("\n📬 QUEUE STATES: No queues found");
        }
        console.log("");
    }
    async waitForJobCompletion(jobId) {
        return await this.jobRegistry.waitForResults(jobId);
    }
    attachJobProgressListener(jobId, progressListener) {
        this.jobRegistry.attachJobProgressListener(jobId, progressListener);
    }
    attachJobPreviewListener(jobId, previewListener) {
        this.jobRegistry.attachJobPreviewListener(jobId, previewListener);
    }
}
//# sourceMappingURL=multi-workflow-pool.js.map