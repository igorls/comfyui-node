import { randomUUID } from "node:crypto";
export class JobStateRegistry {
    pool;
    clients;
    // Map of jobId to JobState
    jobs = new Map();
    // Map of prompt_id to jobId
    promptIdToJobId = new Map();
    constructor(pool, clients) {
        this.pool = pool;
        this.clients = clients;
    }
    addJob(workflow) {
        // Create new job id
        const jobId = randomUUID();
        let resolver = null;
        const resultsPromise = new Promise((resolve) => {
            resolver = resolve;
        });
        const jobState = {
            jobId,
            workflow,
            status: "pending",
            resolver,
            resultsPromise
        };
        this.jobs.set(jobId, jobState);
        return jobId;
    }
    getJobStatus(jobId) {
        const jobState = this.jobs.get(jobId);
        if (!jobState) {
            throw new Error(`Job with ID ${jobId} not found.`);
        }
        return jobState.status;
    }
    async cancelJob(jobId) {
        const jobState = this.jobs.get(jobId);
        if (!jobState) {
            throw new Error(`Job with ID ${jobId} not found.`);
        }
        if (jobState.status === "completed" || jobState.status === "canceled") {
            throw new Error(`Cannot cancel job ${jobId} with status ${jobState.status}.`);
        }
        if (jobState.status === "assigned" || jobState.status === "running") {
            // Notify assigned client to cancel the job
            if (jobState.assignedClientUrl) {
                const client = this.clients.clients.get(jobState.assignedClientUrl);
                if (client) {
                    try {
                        await client.api.ext.queue.interrupt(jobState.prompt_id);
                        // Mark job as canceled
                        jobState.status = "canceled";
                        // Mark client as idle
                        client.state = "idle";
                        // Also resolve the promise to avoid hanging
                        if (jobState.resolver) {
                            const results = {
                                status: "canceled",
                                jobId: jobState.jobId,
                                prompt_id: jobState.prompt_id,
                                images: []
                            };
                            jobState.resolver(results);
                            jobState.resolver = null;
                        }
                        // Process the queue to allow next job to proceed
                        this.processQueue(jobState.workflow.structureHash);
                    }
                    catch (e) {
                        console.error(`Failed to notify client ${jobState.assignedClientUrl} to cancel job ${jobId}:`, e);
                    }
                }
            }
        }
        else {
            // For pending or no_clients status, just mark as canceled
            jobState.status = "canceled";
            // Also resolve the promise to avoid hanging
            if (jobState.resolver) {
                const results = {
                    status: "canceled",
                    jobId: jobState.jobId,
                    prompt_id: jobState.prompt_id,
                    images: []
                };
                jobState.resolver(results);
                jobState.resolver = null;
            }
            // Remove from queue if necessary
            this.removeJobFromQueue(jobState);
        }
    }
    setJobStatus(jobId, newStatus, assignedClientUrl) {
        const jobState = this.jobs.get(jobId);
        if (!jobState) {
            throw new Error(`Job with ID ${jobId} not found.`);
        }
        jobState.status = newStatus;
        if (assignedClientUrl) {
            jobState.assignedClientUrl = assignedClientUrl;
        }
    }
    updateJobAutoSeeds(jobId, autoSeeds) {
        const jobState = this.jobs.get(jobId);
        if (!jobState) {
            throw new Error(`Job with ID ${jobId} not found.`);
        }
        jobState.autoSeeds = autoSeeds;
    }
    setPromptId(jobId, prompt_id) {
        const jobState = this.jobs.get(jobId);
        if (!jobState) {
            throw new Error(`Job with ID ${jobId} not found.`);
        }
        jobState.prompt_id = prompt_id;
        this.promptIdToJobId.set(prompt_id, jobId);
    }
    completeJob(prompt_id) {
        const jobState = this.jobs.get(this.promptIdToJobId.get(prompt_id) || "");
        if (!jobState || !jobState.prompt_id) {
            throw new Error(`No job state found for prompt_id ${prompt_id} when completing job.`);
        }
        if (jobState.prompt_id === prompt_id) {
            jobState.status = "completed";
            if (jobState.resolver) {
                const results = {
                    status: "completed",
                    jobId: jobState.jobId,
                    prompt_id: jobState.prompt_id,
                    images: []
                };
                // Prepare images
                if (jobState.images && jobState.images.length > 0 && jobState.assignedClientUrl) {
                    const client = this.clients.clients.get(jobState.assignedClientUrl);
                    if (client) {
                        for (let i = 0; i < jobState.images.length; i++) {
                            const image = jobState.images[i];
                            const imageUrl = client.api.ext.file.getPathImage(image);
                            results.images.push(imageUrl);
                        }
                    }
                }
                jobState.resolver(results);
                jobState.resolver = null;
            }
        }
    }
    processQueue(structureHash) {
        let queue = this.pool.queues.get(structureHash || "general");
        if (queue) {
            queue.processQueue().catch(reason => {
                console.error(`Error processing job queue for workflow hash ${structureHash}:`, reason);
            });
        }
    }
    async waitForResults(jobId) {
        const jobState = this.jobs.get(jobId);
        if (!jobState) {
            throw new Error(`Job with ID ${jobId} not found.`);
        }
        if (!jobState.resultsPromise) {
            throw new Error(`Job with ID ${jobId} does not have a results promise.`);
        }
        return jobState.resultsPromise;
    }
    addJobImages(prompt_id, images) {
        const state = this.jobs.get(this.promptIdToJobId.get(prompt_id) || "");
        if (!state) {
            throw new Error(`No job state found for prompt_id ${prompt_id} when adding images.`);
        }
        if (state.prompt_id === prompt_id) {
            state.images = [...images];
            return;
        }
    }
    removeJobFromQueue(jobState) {
        let queue = this.pool.queues.get(jobState.workflow.structureHash || "general");
        if (queue) {
            queue.dequeueJob(jobState.jobId);
        }
    }
    attachJobProgressListener(jobId, progressListener) {
        const jobState = this.jobs.get(jobId);
        if (!jobState) {
            throw new Error(`Job with ID ${jobId} not found.`);
        }
        jobState.onProgress = progressListener;
    }
    attachJobPreviewListener(jobId, previewListener) {
        const jobState = this.jobs.get(jobId);
        if (!jobState) {
            throw new Error(`Job with ID ${jobId} not found.`);
        }
        jobState.onPreview = previewListener;
    }
    updateJobProgress(prompt_id, value, max) {
        const state = this.jobs.get(this.promptIdToJobId.get(prompt_id) || "");
        if (!state) {
            console.warn(`No job state found for prompt_id ${prompt_id} when updating progress.`);
            return;
        }
        if (state.onProgress && state.prompt_id === prompt_id) {
            state.onProgress({ value, max });
        }
    }
    updateJobPreviewMetadata(prompt_id, metadata, blob) {
        const state = this.jobs.get(this.promptIdToJobId.get(prompt_id) || "");
        if (!state) {
            console.warn(`No job state found for prompt_id ${prompt_id} when updating preview metadata.`);
            return;
        }
        if (state.onPreview && state.prompt_id === prompt_id) {
            state.onPreview({ metadata, blob });
        }
    }
    setJobFailure(jobId, bodyJSON) {
        const jobState = this.jobs.get(jobId);
        if (!jobState) {
            throw new Error(`Job with ID ${jobId} not found.`);
        }
        jobState.status = "failed";
        if (jobState.resolver) {
            const results = {
                status: "failed",
                jobId: jobState.jobId,
                prompt_id: jobState.prompt_id,
                images: [],
                error: bodyJSON
            };
            jobState.resolver(results);
            jobState.resolver = null;
        }
    }
}
//# sourceMappingURL=job-state-registry.js.map