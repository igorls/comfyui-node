import { classifyFailure } from "./helpers.js";
export class JobQueueProcessor {
    jobs;
    clientRegistry;
    logger;
    queue = [];
    workflowHash = "";
    isProcessing = false;
    maxAttempts = 3;
    constructor(stateRegistry, clientRegistry, workflowHash, logger) {
        this.logger = logger;
        this.logger.debug(`Creating JobQueueProcessor for workflow hash: '${workflowHash}'`);
        this.clientRegistry = clientRegistry;
        this.jobs = stateRegistry;
        this.workflowHash = workflowHash;
    }
    async enqueueJob(newJobId, workflow) {
        // validate job state on registry
        const jobStatus = this.jobs.getJobStatus(newJobId);
        if (jobStatus !== "pending") {
            throw new Error(`Cannot enqueue job ${newJobId} with status ${jobStatus}`);
        }
        this.queue.push({ jobId: newJobId, workflow, attempts: 1 });
        this.processQueue().catch(reason => {
            this.logger.error(`Error processing job queue for workflow hash ${this.workflowHash}:`, reason);
        });
    }
    async processQueue() {
        if (this.isProcessing) {
            this.logger.debug(`Job queue for workflow hash ${this.workflowHash} is already being processed, skipping.`);
            return;
        }
        this.isProcessing = true;
        // Get the next job in the queue
        const nextJob = this.queue.shift();
        if (nextJob) {
            this.logger.debug(`Processing job ${nextJob.jobId}`);
            let preferredClient;
            // If this processor is for the general queue, try to find a preferred client
            if (this.workflowHash === "general") {
                preferredClient = await this.clientRegistry.getOptimalIdleClient(nextJob.workflow);
            }
            else {
                preferredClient = this.clientRegistry.getOptimalClient(nextJob.workflow);
            }
            if (!preferredClient) {
                this.logger.debug(`No idle clients available for job ${nextJob.jobId}.`);
                // Mark as pending again
                this.jobs.setJobStatus(nextJob.jobId, "pending");
                // Re-add the job to the front of the queue for later processing
                this.queue.unshift(nextJob);
                this.isProcessing = false;
                return;
            }
            else {
                this.logger.info(`Assigning job ${nextJob.jobId} to client ${preferredClient.nodeName}`);
                this.jobs.setJobStatus(nextJob.jobId, "assigned", preferredClient.url);
                await this.runJobOnClient(nextJob, preferredClient);
            }
        }
        this.isProcessing = false;
        // Recursively process the next job if we have idle clients to handle them
        if (this.queue.length > 0) {
            let idleCount = 0;
            for (const client of this.clientRegistry.clients.values()) {
                this.logger.debug(`Client ${client.nodeName} state: ${client.state}`);
                if (client.state === "idle") {
                    idleCount++;
                }
            }
            if (idleCount > 0) {
                this.logger.debug(`Continuing to process next job in queue for workflow hash ${this.workflowHash}.`);
                try {
                    await this.processQueue();
                }
                catch (e) {
                    this.logger.error(`Error processing job queue for workflow hash ${this.workflowHash}:`, e);
                }
            }
        }
    }
    applyAutoSeed(workflow) {
        const autoSeeds = {};
        for (const [nodeId, nodeValue] of Object.entries(workflow)) {
            if (!nodeValue || typeof nodeValue !== "object")
                continue;
            const inputs = nodeValue.inputs;
            if (!inputs || typeof inputs !== "object")
                continue;
            if (typeof inputs.seed === "number" && inputs.seed === -1) {
                const val = Math.floor(Math.random() * 2_147_483_647);
                inputs.seed = val;
                autoSeeds[nodeId] = val;
            }
        }
        return autoSeeds;
    }
    async runJobOnClient(nextJob, preferredClient) {
        try {
            const api = preferredClient.api;
            // Check if client is idle before sending job
            const queueStatus = await api.getQueue();
            if (queueStatus.queue_running.length !== 0 || queueStatus.queue_pending.length !== 0) {
                this.logger.debug(`Client ${preferredClient.nodeName} is busy, re-adding job ${nextJob.jobId} to queue.`);
                this.jobs.setJobStatus(nextJob.jobId, "pending");
                this.queue.unshift(nextJob);
                return;
            }
            await this.processAttachedMedia(nextJob.workflow, api);
            const workflowJson = nextJob.workflow.toJSON();
            const autoSeeds = this.applyAutoSeed(workflowJson);
            if (Object.keys(autoSeeds).length > 0) {
                this.logger.queue(this.workflowHash, `Applied auto seeds for job ${nextJob.jobId}: ${JSON.stringify(autoSeeds)}`);
                this.jobs.updateJobAutoSeeds(nextJob.jobId, autoSeeds);
                // Update the workflow json with the new seeds before sending
                const nodeIds = Object.keys(autoSeeds);
                for (const nodeId of nodeIds) {
                    workflowJson[nodeId].inputs.seed = autoSeeds[nodeId];
                }
            }
            this.logger.queue(this.workflowHash, `Starting job ${nextJob.jobId} on client ${preferredClient.nodeName}`);
            const result = await api.ext.queue.queuePrompt(null, workflowJson);
            // at this point we have the prompt_id assigned by comfyui, we can mark the job as running
            if (result.prompt_id) {
                this.jobs.setPromptId(nextJob.jobId, result.prompt_id);
                this.jobs.setJobStatus(nextJob.jobId, "running");
                this.logger.queue(this.workflowHash, `Job ${nextJob.jobId} is now queued on client ${preferredClient.nodeName} with prompt ID ${result.prompt_id}`);
                // we also mark the client as busy, to prevent new jobs being assigned until we detect completion
                preferredClient.state = "busy";
                this.logger.debug(Array.from(this.clientRegistry.clients.values()).map((c) => `${c.nodeName}: ${c.state}`).join(", "));
            }
            else {
                this.logger.error(`Failed to enqueue job ${nextJob.jobId} on client ${preferredClient.nodeName}: No prompt_id returned.`);
                this.jobs.setJobStatus(nextJob.jobId, "failed");
            }
        }
        catch (e) {
            this.logger.error(`Failed to run job ${nextJob.jobId} on client ${preferredClient.nodeName}`);
            this.handleFailure(preferredClient, nextJob, e);
        }
    }
    dequeueJob(jobId) {
        this.queue = this.queue.filter(job => job.jobId !== jobId);
    }
    handleFailure(preferredClient, nextJob, e) {
        const { type, message } = classifyFailure(e);
        this.logger.queue(this.workflowHash, `Job ${nextJob.jobId} failed on ${preferredClient.nodeName}. Failure type: ${type}. Reason: ${message}`);
        switch (type) {
            case "connection":
                preferredClient.state = "offline"; // Mark as offline to be re-checked later
                this.logger.queue(this.workflowHash, `Re-queuing job ${nextJob.jobId} due to connection error.`);
                this.jobs.setJobStatus(nextJob.jobId, "pending");
                this.queue.unshift(nextJob); // Re-queue without incrementing attempts
                break;
            case "workflow_incompatibility":
                preferredClient.state = "idle";
                this.logger.queue(this.workflowHash, `Marking client ${preferredClient.nodeName} as incompatible with workflow ${nextJob.workflow.structureHash}.`);
                this.clientRegistry.markClientIncompatibleWithWorkflow(preferredClient.url, nextJob.workflow.structureHash);
                this.retryOrMarkFailed(nextJob, e);
                break;
            case "transient":
                preferredClient.state = "idle";
                this.logger.queue(this.workflowHash, `Job ${nextJob.jobId} failed with a transient error. It will not be retried.`);
                this.jobs.setJobFailure(nextJob.jobId, { error: message, details: e.bodyJSON });
                break;
        }
        // Trigger processing for the next job in the queue
        this.processQueue().catch(reason => {
            this.logger.error(`Error processing job queue for workflow hash ${this.workflowHash}:`, reason);
        });
    }
    retryOrMarkFailed(nextJob, originalError) {
        // Check if the job has exceeded its max attempts
        if (nextJob.attempts >= this.maxAttempts) {
            this.logger.queue(this.workflowHash, `Job ${nextJob.jobId} has reached max attempts (${this.maxAttempts}). Marking as failed.`);
            this.jobs.setJobFailure(nextJob.jobId, originalError.bodyJSON);
            return;
        }
        // Confirm if we should re-queue or fail the job
        const eligibleClients = this.clientRegistry.getAllEligibleClientsForWorkflow(nextJob.workflow);
        if (eligibleClients.length > 0) {
            this.logger.queue(this.workflowHash, `Re-queuing job ${nextJob.jobId} (attempt ${nextJob.attempts + 1}) as there are other eligible clients available.`);
            this.jobs.setJobStatus(nextJob.jobId, "pending");
            // Increment attempts and re-add to the front of the queue
            nextJob.attempts++;
            this.queue.unshift(nextJob);
        }
        else {
            this.logger.queue(this.workflowHash, `No other eligible clients for job ${nextJob.jobId}, marking as failed.`);
            this.jobs.setJobFailure(nextJob.jobId, originalError.bodyJSON);
        }
    }
    async processAttachedMedia(workflow, api) {
        await workflow.uploadAssets(api);
    }
}
//# sourceMappingURL=job-queue-processor.js.map