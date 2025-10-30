import { randomUUID } from "node:crypto";
import { TypedEventTarget } from "../typed-event-target.js";
import { ComfyApi } from "../client.js";
import { Workflow } from "../workflow.js";
import { PromptBuilder } from "../prompt-builder.js";
import { MemoryQueueAdapter } from "./queue/adapters/memory.js";
import type { QueueAdapter, QueueReservation } from "./queue/QueueAdapter.js";
import type { WorkflowAffinity } from "./types/affinity.js";
import type { JobId, JobRecord, WorkflowJobPayload } from "./types/job.js";
import { hashWorkflow } from "./utils/hash.js";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface SmartPoolV2Options {
  connectionTimeoutMs?: number;
  jobExecutionTimeoutMs?: number;      // Per-job timeout (5 min default)
  groupIdleTimeoutMs?: number;          // Per-group idle timeout (60 sec default)
  maxQueueDepth?: number;               // Max jobs per queue
}

interface AffinityGroupQueue {
  id: string;
  preferredServerIds: string[];
  workflowHashes: Set<string>;
  queueAdapter: QueueAdapter;
  
  // State tracking
  isProcessing: boolean;
  lastJobCompletedMs: number;
  idleTimeoutHandle?: NodeJS.Timeout;
  processingDeferred?: Promise<void>;
  
  // Metrics
  jobsEnqueued: number;
  jobsCompleted: number;
  jobsFailed: number;
}

interface JobExecutionContext {
  job: JobRecord;
  groupId: string;
  promptId?: string;
  result?: Record<string, any>;
  error?: Error;
  completedAt?: number;
  
  // Event listeners for cleanup
  executedHandler?: (ev: CustomEvent<any>) => void;
  executionSuccessHandler?: (ev: CustomEvent<any>) => void;
  executionErrorHandler?: (ev: CustomEvent<any>) => void;
  
  // Timeout tracking
  timeoutHandle?: NodeJS.Timeout;
}

interface ServerPerformanceMetrics {
  clientId: string;
  totalJobsCompleted: number;
  totalExecutionTimeMs: number;
  averageExecutionTimeMs: number;
  lastJobDurationMs?: number;
}

interface SmartPoolV2EventMap extends Record<string, CustomEvent<any>> {
  "job:queued": CustomEvent<{ job: JobRecord }>;
  "job:accepted": CustomEvent<{ job: JobRecord; clientId: string }>;
  "job:started": CustomEvent<{ job: JobRecord; clientId: string; promptId: string }>;
  "job:completed": CustomEvent<{ job: JobRecord }>;
  "job:failed": CustomEvent<{ job: JobRecord; error: Error; willRetry?: boolean }>;
  "group:idle-timeout": CustomEvent<{ groupId: string; reason: string }>;
  "server:idle": CustomEvent<{ clientId: string; groupId?: string }>;
}

// ============================================================================
// MAIN CLASS
// ============================================================================

export class SmartPoolV2 extends TypedEventTarget<SmartPoolV2EventMap> {
  // Client management
  private clientMap: Map<string, ComfyApi> = new Map();
  
  // Affinity groups and queues
  private affinityGroups: Map<string, AffinityGroupQueue> = new Map();
  private defaultQueue?: AffinityGroupQueue;
  
  // Job tracking
  private jobStore: Map<JobId, JobRecord> = new Map();
  private executionContexts: Map<JobId, JobExecutionContext> = new Map();
  
  // Server state
  private idleServers: Set<string> = new Set();
  private serverPerformance: Map<string, ServerPerformanceMetrics> = new Map();
  
  // Pool configuration
  private options: Required<SmartPoolV2Options>;
  
  // Pool state
  private isReady: Promise<void>;
  private readyResolve?: () => void;

  // =========================================================================
  // CONSTRUCTOR
  // =========================================================================

