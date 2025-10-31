import { Workflow } from "./workflow.js";
import { JobStateRegistry } from "./job-state-registry.js";
import { ClientRegistry, EnhancedClient } from "./client-registry.js";

export interface QueueJob {
  jobId: string;
  workflow: Workflow;
}

export class JobQueueProcessor {

  private jobs: JobStateRegistry;
  private clientRegistry: ClientRegistry;
  queue: Array<QueueJob> = [];
  workflowHash: string = "";
  isProcessing: boolean = false;

  constructor(stateRegistry: JobStateRegistry, clientRegistry: ClientRegistry, workflowHash: string) {
    console.log(`Creating JobQueueProcessor for workflow hash: '${workflowHash}'`);
    this.clientRegistry = clientRegistry;
    this.jobs = stateRegistry;
    this.workflowHash = workflowHash;
  }

  async enqueueJob(newJobId: string, workflow: Workflow) {
    // validate job state on registry
    const jobStatus = this.jobs.getJobStatus(newJobId);
    if (jobStatus !== "pending") {
      throw new Error(`Cannot enqueue job ${newJobId} with status ${jobStatus}`);
    }
    this.queue.push({ jobId: newJobId, workflow });
    this.processQueue().catch(reason => {
      console.error(`Error processing job queue for workflow hash ${this.workflowHash}:`, reason);
    });
  }

  async processQueue() {

    if (this.isProcessing) {
      console.log(`⚠️ Job queue for workflow hash ${this.workflowHash} is already being processed, skipping.`);
      return;
    }

    this.isProcessing = true;

    // Get the next job in the queue
    const nextJob = this.queue.shift();
    if (nextJob) {
      console.log(`Processing job ${nextJob.jobId}`);
      let preferredClient: EnhancedClient | null;
      // If this processor is for the general queue, try to find a preferred client
      if (this.workflowHash === "general") {
        preferredClient = await this.clientRegistry.getOptimalIdleClient(nextJob.workflow);
      } else {
        preferredClient = this.clientRegistry.getOptimalClient(nextJob.workflow);
      }
      if (!preferredClient) {
        console.log(`No idle clients available for job ${nextJob.jobId}.`);
        // Mark as pending again
        this.jobs.setJobStatus(nextJob.jobId, "pending");
        // Re-add the job to the front of the queue for later processing
        this.queue.unshift(nextJob);
        this.isProcessing = false;
        return;
      } else {
        console.log(`✅  Assigning job ${nextJob.jobId} to client ${preferredClient.nodeName}`);
        this.jobs.setJobStatus(nextJob.jobId, "assigned", preferredClient.url);
        await this.runJobOnClient(nextJob, preferredClient);
      }
    }

    this.isProcessing = false;

    // Recursively process the next job if we have idle clients to handle them
    if (this.queue.length > 0) {
      let idleCount = 0;
      for (const client of this.clientRegistry.clients.values()) {
        console.log(`Client ${client.nodeName} state: ${client.state}`);
        if (client.state === "idle") {
          idleCount++;
        }
      }
      if (idleCount > 0) {
        console.log(`Continuing to process next job in queue for workflow hash ${this.workflowHash}.`);
        try {
          await this.processQueue();
        } catch (e) {
          console.error(`Error processing job queue for workflow hash ${this.workflowHash}:`, e);
        }
      }
    }
  }

  private applyAutoSeed(workflow: Record<string, any>): Record<string, number> {
    const autoSeeds: Record<string, number> = {};
    for (const [nodeId, nodeValue] of Object.entries(workflow)) {
      if (!nodeValue || typeof nodeValue !== "object") continue;
      const inputs = (nodeValue as any).inputs;
      if (!inputs || typeof inputs !== "object") continue;
      if (typeof inputs.seed === "number" && inputs.seed === -1) {
        const val = Math.floor(Math.random() * 2_147_483_647);
        inputs.seed = val;
        autoSeeds[nodeId] = val;
      }
    }
    return autoSeeds;
  }

