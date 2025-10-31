import { ClientRegistry, EnhancedClient } from "./client-registry.js";
import { PoolEventManager } from "./pool-event-manager.js";
import { JobResults, JobStateRegistry } from "./job-state-registry.js";
import { JobQueueProcessor } from "./job-queue-processor.js";
import { Workflow } from "./workflow.js";
import { MultiWorkflowPoolOptions, PoolEvent } from "./interfaces.js";

/**
 * MultiWorkflowPool class to manage heterogeneous clusters of ComfyUI workers with different workflow capabilities.
 * Using a fully event driven architecture to handle client connections, job submissions, and failover strategies.
 * Zero polling is used; all operations are event driven. Maximizes responsiveness and scalability.
 */
export class MultiWorkflowPool {

  // Event manager for handling pool events
  private events: PoolEventManager;

  // Registry for managing clients in the pool
  private clientRegistry: ClientRegistry;

  // Registry for managing job state
  private jobRegistry: JobStateRegistry;

  // Multi queue map, one per workflow based on the workflow hash
  queues: Map<string, JobQueueProcessor> = new Map();

  // Pool configuration
  private options: Required<MultiWorkflowPoolOptions>;

  monitoringInterval?: Timer;

  constructor(options?: MultiWorkflowPoolOptions) {

    this.options = {
      connectionTimeoutMs: options?.connectionTimeoutMs ?? 10000,
      enableMonitoring: options?.enableMonitoring ?? false,
      monitoringIntervalMs: options?.monitoringIntervalMs ?? 60000
    };

    this.events = new PoolEventManager(this);
    this.clientRegistry = new ClientRegistry(this);
    this.jobRegistry = new JobStateRegistry(this, this.clientRegistry);

    // Create general queue for workflows without specific hashes
    this.queues.set("general", new JobQueueProcessor(this.jobRegistry, this.clientRegistry, "general"));

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
    const connectionPromises: Promise<void>[] = [];
    for (const client of this.clientRegistry.clients.values()) {
      connectionPromises.push(
        new Promise<void>(async (resolve, reject) => {
          let timeout: Timer | null = setTimeout(() => {
            client.api.abortReconnect();
            reject(new Error(`Connection to client ${client.url} timed out`));
          }, this.options.connectionTimeoutMs);
          try {
            const readyApi = await client.api.init(1);
            clearTimeout(timeout);
            timeout = null;
            console.log(`[MultiWorkflowPool]Connected to ${client.url}`);
            client.api = readyApi;
            this.attachHandlersToClient(client);
            const queueStatus = await client.api.getQueue();
            if (queueStatus.queue_running.length === 0 && queueStatus.queue_pending.length === 0) {
              console.log(`[MultiWorkflowPool] Client ${client.url} is idle.`);
              client.state = "idle";
            } else {
              client.state = "busy";
            }
            resolve();
          } catch (e) {
            client.state = "offline";
            reject(e);
          } finally {
            if (timeout) {
              clearTimeout(timeout);
            }
          }
        })
      );
    }
    await Promise.allSettled(connectionPromises);
  }