  constructor(
    clients: (ComfyApi | string)[],
    options?: SmartPoolV2Options
  ) {
    super();

    this.options = {
      connectionTimeoutMs: options?.connectionTimeoutMs ?? 10000,
      jobExecutionTimeoutMs: options?.jobExecutionTimeoutMs ?? 5 * 60 * 1000, // 5 min
      groupIdleTimeoutMs: options?.groupIdleTimeoutMs ?? 60 * 1000,             // 60 sec
      maxQueueDepth: options?.maxQueueDepth ?? 1000
    };

    // Initialize clients
    for (const client of clients) {
      if (typeof client === "string") {
        const apiClient = new ComfyApi(client);
        this.clientMap.set(apiClient.apiHost, apiClient);
      } else {
        this.clientMap.set(client.apiHost, client);
      }
    }

    // Create default queue for unaffinitized jobs
    this.defaultQueue = this.createAffinityGroup("default", []);

    // Setup ready promise
    this.isReady = new Promise((resolve) => {
      this.readyResolve = resolve;
    });
  }

  // =========================================================================
  // PUBLIC API
  // =========================================================================

  /**
   * Initialize pool and connect all clients
   */
  async connect(): Promise<void> {
    const connectionPromises: Promise<void>[] = [];

    for (const [url, client] of this.clientMap.entries()) {
      connectionPromises.push(
        new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            client.abortReconnect();
            reject(new Error(`Connection to client ${url} timed out`));
          }, this.options.connectionTimeoutMs);

          client
            .init(1)
            .then(() => {
              clearTimeout(timeout);
              console.log(`[SmartPoolV2] Connected to ${url}`);
              this.idleServers.add(client.apiHost);
              resolve();
            })
            .catch((err) => {
              clearTimeout(timeout);
              reject(err);
            });
        })
      );
    }

    await Promise.all(connectionPromises);
    this.readyResolve?.();
  }

  /**
   * Wait for pool to be ready
   */
  ready(): Promise<void> {
    return this.isReady;
  }

  /**
   * Enqueue a workflow - automatically routed by workflow hash
   * Optional preferredClientIds overrides default routing for this specific job
   */
  async enqueue(
    workflow: Workflow<any>,
    options?: {
      preferredClientIds?: string[];
      priority?: number;
      metadata?: Record<string, any>;
    }
  ): Promise<JobId> {
    const jobId = randomUUID();
    const workflowHash = workflow.structureHash || hashWorkflow((workflow as any).json || workflow);
    const workflowJson = (workflow as any).json || workflow;
    const outputNodeIds = (workflow as any).outputNodeIds || [];
    const outputAliases = (workflow as any).outputAliases || {};

    // Find group by workflow hash, fall back to default
    let groupId = workflowHash;
    if (!this.affinityGroups.has(groupId)) {
      groupId = "default";
    }
    const group = this.affinityGroups.get(groupId);

    if (!group) {
      throw new Error(`No affinity group for workflow hash "${workflowHash}"`);
    }

    // Create job record
    const jobRecord: JobRecord = {
      jobId,
      workflow: workflowJson,
      workflowHash,
      options: {
        maxAttempts: 3,
        retryDelayMs: 1000,
        priority: options?.priority ?? 0,
        // Use per-job preferences if provided, otherwise use group defaults
        preferredClientIds: options?.preferredClientIds?.length ? options.preferredClientIds : group.preferredServerIds,
        excludeClientIds: [],
        metadata: options?.metadata || {}
      },
      attempts: 0,
      enqueuedAt: Date.now(),
      workflowMeta: {
        outputNodeIds,
        outputAliases
      },
      status: "queued"
    };

    // Store job
    this.jobStore.set(jobId, jobRecord);

    // Enqueue to group
    const payload: WorkflowJobPayload = jobRecord;
    await group.queueAdapter.enqueue(payload, { priority: options?.priority ?? 0 });

    // Emit event
    this.dispatchEvent(new CustomEvent("job:queued", { detail: { job: jobRecord } }));

    // Trigger processing immediately (event-driven)
    setImmediate(() => this.processAffinityGroup(groupId));

    return jobId;
  }

  /**
   * Set workflow affinity - auto-creates group by workflow hash
   * Maps workflow hash to preferred servers
   */
  setAffinity(
    workflow: object,
    affinity: Omit<WorkflowAffinity, "workflowHash">
  ): void {
    const workflowHash = hashWorkflow(workflow);

    // Create group with hash as ID if doesn't exist
    if (!this.affinityGroups.has(workflowHash)) {
      this.createAffinityGroup(workflowHash, affinity.preferredClientIds || []);
    }

    const group = this.affinityGroups.get(workflowHash);
    if (group) {
      group.workflowHashes.add(workflowHash);
    }
  }

  /**
   * Get job by ID
   */
  getJob(jobId: JobId): JobRecord | undefined {
    return this.jobStore.get(jobId);
  }

  /**
   * Shutdown pool
   */
  shutdown(): void {
    // Cancel all timeouts
    for (const group of this.affinityGroups.values()) {
      if (group.idleTimeoutHandle) {
        clearTimeout(group.idleTimeoutHandle);
      }
    }
    if (this.defaultQueue?.idleTimeoutHandle) {
      clearTimeout(this.defaultQueue.idleTimeoutHandle);
    }

    // Cancel all job timeouts
    for (const ctx of this.executionContexts.values()) {
      if (ctx.timeoutHandle) {
        clearTimeout(ctx.timeoutHandle);
      }
    }

    // Destroy clients
    for (const client of this.clientMap.values()) {
      try {
        client.destroy();
      } catch (err) {
        console.error(`[SmartPoolV2] Error destroying client: ${err}`);
      }
    }
  }

  /**
   * Get server performance metrics
   */
  getServerPerformance(clientId: string): ServerPerformanceMetrics | undefined {
    return this.serverPerformance.get(clientId);
  }

  // =========================================================================
  // PRIVATE: AFFINITY GROUP MANAGEMENT
  // =========================================================================

  private createAffinityGroup(
    groupId: string,
    preferredServerIds: string[]
  ): AffinityGroupQueue {
    const group: AffinityGroupQueue = {
      id: groupId,
      preferredServerIds,
      workflowHashes: new Set(),
      queueAdapter: new MemoryQueueAdapter(),
      isProcessing: false,
      lastJobCompletedMs: Date.now(),
      jobsEnqueued: 0,
      jobsCompleted: 0,
      jobsFailed: 0
    };

    this.affinityGroups.set(groupId, group);
    return group;
  }

  // =========================================================================
  // PRIVATE: QUEUE PROCESSING (EVENT-DRIVEN)
  // =========================================================================

  /**
   * Process affinity group queue - triggered by events only (no polling)
   */
  private async processAffinityGroup(groupId: string): Promise<void> {
    const group = this.affinityGroups.get(groupId);
    if (!group) return;

    // Reentrancy guard: if already processing, defer
    if (group.isProcessing) {
      if (!group.processingDeferred) {
        group.processingDeferred = new Promise((resolve) => {
          setImmediate(() => {
            group.isProcessing = false;
            this.processAffinityGroup(groupId).then(resolve);
          });
        });
      }
      return group.processingDeferred;
    }

    group.isProcessing = true;

    try {
      while (true) {
        // Peek at waiting jobs first
        const waitingJobs = await group.queueAdapter.peek(100);
        if (waitingJobs.length === 0) {
          break; // No waiting jobs
        }

        // Get the first waiting job
        const jobPayload = waitingJobs[0];
        const job = this.jobStore.get(jobPayload.jobId);

        if (!job) {
          // Job not found, discard from queue
          await group.queueAdapter.discard(jobPayload.jobId, new Error("Job not found"));
          continue;
        }

        // Find idle servers compatible with this specific job
        // First check job's preferred clients, then group's preferred servers
        const preferredServerIds = job.options.preferredClientIds?.length 
          ? job.options.preferredClientIds 
          : group.preferredServerIds;

        const compatibleIdleServers = Array.from(this.idleServers).filter((serverId) => {
          // If preferred servers specified (job or group), must match
          if (preferredServerIds.length > 0) {
            return preferredServerIds.includes(serverId);
          }
          return true;
        });

        if (compatibleIdleServers.length === 0) {
          break; // No idle compatible servers for this job
        }

        // Sort compatible servers by performance (fastest first)
        const sortedServers = this.sortServersByPerformance(compatibleIdleServers);
        const selectedServerId = sortedServers[0];
        const selectedClient = this.clientMap.get(selectedServerId);

        if (!selectedClient) {
          break;
        }

        // Reserve job
        const reservation = await group.queueAdapter.reserveById(jobPayload.jobId);
        if (!reservation) {
          continue;
        }

        // Mark server as no longer idle (synchronous)
        this.idleServers.delete(selectedServerId);

        // Enqueue job on server (synchronous, fires in background)
        await this.enqueueJobOnServer(job, selectedClient, groupId, reservation);
      }
    } finally {
      group.isProcessing = false;

      // Check for deferred processing
      if (group.processingDeferred) {
        group.processingDeferred = undefined;
      }
    }
  }

  // =========================================================================
  // PRIVATE: JOB EXECUTION (NO CALLWRAPPER)
  // =========================================================================

  /**
   * Enqueue job on server and manage execution
   */
  private async enqueueJobOnServer(
    job: JobRecord,
    client: ComfyApi,
    groupId: string,
    reservation: QueueReservation
  ): Promise<void> {
    const group = this.affinityGroups.get(groupId);
    if (!group) return;

    job.attempts += 1;
    job.status = "running";
    job.clientId = client.apiHost;
    job.startedAt = Date.now();

    try {
      // Clone workflow to avoid mutations
      const workflowJson = JSON.parse(JSON.stringify(job.workflow));
      const outputNodeIds = job.workflowMeta?.outputNodeIds || [];

      // Auto-randomize seeds
      try {
        for (const node of Object.values(workflowJson)) {
          const n = node as any;
          if (n?.inputs?.seed === -1) {
            n.inputs.seed = Math.floor(Math.random() * 2_147_483_647);
          }
        }
      } catch {
        /* non-fatal */
      }

      // Build prompt
      const pb = new PromptBuilder(workflowJson, [], outputNodeIds);
      for (const nodeId of outputNodeIds) {
        pb.setOutputNode(nodeId as any, nodeId as any);
      }
      const promptJson = pb.prompt;

      // Append to server queue
      let queueResponse;
      try {
        queueResponse = await client.ext.queue.appendPrompt(promptJson);
      } catch (err) {
        throw new Error(`Failed to enqueue job: ${err}`);
      }

      const promptId = queueResponse.prompt_id;
      job.promptId = promptId;

      // Create execution context
      const ctx: JobExecutionContext = {
        job,
        groupId,
        promptId
      };
      this.executionContexts.set(job.jobId, ctx);

      // Emit accepted event
      this.dispatchEvent(
        new CustomEvent("job:accepted", {
          detail: { job, clientId: client.apiHost }
        })
      );

      this.dispatchEvent(
        new CustomEvent("job:started", {
          detail: { job, clientId: client.apiHost, promptId }
        })
      );

      // Set up execution timeout (5 min)
      ctx.timeoutHandle = setTimeout(() => {
        console.warn(`[SmartPoolV2] Job ${job.jobId} execution timeout`);
        this.handleJobTimeout(job.jobId);
      }, this.options.jobExecutionTimeoutMs);

      // Set up event listeners (strict prompt_id matching)
      const outputMap: Record<string, any> = {};
      let outputsCollected = 0;
      const expectedOutputCount = outputNodeIds.length;

      ctx.executedHandler = (ev: CustomEvent) => {
        // Strict prompt_id check
        if (ev.detail.prompt_id !== promptId) {
          return;
        }

        const nodeId = ev.detail.node;
        const output = ev.detail.output;

        outputMap[nodeId] = output;
        outputsCollected++;

        // All outputs collected?
        if (outputsCollected === expectedOutputCount) {
          this.handleJobCompletion(job.jobId, groupId, outputMap, client.apiHost);
        }
      };

      ctx.executionSuccessHandler = async (ev: CustomEvent) => {
        if (ev.detail.prompt_id !== promptId) {
          return;
        }

        // Try to get missing outputs from history if needed
        if (outputsCollected < expectedOutputCount) {
          try {
            const history = await client.ext.history.getHistory(promptId);
            if (history?.outputs) {
              for (const [nodeIdStr, nodeOutput] of Object.entries(history.outputs)) {
                const nodeId = nodeIdStr;
                if (!outputMap[nodeId] && nodeOutput) {
                  outputMap[nodeId] = nodeOutput;
                  outputsCollected++;
                }
              }
            }
          } catch {
            /* non-fatal */
          }
        }

        // Complete job regardless
        this.handleJobCompletion(job.jobId, groupId, outputMap, client.apiHost);
      };

      ctx.executionErrorHandler = (ev: CustomEvent) => {
        if (ev.detail.prompt_id !== promptId) {
          return;
        }

        const error = new Error(`Execution error: ${ev.detail.exception_type}`);
        this.handleJobFailure(job.jobId, groupId, error);
      };

      // Attach listeners
      client.on("executed", ctx.executedHandler as any);
      client.on("execution_success", ctx.executionSuccessHandler as any);
      client.on("execution_error", ctx.executionErrorHandler as any);

      // Commit to queue
      await group.queueAdapter.commit(reservation.reservationId);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      // Retry or fail
      if (job.attempts < job.options.maxAttempts) {
        await group.queueAdapter.retry(reservation.reservationId, {
          delayMs: job.options.retryDelayMs
        });
      } else {
        await group.queueAdapter.discard(reservation.reservationId, error);
        this.handleJobFailure(job.jobId, groupId, error);
      }

      // Mark server idle again
      this.idleServers.add(client.apiHost);
      this.dispatchEvent(
        new CustomEvent("server:idle", {
          detail: { clientId: client.apiHost, groupId }
        })
      );

      // Trigger processing
      setImmediate(() => this.processAffinityGroup(groupId));
    }
  }

  /**
   * Handle job completion
   */
  private handleJobCompletion(
    jobId: JobId,
    groupId: string,
    outputMap: Record<string, any>,
    clientId: string
  ): void {
    const job = this.jobStore.get(jobId);
    if (!job) return;

    const ctx = this.executionContexts.get(jobId);
    if (ctx?.timeoutHandle) {
      clearTimeout(ctx.timeoutHandle);
    }

    // Clean up listeners
    if (ctx) {
      const client = this.clientMap.get(clientId);
      if (client) {
        if (ctx.executedHandler) client.off("executed", ctx.executedHandler as any);
        if (ctx.executionSuccessHandler) client.off("execution_success", ctx.executionSuccessHandler as any);
        if (ctx.executionErrorHandler) client.off("execution_error", ctx.executionErrorHandler as any);
      }
    }

    // Update job
    job.status = "completed";
    job.result = outputMap;
    job.completedAt = Date.now();

    const executionTimeMs = job.completedAt - (job.startedAt || job.completedAt);
    this.updateServerPerformance(clientId, executionTimeMs);

    // Update group stats
    const group = this.affinityGroups.get(groupId);
    if (group) {
      group.jobsCompleted++;
      group.lastJobCompletedMs = Date.now();

      // Reset idle timeout for this group
      if (group.idleTimeoutHandle) {
        clearTimeout(group.idleTimeoutHandle);
      }
      group.idleTimeoutHandle = setTimeout(() => {
        this.dispatchEvent(
          new CustomEvent("group:idle-timeout", {
            detail: { groupId, reason: "No jobs completed in idle threshold" }
          })
        );
      }, this.options.groupIdleTimeoutMs);
    }

    // Mark server idle
    this.idleServers.add(clientId);
    this.dispatchEvent(
      new CustomEvent("server:idle", {
        detail: { clientId, groupId }
      })
    );

    // Emit completed event
    this.dispatchEvent(new CustomEvent("job:completed", { detail: { job } }));

    // Clean up context
    this.executionContexts.delete(jobId);

    // Trigger processing
    setImmediate(() => this.processAffinityGroup(groupId));
  }

  /**
   * Handle job failure
   */
  private handleJobFailure(jobId: JobId, groupId: string, error: Error): void {
    const job = this.jobStore.get(jobId);
    if (!job) return;

    const ctx = this.executionContexts.get(jobId);
    if (ctx?.timeoutHandle) {
      clearTimeout(ctx.timeoutHandle);
    }

    // Clean up listeners
    if (ctx && job.clientId) {
      const client = this.clientMap.get(job.clientId);
      if (client) {
        if (ctx.executedHandler) client.off("executed", ctx.executedHandler as any);
        if (ctx.executionSuccessHandler) client.off("execution_success", ctx.executionSuccessHandler as any);
        if (ctx.executionErrorHandler) client.off("execution_error", ctx.executionErrorHandler as any);
      }
    }

    job.status = "failed";
    job.lastError = error;
    job.completedAt = Date.now();

    // Update group stats
    const group = this.affinityGroups.get(groupId);
    if (group) {
      group.jobsFailed++;
    }

    // Mark server idle
    if (job.clientId) {
      this.idleServers.add(job.clientId);
      this.dispatchEvent(
        new CustomEvent("server:idle", {
          detail: { clientId: job.clientId, groupId }
        })
      );
    }

    // Emit failed event
    this.dispatchEvent(
      new CustomEvent("job:failed", {
        detail: { job, error, willRetry: false }
      })
    );

    // Clean up context
    this.executionContexts.delete(jobId);

    // Trigger processing
    setImmediate(() => this.processAffinityGroup(groupId));
  }

  /**
   * Handle job timeout
   */
  private handleJobTimeout(jobId: JobId): void {
    const job = this.jobStore.get(jobId);
    if (!job) return;

    const ctx = this.executionContexts.get(jobId);
    const groupId = ctx?.groupId || "default";

    const error = new Error(`Job execution timeout after ${this.options.jobExecutionTimeoutMs}ms`);
    this.handleJobFailure(jobId, groupId, error);
  }

  // =========================================================================
  // PRIVATE: PERFORMANCE TRACKING
  // =========================================================================

  private updateServerPerformance(clientId: string, executionTimeMs: number): void {
    let metrics = this.serverPerformance.get(clientId);

    if (!metrics) {
      metrics = {
        clientId,
        totalJobsCompleted: 0,
        totalExecutionTimeMs: 0,
        averageExecutionTimeMs: 0
      };
      this.serverPerformance.set(clientId, metrics);
    }

    metrics.totalJobsCompleted++;
    metrics.totalExecutionTimeMs += executionTimeMs;
    metrics.lastJobDurationMs = executionTimeMs;
    metrics.averageExecutionTimeMs = metrics.totalExecutionTimeMs / metrics.totalJobsCompleted;
  }

  private sortServersByPerformance(serverIds: string[]): string[] {
    return [...serverIds].sort((a, b) => {
      const metricsA = this.serverPerformance.get(a);
      const metricsB = this.serverPerformance.get(b);

      // Untracked servers go to end
      if (!metricsA) return 1;
      if (!metricsB) return -1;

      return metricsA.averageExecutionTimeMs - metricsB.averageExecutionTimeMs;
    });
  }
}
