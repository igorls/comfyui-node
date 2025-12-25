import { ClientRegistry } from "./client-registry.js";
import { PoolEventManager } from "./pool-event-manager.js";
import { JobStateRegistry } from "./job-state-registry.js";
import { JobQueueProcessor } from "./job-queue-processor.js";
import { Workflow } from "./workflow.js";
import { MultiWorkflowPoolOptions, PoolEvent, ClientEventPayload, EnhancedClient, JobResults, SubmitJobOptions } from "./interfaces.js";

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
  public options: Required<MultiWorkflowPoolOptions>;

  monitoringInterval?: Timer;

  constructor(options?: MultiWorkflowPoolOptions) {
    this.options = {
      connectionTimeoutMs: options?.connectionTimeoutMs ?? 10000,
      enableMonitoring: options?.enableMonitoring ?? false,
      monitoringIntervalMs: options?.monitoringIntervalMs ?? 60000,
      enableProfiling: options?.enableProfiling ?? false
    };

    this.events = new PoolEventManager(this);
    this.clientRegistry = new ClientRegistry(this, this.events);
    this.jobRegistry = new JobStateRegistry(this, this.clientRegistry);

    // Create general queue for workflows without specific hashes
    this.queues.set("general", new JobQueueProcessor(this.jobRegistry, this.clientRegistry, "general", this.events));

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
            this.events.emitEvent({ type: "info", payload: `Connected to ${client.url}` });
            client.api = readyApi;
            this.attachHandlersToClient(client);
            const queueStatus = await client.api.getQueue();
            if (queueStatus.queue_running.length === 0 && queueStatus.queue_pending.length === 0) {
              this.events.emitEvent({ type: "debug", payload: `Client ${client.url} is idle.` });
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
    const promiseResults = await Promise.allSettled(connectionPromises);
    const failedConnections = promiseResults.filter((result) => result.status === "rejected");
    if (failedConnections.length > 0) {
      this.events.emitEvent({ type: "warn", payload: `Warning: ${failedConnections.length} client(s) failed to connect.` });
      failedConnections.forEach((result) => {
        if (result.status === "rejected") {
          this.events.emitEvent({ type: "error", payload: { message: "Connection failed", error: result.reason } });
        }
      });
    }

    // Throw error if all connections failed
    if (failedConnections.length === this.clientRegistry.clients.size) {
      throw new Error("All clients failed to connect. Pool initialization failed.");
    }

    this.events.emitEvent({ type: "info", payload: `Initialization complete. ${this.clientRegistry.clients.size - failedConnections.length} client(s) connected successfully.` });
  }

  async shutdown() {
    this.events.emitEvent({ type: "info", payload: "Shutting down MultiWorkflowPool..." });

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    // Disconnect all clients
    const disconnectPromises: Promise<void>[] = [];
    for (const client of this.clientRegistry.clients.values()) {
      disconnectPromises.push(
        new Promise<void>(async (resolve) => {
          try {
            client.api.destroy();
            this.events.emitEvent({ type: "debug", payload: `Disconnected from client ${client.url}` });
          } catch (e) {
            this.events.emitEvent({ type: "error", payload: { message: `Error disconnecting from client ${client.url}`, error: e } });
          } finally {
            resolve();
          }
        })
      );
    }
    await Promise.allSettled(disconnectPromises);
  }

  addClient(
    clientUrl: string,
    options?: {
      workflowAffinity: Workflow<any>[];
      priority?: number;
    }
  ) {
    this.clientRegistry.addClient(clientUrl, options);
  }

  removeClient(clientUrl: string) {
    this.clientRegistry.removeClient(clientUrl);
  }

  async submitJob(workflow: Workflow<any>, options?: SubmitJobOptions) {
    let workflowHash = workflow.structureHash;
    if (!workflowHash) {
      workflow.updateHash();
      workflowHash = workflow.structureHash;
    }

    // check if there are clients with affinity for this workflow
    let queue: JobQueueProcessor | null;
    if (workflowHash && this.clientRegistry.hasClientsForWorkflow(workflowHash)) {
      queue = this.assertQueue(workflowHash);
    } else {
      queue = this.queues.get("general")!;
      this.events.emitEvent({ type: "debug", payload: `No clients with affinity for workflow hash ${workflowHash}, using general queue.` });
    }

    if (!queue) {
      throw new Error("Failed to create or retrieve job queue for workflow.");
    }

    // Normalize priorityOverrides to Map if Record was provided
    let priorityOverrides: Map<string, number> | undefined;
    if (options?.priorityOverrides) {
      if (options.priorityOverrides instanceof Map) {
        priorityOverrides = options.priorityOverrides;
      } else {
        priorityOverrides = new Map(Object.entries(options.priorityOverrides));
      }
    }

    const newJobId = this.jobRegistry.addJob(workflow);
    await queue.enqueueJob(newJobId, workflow, priorityOverrides);
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
      queue = new JobQueueProcessor(this.jobRegistry, this.clientRegistry, workflowHash, this.events);
      this.queues.set(workflowHash, queue);
    }
    return queue;
  }

  private attachHandlersToClient(client: EnhancedClient) {
    // Forward all client events through the pool event manager
    client.api.on("all", (event) => {
      const payload: ClientEventPayload = {
        clientUrl: client.url,
        clientName: client.nodeName,
        eventType: event.detail.type,
        eventData: event.detail.data
      };
      this.events.emitEvent({
        type: `client:${event.detail.type}`,
        payload
      });
    });

    client.api.on("status", (event) => {
      // Defensive null checks for event structure
      if (!event.detail?.status?.exec_info || event.detail.status.exec_info.queue_remaining === undefined) {
        this.events.emitEvent({ type: "warn", payload: `[${event.type}@${client.nodeName}] Invalid status event structure.` });
        return;
      }
      this.events.emitEvent({
        type: "client", payload: {
          clientName: client.nodeName,
          event: event.type,
          message: `Queue Remaining: ${event.detail.status.exec_info.queue_remaining}`
        }
      });
      // Update client state based on status
      if (event.detail.status.exec_info.queue_remaining === 0) {
        client.state = "idle";
        // Trigger queue processing
        client.workflowAffinity?.forEach((value) => {
          this.events.emitEvent({ type: "debug", payload: `Triggering queue processing for workflow hash ${value} due to client ${client.nodeName} becoming idle.` });
          const queue = this.queues.get(value);
          if (queue) {
            queue.processQueue().catch((reason) => {
              this.events.emitEvent({ type: "error", payload: `Error processing job queue for workflow hash ${value}: ${reason}` });
            });
          }
        });
      } else {
        client.state = "busy";
      }
    });

    client.api.on("b_preview_meta", (event) => {
      // Defensive null checks for event structure
      if (!event.detail?.metadata || !event.detail?.blob) {
        this.events.emitEvent({ type: "warn", payload: `[${event.type}@${client.nodeName}] Invalid preview metadata event structure.` });
        return;
      }

      const prompt_id = event.detail.metadata.prompt_id;
      if (prompt_id) {
        this.jobRegistry.updateJobPreviewMetadata(prompt_id, event.detail.metadata, event.detail.blob);
        this.events.emitEvent({ type: "debug", payload: `[${event.type}@${client.nodeName}] Preview metadata for prompt ID: ${prompt_id} | blob size: ${event.detail.blob.size} (${event.detail.metadata.image_type ?? "unknown"})` });
      } else {
        this.events.emitEvent({ type: "warn", payload: `[${event.type}@${client.nodeName}] Preview metadata received without prompt ID.` });
      }
    });

    // Handle finished nodes, extract image for prompt_id
    client.api.on("executed", (event) => {
      // Defensive null check for event detail
      if (!event.detail) {
        this.events.emitEvent({ type: "warn", payload: `[${event.type}@${client.nodeName}] Executed event received with no detail.` });
        return;
      }

      const prompt_id = event.detail.prompt_id;
      if (prompt_id) {
        const output = event.detail.output as any;
        // Standard images (e.g. PreviewImage, SaveImage)
        if (output && output.images) {
          this.jobRegistry.addJobImages(prompt_id, output.images);
        }
        // Encrypted images (EncryptedSaveImage node)
        if (output && output.encrypted_images) {
          this.jobRegistry.addJobEncryptedImages(prompt_id, output.encrypted_images);
        }
        this.events.emitEvent({ type: "debug", payload: `[${event.type}@${client.nodeName}] Node executed for prompt ID: ${prompt_id}` });
      } else {
        this.events.emitEvent({ type: "warn", payload: `[${event.type}@${client.nodeName}] Executed event received without prompt ID.` });
      }
    });

    client.api.on("progress", (event) => {
      // Defensive null checks for event detail and required fields
      if (!event.detail || event.detail.value === undefined || event.detail.max === undefined) {
        this.events.emitEvent({ type: "warn", payload: `[${event.type}@${client.nodeName}] Progress event received with invalid structure.` });
        return;
      }

      const prompt_id = event.detail.prompt_id;
      if (prompt_id) {
        const nodeId = event.detail.node;
        this.jobRegistry.updateJobProgress(
          prompt_id,
          event.detail.value,
          event.detail.max,
          nodeId !== null ? nodeId : undefined
        );
        this.events.emitEvent({ type: "debug", payload: `[${event.type}@${client.nodeName}] Progress for prompt ID: ${prompt_id} | ${Math.round((event.detail.value / event.detail.max) * 100)}%` });
      } else {
        this.events.emitEvent({ type: "warn", payload: `[${event.type}@${client.nodeName}] Progress event received without prompt ID.` });
      }
    });

    // Track node execution for profiling
    client.api.on("executing", (event) => {
      // Defensive null check for event detail
      if (!event.detail) {
        this.events.emitEvent({ type: "warn", payload: `[${event.type}@${client.nodeName}] Executing event received with no detail.` });
        return;
      }

      const prompt_id = event.detail.prompt_id;
      const nodeId = event.detail.node;

      if (prompt_id) {
        if (nodeId === null) {
          // Execution completed (node: null event)
          this.events.emitEvent({ type: "debug", payload: `[${event.type}@${client.nodeName}] Execution complete for prompt ID: ${prompt_id}` });
        } else {
          // Node started executing
          this.jobRegistry.onNodeExecuting(prompt_id, String(nodeId));
          this.events.emitEvent({ type: "debug", payload: `[${event.type}@${client.nodeName}] Node ${nodeId} executing for prompt ID: ${prompt_id}` });
        }
      }
    });

    // Track cached nodes for profiling
    client.api.on("execution_cached", (event) => {
      // Defensive null check for event detail
      if (!event.detail) {
        this.events.emitEvent({ type: "warn", payload: `[${event.type}@${client.nodeName}] Execution cached event received with no detail.` });
        return;
      }

      const prompt_id = event.detail.prompt_id;
      const nodeIds = event.detail.nodes;

      if (prompt_id && nodeIds && Array.isArray(nodeIds)) {
        this.jobRegistry.onCachedNodes(prompt_id, nodeIds.map(String));
        this.events.emitEvent({ type: "debug", payload: `[${event.type}@${client.nodeName}] ${nodeIds.length} nodes cached for prompt ID: ${prompt_id}` });
      }
    });

    client.api.on("execution_success", (event) => {
      // Defensive null check for event detail
      if (!event.detail) {
        this.events.emitEvent({ type: "warn", payload: `[${event.type}@${client.nodeName}] Execution success event received with no detail.` });
        return;
      }

      const prompt_id = event.detail.prompt_id;
      if (prompt_id) {
        this.events.emitEvent({ type: "client", payload: { clientName: client.nodeName, event: event.type, message: `Execution success for prompt ID: ${prompt_id}` } });
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
      const clientData = Array.from(this.clientRegistry.clients.values()).map((client) => ({
        URL: client.url,
        "Node Name": client.nodeName,
        State: client.state,
        Priority: client.priority !== undefined ? client.priority : "N/A"
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
        Type: workflowHash === "general" ? "General" : "Specific"
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

  attachJobProgressListener(jobId: string, progressListener: (progress: { value: number; max: number }) => void) {
    this.jobRegistry.attachJobProgressListener(jobId, progressListener);
  }

  attachJobPreviewListener(jobId: string, previewListener: (preview: { blob: Blob; metadata: any }) => void) {
    this.jobRegistry.attachJobPreviewListener(jobId, previewListener);
  }

  // CLIENT REGISTRY ACCESS METHODS
  /**
   * Get a list of all registered clients with their current state
   * @returns Array of client information objects
   */
  getClients(): Array<{
    url: string;
    nodeName: string;
    state: "idle" | "busy" | "offline";
    priority?: number;
    workflowAffinityHashes?: string[];
  }> {
    return Array.from(this.clientRegistry.clients.values()).map((client) => ({
      url: client.url,
      nodeName: client.nodeName,
      state: client.state,
      priority: client.priority,
      workflowAffinityHashes: client.workflowAffinity ? Array.from(client.workflowAffinity) : undefined
    }));
  }

  /**
   * Get information about a specific client by URL
   * @param clientUrl - The URL of the client to query
   * @returns Client information or null if not found
   */
  getClient(clientUrl: string): {
    url: string;
    nodeName: string;
    state: "idle" | "busy" | "offline";
    priority?: number;
    workflowAffinityHashes?: string[];
  } | null {
    const client = this.clientRegistry.clients.get(clientUrl);
    if (!client) {
      return null;
    }
    return {
      url: client.url,
      nodeName: client.nodeName,
      state: client.state,
      priority: client.priority,
      workflowAffinityHashes: client.workflowAffinity ? Array.from(client.workflowAffinity) : undefined
    };
  }

  /**
   * Get all clients that have affinity for a specific workflow
   * @param workflow - The workflow to check affinity for
   * @returns Array of client URLs that can handle this workflow
   */
  getClientsForWorkflow(workflow: Workflow<any>): string[] {
    let workflowHash = workflow.structureHash;
    if (!workflowHash) {
      workflow.updateHash();
      workflowHash = workflow.structureHash;
    }
    if (!workflowHash) {
      return [];
    }
    const clientSet = this.clientRegistry.workflowAffinityMap.get(workflowHash);
    return clientSet ? Array.from(clientSet) : [];
  }

  /**
   * Get all idle clients currently available for work
   * @returns Array of idle client information
   */
  getIdleClients(): Array<{
    url: string;
    nodeName: string;
    priority?: number;
  }> {
    return Array.from(this.clientRegistry.clients.values())
      .filter((client) => client.state === "idle")
      .map((client) => ({
        url: client.url,
        nodeName: client.nodeName,
        priority: client.priority
      }));
  }

  /**
   * Check if there are any clients available for a specific workflow
   * @param workflow - The workflow to check
   * @returns True if at least one client has affinity for this workflow
   */
  hasClientsForWorkflow(workflow: Workflow<any>): boolean {
    let workflowHash = workflow.structureHash;
    if (!workflowHash) {
      workflow.updateHash();
      workflowHash = workflow.structureHash;
    }
    if (!workflowHash) {
      return false;
    }
    return this.clientRegistry.hasClientsForWorkflow(workflowHash);
  }

  /**
   * Get statistics about the pool's current state
   * @returns Pool statistics including client counts and queue depths
   */
  getPoolStats(): {
    totalClients: number;
    idleClients: number;
    busyClients: number;
    offlineClients: number;
    totalQueues: number;
    queues: Array<{
      workflowHash: string;
      pendingJobs: number;
      type: "general" | "specific";
    }>;
  } {
    const clients = Array.from(this.clientRegistry.clients.values());
    return {
      totalClients: clients.length,
      idleClients: clients.filter((c) => c.state === "idle").length,
      busyClients: clients.filter((c) => c.state === "busy").length,
      offlineClients: clients.filter((c) => c.state === "offline").length,
      totalQueues: this.queues.size,
      queues: Array.from(this.queues.entries()).map(([hash, queue]) => ({
        workflowHash: hash,
        pendingJobs: queue.queue.length,
        type: hash === "general" ? "general" : "specific"
      }))
    };
  }
}