  async shutdown() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
  }

  addClient(clientUrl: string, options?: {
    workflowAffinity: Workflow<any>[];
    priority?: number;
  }) {
    this.clientRegistry.addClient(clientUrl, options);
  }

  removeClient(clientUrl: string) {
    this.clientRegistry.removeClient(clientUrl);
  }

  async submitJob(workflow: Workflow<any>) {
    let workflowHash = workflow.structureHash;
    if (!workflowHash) {
      workflow.updateHash();
      workflowHash = workflow.structureHash;
    }

    // check if there are clients with affinity forthis workflow
    let queue: JobQueueProcessor | null;
    if (workflowHash && this.clientRegistry.hasClientsForWorkflow(workflowHash)) {
      queue = this.assertQueue(workflowHash);
    } else {
      queue = this.queues.get("general")!;
      console.log(`No clients with affinity for workflow hash ${workflowHash}, using general queue.`);
    }

    if (!queue) {
      throw new Error("Failed to create or retrieve job queue for workflow.");
    }

    const newJobId = this.jobRegistry.addJob(workflow);
    await queue.enqueueJob(newJobId, workflow);
    return newJobId;
  }

  getJobStatus(jobId: string) {
    return this.jobRegistry.getJobStatus(jobId);
  }

  async cancelJob(jobId: string) {
    return this.jobRegistry.cancelJob(jobId);
  }

  attachEventHook(event: string, listener: (e: PoolEvent) => void) {
    if (event && listener) {
      this.events.attachHook(event, listener);
    }
  }

  // PRIVATE METHODS
  private assertQueue(workflowHash: string | undefined): JobQueueProcessor | null {
    if (!workflowHash) {
      return null;
    }
    let queue = this.queues.get(workflowHash);
    if (!queue) {
      queue = new JobQueueProcessor(this.jobRegistry, this.clientRegistry, workflowHash);
      this.queues.set(workflowHash, queue);
    }
    return queue;
  }

  private attachHandlersToClient(client: EnhancedClient) {

    // client.api.on("all", event => {
    //   console.log(client.nodeName, event.detail.type, event.detail.data);
    // });

    client.api.on("status", event => {
      console.log(`[${event.type}@${client.nodeName}] Queue Remaining: ${event.detail.status.exec_info.queue_remaining}`);
      // Update client state based on status
      if (event.detail.status.exec_info.queue_remaining === 0) {
        client.state = "idle";
        // Trigger queue processing
        client.workflowAffinity?.forEach(value => {
          console.log(`Triggering queue processing for workflow hash ${value} due to client ${client.nodeName} becoming idle.`);
          const queue = this.queues.get(value);
          if (queue) {
            queue.processQueue().catch(reason => {
              console.error(`Error processing job queue for workflow hash ${value}:`, reason);
            });
          }
        });
      } else {
        client.state = "busy";
      }
    });

    client.api.on("b_preview_meta", event => {
      const prompt_id = event.detail.metadata.prompt_id;
      if (prompt_id) {
        this.jobRegistry.updateJobPreviewMetadata(prompt_id, event.detail.metadata, event.detail.blob);
        // console.log(`[${event.type}@${client.nodeName}] Preview metadata for prompt ID: ${prompt_id} | blob size: ${event.detail.blob.size} (${event.detail.metadata.image_type})`);
      } else {
        console.log(`[${event.type}@${client.nodeName}] ⚠️⚠️⚠️  Preview metadata received without prompt ID.`);
      }
    });

    // Handle finished nodes, extract image for prompt_id
    client.api.on("executed", event => {
      const prompt_id = event.detail.prompt_id;
      if (prompt_id) {
        const output = event.detail.output as any;
        if (output && output.images) {
          this.jobRegistry.addJobImages(prompt_id, output.images);
        }
        // console.log(`[${event.type}@${client.nodeName}] Node executed for prompt ID: ${prompt_id} | Node`, event.detail.output);
      } else {
        console.log(`[${event.type}@${client.nodeName}] ⚠️⚠️⚠️  Executed event received without prompt ID.`);
      }
    });

    client.api.on("progress", event => {
      const prompt_id = event.detail.prompt_id;
      if (prompt_id) {
        this.jobRegistry.updateJobProgress(prompt_id, event.detail.value, event.detail.max);
        // console.log(`[${event.type}@${client.nodeName}] Progress for prompt ID: ${prompt_id} | ${Math.round(event.detail.value / event.detail.max * 100)}%`);
      } else {
        console.log(`[${event.type}@${client.nodeName}] ⚠️⚠️⚠️  Progress event received without prompt ID.`);
      }
    });

    client.api.on("execution_success", event => {
      const prompt_id = event.detail.prompt_id;
      if (prompt_id) {
        console.log(`[${event.type}@${client.nodeName}] Execution success for prompt ID: ${prompt_id}`);
        // Mark client as idle first
        client.state = "idle";
        // Mark job as completed, it will trigger queue processing
        this.jobRegistry.completeJob(prompt_id);
      }
    });

  }

  private printStatusSummary() {
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
    } else {
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
    } else {
      console.log("\n📬 QUEUE STATES: No queues found");
    }

    console.log("");
  }

  async waitForJobCompletion(jobId: string): Promise<JobResults> {
    return await this.jobRegistry.waitForResults(jobId);
  }

  attachJobProgressListener(jobId: string, progressListener: (progress: {
    value: number;
    max: number;
  }) => void) {
    this.jobRegistry.attachJobProgressListener(jobId, progressListener);
  }

  attachJobPreviewListener(jobId: string, previewListener: (preview: {
    blob: Blob;
    metadata: any;
  }) => void) {
    this.jobRegistry.attachJobPreviewListener(jobId, previewListener);
  }
}