  private async runJobOnClient(nextJob: QueueJob, preferredClient: EnhancedClient) {
    try {
      const api = preferredClient.api;

      // Check if client is idle before sending job
      const queueStatus = await api.getQueue();
      if (queueStatus.queue_running.length !== 0 || queueStatus.queue_pending.length !== 0) {
        console.log(`Client ${preferredClient.nodeName} is busy, re-adding job ${nextJob.jobId} to queue.`);
        this.jobs.setJobStatus(nextJob.jobId, "pending");
        this.queue.unshift(nextJob);
        return;
      }

      const workflowJson = nextJob.workflow.toJSON();
      const autoSeeds = this.applyAutoSeed(workflowJson);
      if (Object.keys(autoSeeds).length > 0) {
        this.queueLog(`Applied auto seeds for job ${nextJob.jobId}: ${JSON.stringify(autoSeeds)}`);
        this.jobs.updateJobAutoSeeds(nextJob.jobId, autoSeeds);
        // Update the workflow json with the new seeds before sending
        const nodeIds = Object.keys(autoSeeds);
        for (const nodeId of nodeIds) {
          workflowJson[nodeId].inputs.seed = autoSeeds[nodeId];
        }
      }

      this.queueLog(`Starting job ${nextJob.jobId} on client ${preferredClient.nodeName}`);

      const result = await api.ext.queue.queuePrompt(null, workflowJson);

      // at this point we have the prompt_id assigned by comfyui, we can mark the job as running
      if (result.prompt_id) {
        this.jobs.setPromptId(nextJob.jobId, result.prompt_id);
        this.jobs.setJobStatus(nextJob.jobId, "running");
        this.queueLog(`⚡ Job ${nextJob.jobId} is now queued on client ${preferredClient.nodeName} with prompt ID ${result.prompt_id}`);
        // we also mark the client as busy, to prevent new jobs being assigned until we detect completion
        preferredClient.state = "busy";
        console.log(Array.from(this.clientRegistry.clients.values()).map((c) => `${c.nodeName}: ${c.state}`).join(", "));
      } else {
        console.error(`❌  Failed to enqueue job ${nextJob.jobId} on client ${preferredClient.nodeName}: No prompt_id returned.`);
        this.jobs.setJobStatus(nextJob.jobId, "failed");
      }

    } catch (e: any) {
      console.error(`❌  Failed to run job ${nextJob.jobId} on client ${preferredClient.nodeName}`);
      this.handleFailure(preferredClient, nextJob, e);
    }
  }

  queueLog(message: string) {
    const formattedDate = new Date().toISOString();
    console.log(`[${formattedDate}] [queue::${this.workflowHash.substring(0, 16)}] ${message}`);
  }

  dequeueJob(jobId: string) {
    this.queue = this.queue.filter(job => job.jobId !== jobId);
  }

  private handleFailure(preferredClient: EnhancedClient, nextJob: QueueJob, e: any) {

    // Mark the client as incompatible with this workflow
    console.log(`Marking client ${preferredClient.nodeName} as incompatible with workflow ${nextJob.workflow.structureHash} due to job failure.`);
    this.clientRegistry.markClientIncompatibleWithWorkflow(preferredClient.url, nextJob.workflow.structureHash);

    // Mark the client as idle again
    preferredClient.state = "idle";

    // Confirm if we should re-queue or fail the job
    const eligibleClients = this.clientRegistry.getAllEligibleClientsForWorkflow(nextJob.workflow);

    if (eligibleClients.length > 0) {
      console.log(`Re-queuing job ${nextJob.jobId} as there are other eligible clients available.`);
      this.jobs.setJobStatus(nextJob.jobId, "pending");
      this.queue.unshift(nextJob);
      return;
    } else {
      console.log(`No other eligible clients for job ${nextJob.jobId}, marking as failed.`);
    }

    // No other eligible clients, mark job as failed
    this.jobs.setJobFailure(nextJob.jobId, e.bodyJSON);
  }
}