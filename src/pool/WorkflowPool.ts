import { randomUUID } from "node:crypto";
import { TypedEventTarget } from "../typed-event-target.js";
import type { ComfyApi } from "../client.js";
import { Workflow } from "../workflow.js";
import { PromptBuilder } from "../prompt-builder.js";
import { CallWrapper } from "../call-wrapper.js";
import { MemoryQueueAdapter } from "./queue/adapters/memory.js";
import type { QueueAdapter, QueueReservation, QueueStats } from "./queue/QueueAdapter.js";
import type { FailoverStrategy } from "./failover/Strategy.js";
import { SmartFailoverStrategy } from "./failover/SmartFailoverStrategy.js";
import { ClientManager } from "./client/ClientManager.js";
import { hashWorkflow } from "./utils/hash.js";
import { cloneDeep } from "./utils/clone.js";
import type { JobRecord, WorkflowInput, WorkflowJobOptions, WorkflowJobPayload, JobId } from "./types/job.js";
import type { WorkflowPoolEventMap } from "./types/events.js";
import { JobProfiler } from "./profiling/JobProfiler.js";
import { analyzeWorkflowFailure } from "./utils/failure-analysis.js";
import type { WorkflowFailureAnalysis } from "./utils/failure-analysis.js";
import { WorkflowNotSupportedError } from "../types/error.js";
import type { WorkflowAffinity } from "./types/affinity.js";

/**
 * Configuration options for WorkflowPool.
 */
export interface WorkflowPoolOpts {
  /**
   * An array of workflow affinity rules to establish a default mapping
   * between workflows and specific clients.
   *
   * @example
   * ```ts
   * const pool = new WorkflowPool(clients, {
   *   workflowAffinities: [
   *     { workflowHash: "hash1", preferredClientIds: ["client-a"] },
   *     { workflowHash: "hash2", excludeClientIds: ["client-b"] },
   *   ]
   * });
   * ```
   */
  workflowAffinities?: WorkflowAffinity[];
  /**
   * Queue adapter for managing job queue operations.
   *
   * @default MemoryQueueAdapter (in-memory queue)
   * @example
   * ```ts
   * import { WorkflowPool, MemoryQueueAdapter } from 'comfyui-node';
   * const pool = new WorkflowPool(clients, {
   *   queueAdapter: new MemoryQueueAdapter()
   * });
   * ```
   */
  queueAdapter?: QueueAdapter;

  /**
   * Failover strategy for handling client failures and workflow routing.
   *
   * @default SmartFailoverStrategy (exponential backoff with workflow-specific cooldowns)
   * @example
   * ```ts
   * import { WorkflowPool, SmartFailoverStrategy } from 'comfyui-node';
   * const pool = new WorkflowPool(clients, {
   *   failoverStrategy: new SmartFailoverStrategy()
   * });
   * ```
   */
  failoverStrategy?: FailoverStrategy;

  /**
   * Base retry backoff delay in milliseconds for failed jobs.
   * Actual delay may be adjusted by the failover strategy.
   *
   * @default 1000 (1 second)
   */
  retryBackoffMs?: number;

  /**
   * Timeout in milliseconds for execution to start after job is queued.
   *
   * If a server gets stuck before emitting the `execution_start` event, the job
   * will be failed and retried on another server after this timeout.
   *
   * This prevents jobs from being lost when a server accepts a prompt but fails
   * to begin execution (e.g., GPU hang, process crash, deadlock).
   *
   * Set to `0` to disable timeout (not recommended for production).
   *
   * @default 5000 (5 seconds)
   * @example
   * ```ts
   * const pool = new WorkflowPool(clients, {
   *   executionStartTimeoutMs: 10000 // 10 seconds
   * });
   * ```
   * @since 1.5.0
   */
  executionStartTimeoutMs?: number;

  /**
   * Timeout in milliseconds for individual node execution.
   *
   * If a node takes longer than this timeout to execute (time between `executing` events),
   * the job will be failed and retried on another server.
   *
   * This is critical for:
   * - Model loading on slow disks (can take 60+ seconds on first load)
   * - Heavy diffusion steps on slower GPUs
   * - VAE decode operations on large images
   * - Custom nodes with long processing times
   *
   * The timeout is per-node, not total execution time. Each node gets the full timeout duration.
   *
   * Set to `0` to disable timeout (not recommended for production).
   *
   * @default 300000 (5 minutes)
   * @example
   * ```ts
   * const pool = new WorkflowPool(clients, {
   *   nodeExecutionTimeoutMs: 600000 // 10 minutes for slow model loading
   * });
   * ```
   * @remarks
   * - Timeout resets when a new node starts executing
   * - Progress events (e.g., KSampler steps) reset the timeout
   * - First generation with model loading often needs longer timeout
   * - Cached nodes complete instantly and don't trigger timeout
   * @since 1.5.0
   */
  nodeExecutionTimeoutMs?: number;

  /**
   * Interval in milliseconds for health check pings to keep WebSocket connections alive.
   *
   * Health checks prevent idle connection timeouts by periodically pinging inactive clients
   * with lightweight `getQueue()` calls. This maintains stable connections when the pool
   * has no active jobs, avoiding false disconnection alerts.
   *
   * Set to `0` to disable health checks (not recommended for production).
   *
   * @default 30000 (30 seconds)
   * @example
   * ```ts
   * const pool = new WorkflowPool(clients, {
   *   healthCheckIntervalMs: 30000 // ping every 30 seconds
   * });
   * ```
   * @remarks
   * - Only pings idle (non-busy) clients to avoid interference with active jobs
   * - Recommended for long-running services or when using persistent connections
   * - Lower values increase network traffic but detect issues faster
   * - Higher values reduce overhead but may miss connection issues sooner
   * @since 1.4.1
   */
  healthCheckIntervalMs?: number;

  /**
   * Enable automatic profiling of workflow execution.
   *
   * When enabled, captures detailed per-node execution metrics including:
   * - Node execution timing (start, end, duration)
   * - Progress events for long-running nodes
   * - Cached vs executed nodes
   * - Execution order and dependencies
   *
   * Profile stats are attached to `JobRecord.profileStats` and included
   * in `job:completed` event details.
   *
   * @default false
   * @example
   * ```ts
   * const pool = new WorkflowPool(clients, {
   *   enableProfiling: true
   * });
   *
   * pool.on('job:completed', (event) => {
   *   const stats = event.detail.job.profileStats;
   *   console.log(`Total: ${stats.totalDuration}ms`);
   *   console.log(`Slowest nodes:`, stats.summary.slowestNodes);
   * });
   * ```
   * @since 1.5.0
   */
  enableProfiling?: boolean;
}

interface ActiveJobContext {
  reservation: QueueReservation;
  job: JobRecord;
  clientId: string;
  release: (opts?: { success?: boolean }) => void;
  cancel?: () => Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY = 1000;

export class WorkflowPool extends TypedEventTarget<WorkflowPoolEventMap> {
  private queue: QueueAdapter;
  private strategy: FailoverStrategy;
  private clientManager: ClientManager;
  private opts: WorkflowPoolOpts;
  private jobStore: Map<JobId, JobRecord> = new Map();
  private jobFailureAnalysis: Map<JobId, Map<string, WorkflowFailureAnalysis>> = new Map();
  private affinities: Map<string, WorkflowAffinity> = new Map();
  private initPromise: Promise<void>;
  private processing = false;
  private processQueued = false;
  private activeJobs: Map<JobId, ActiveJobContext> = new Map();
  private readonly queueDebug = process.env.WORKFLOW_POOL_DEBUG === "1";

  private debugLog(...args: unknown[]): void {
    if (this.queueDebug) {
      console.log(...args);
    }
  }

  constructor(clients: ComfyApi[], opts?: WorkflowPoolOpts) {
    super();
    this.strategy = opts?.failoverStrategy ?? new SmartFailoverStrategy();
    this.queue = opts?.queueAdapter ?? new MemoryQueueAdapter();
    this.clientManager = new ClientManager(this.strategy, {
      healthCheckIntervalMs: opts?.healthCheckIntervalMs ?? 30000
    });
    this.opts = opts ?? {};
    if (opts?.workflowAffinities) {
      for (const affinity of opts.workflowAffinities) {
        this.affinities.set(affinity.workflowHash, affinity);
      }
    }
    this.clientManager.on("client:state", (ev) => {
      this.dispatchEvent(new CustomEvent("client:state", { detail: ev.detail }));
    });
    this.clientManager.on("client:blocked_workflow", (ev) => {
      this.dispatchEvent(new CustomEvent("client:blocked_workflow", { detail: ev.detail }));
    });
    this.clientManager.on("client:unblocked_workflow", (ev) => {
      this.dispatchEvent(new CustomEvent("client:unblocked_workflow", { detail: ev.detail }));
    });
    this.initPromise = this.clientManager
      .initialize(clients)
      .then(() => {
        this.dispatchEvent(
          new CustomEvent("pool:ready", {
            detail: { clientIds: this.clientManager.list().map((c) => c.id) }
          })
        );
      })
      .catch((error) => {
        this.dispatchEvent(new CustomEvent("pool:error", { detail: { error } }));
      });
  }

  async ready(): Promise<void> {
    await this.initPromise;
  }

  public setAffinity(affinity: WorkflowAffinity): void {
    this.affinities.set(affinity.workflowHash, affinity);
  }

  public removeAffinity(workflowHash: string): boolean {
    return this.affinities.delete(workflowHash);
  }

  public getAffinities(): WorkflowAffinity[] {
    return Array.from(this.affinities.values());
  }

  async enqueue(workflowInput: WorkflowInput, options?: WorkflowJobOptions): Promise<JobId> {
    await this.ready();
    const workflowJson = this.normalizeWorkflow(workflowInput);

    // Use the workflow's pre-computed structureHash if available (from Workflow instance)
    // Otherwise compute it from the JSON
    let workflowHash: string;
    if (workflowInput instanceof Workflow) {
      workflowHash = (workflowInput as any).structureHash ?? hashWorkflow(workflowJson);
    } else {
      workflowHash = hashWorkflow(workflowJson);
    }

    const jobId = options?.jobId ?? this.generateJobId();

    // Extract workflow metadata (outputAliases, outputNodeIds, etc.) if input is a Workflow instance
    let workflowMeta: { outputNodeIds?: string[]; outputAliases?: Record<string, string> } | undefined;
    if (workflowInput instanceof Workflow) {
      workflowMeta = {
        outputNodeIds: (workflowInput as any).outputNodeIds ?? [],
        outputAliases: (workflowInput as any).outputAliases ?? {}
      };
    }

    const affinity = this.affinities.get(workflowHash);

    const preferredClientIds = options?.preferredClientIds 
      ? [...options.preferredClientIds]
      : (affinity?.preferredClientIds ? [...affinity.preferredClientIds] : []);
    const excludeClientIds = options?.excludeClientIds
      ? [...options.excludeClientIds]
      : (affinity?.excludeClientIds ? [...affinity.excludeClientIds] : []);

    const payload: WorkflowJobPayload = {
      jobId,
      workflow: workflowJson,
      workflowHash,
      attempts: 0,
      enqueuedAt: Date.now(),
      workflowMeta,
      options: {
        maxAttempts: options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        retryDelayMs: options?.retryDelayMs ?? DEFAULT_RETRY_DELAY,
        priority: options?.priority ?? 0,
        preferredClientIds: preferredClientIds,
        excludeClientIds: excludeClientIds,
        metadata: options?.metadata ?? {},
        includeOutputs: options?.includeOutputs ?? []
      }
    };

    const record: JobRecord = {
      ...payload,
      options: {
        ...payload.options,
        preferredClientIds: payload.options.preferredClientIds ? [...payload.options.preferredClientIds] : [],
        excludeClientIds: payload.options.excludeClientIds ? [...payload.options.excludeClientIds] : [],
        includeOutputs: payload.options.includeOutputs ? [...payload.options.includeOutputs] : []
      },
      attachments: options?.attachments,
      status: "queued"
    };
    this.jobStore.set(jobId, record);
    await this.queue.enqueue(payload, { priority: payload.options.priority });
    this.dispatchEvent(new CustomEvent("job:queued", { detail: { job: record } }));
    void this.processQueue();
    return jobId;
  }

  getJob(jobId: string): JobRecord | undefined {
    return this.jobStore.get(jobId);
  }

  async cancel(jobId: string): Promise<boolean> {
    const record = this.jobStore.get(jobId);
    if (!record) {
      return false;
    }
    if (record.status === "queued") {
      const removed = await this.queue.remove(jobId);
      if (removed) {
        record.status = "cancelled";
        record.completedAt = Date.now();
        this.clearJobFailures(jobId);
        this.dispatchEvent(new CustomEvent("job:cancelled", { detail: { job: record } }));
        return true;
      }
    }
    const active = this.activeJobs.get(jobId);
    if (active?.cancel) {
      await active.cancel();
      record.status = "cancelled";
      record.completedAt = Date.now();
      this.clearJobFailures(jobId);
      this.dispatchEvent(new CustomEvent("job:cancelled", { detail: { job: record } }));
      return true;
    }
    return false;
  }

  async shutdown(): Promise<void> {
    this.clientManager.destroy();
    await this.queue.shutdown();
    for (const [, ctx] of Array.from(this.activeJobs)) {
      ctx.release({ success: false });
    }
    this.activeJobs.clear();
  }

  async getQueueStats(): Promise<QueueStats> {
    return this.queue.stats();
  }

  private normalizeWorkflow(input: WorkflowInput): object {
    if (typeof input === "string") {
      return JSON.parse(input);
    }
    if (input instanceof Workflow) {
      return cloneDeep((input as any).json ?? {});
    }
    if (typeof (input as any)?.toJSON === "function") {
      return cloneDeep((input as any).toJSON());
    }
    return cloneDeep(input);
  }

  private generateJobId(): string {
    try {
      return randomUUID();
    } catch {
      return WorkflowPool.fallbackId();
    }
  }

  private static fallbackId(): string {
    return globalThis.crypto && "randomUUID" in globalThis.crypto
      ? globalThis.crypto.randomUUID()
      : `job_${Math.random().toString(36).slice(2, 10)}`;
  }

  private scheduleProcess(delayMs: number) {
    const wait = Math.max(delayMs, 10);
    setTimeout(() => {
      void this.processQueue();
    }, wait);
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

  private rememberJobFailure(job: JobRecord, clientId: string, analysis: WorkflowFailureAnalysis) {
    let map = this.jobFailureAnalysis.get(job.jobId);
    if (!map) {
      map = new Map();
      this.jobFailureAnalysis.set(job.jobId, map);
    }
    map.set(clientId, analysis);
  }

  private clearJobFailures(jobId: JobId) {
    this.jobFailureAnalysis.delete(jobId);
  }

  private collectFailureReasons(jobId: JobId): Record<string, string | undefined> {
    const map = this.jobFailureAnalysis.get(jobId);
    if (!map) {
      return {};
    }
    const reasons: Record<string, string | undefined> = {};
    for (const [clientId, analysis] of map.entries()) {
      reasons[clientId] = analysis.reason;
    }
    return reasons;
  }

  private addPermanentExclusion(job: JobRecord, clientId: string) {
    if (!job.options.excludeClientIds) {
      job.options.excludeClientIds = [];
    }
    if (!job.options.excludeClientIds.includes(clientId)) {
      job.options.excludeClientIds.push(clientId);
    }
  }

  private hasRetryPath(job: JobRecord): boolean {
    const map = this.jobFailureAnalysis.get(job.jobId);
    const exclude = new Set(job.options.excludeClientIds ?? []);
    const preferred = job.options.preferredClientIds?.length ? new Set(job.options.preferredClientIds) : null;
    for (const client of this.clientManager.list()) {
      if (preferred && !preferred.has(client.id)) {
        continue;
      }
      if (exclude.has(client.id)) {
        continue;
      }
      const analysis = map?.get(client.id);
      if (analysis?.blockClient === "permanent") {
        continue;
      }
      return true;
    }
    return false;
  }

  private createWorkflowNotSupportedError(job: JobRecord, cause?: unknown): WorkflowNotSupportedError {
    const reasons = this.collectFailureReasons(job.jobId);
    const message = `Workflow ${job.workflowHash} is not supported by any connected clients`;
    return new WorkflowNotSupportedError(message, {
      workflowHash: job.workflowHash,
      reasons,
      cause
    });
  }

  private async processQueue(): Promise<void> {
    this.debugLog("[processQueue] Called");
    if (this.processing) {
      this.debugLog("[processQueue] Already processing, returning early");
      this.processQueued = true;
      return;
    }
    this.processing = true;
    try {
      // Continue processing until no more jobs can be assigned
      let iteration = 0;
      while (true) {
        iteration++;
        this.debugLog(`[processQueue] Iteration ${iteration}`);
        
        const idleClients = this.clientManager.list().filter(c => this.clientManager.isClientStable(c));
        this.debugLog(`[processQueue] Idle clients: [${idleClients.map(c => c.id).join(", ")}] (${idleClients.length})`);
        if (!idleClients.length) {
          this.debugLog("[processQueue] No idle clients, breaking");
          break; // No idle clients available
        }

        const waitingJobs = await this.queue.peek(100); // Peek at top 100 jobs
        this.debugLog(`[processQueue] Waiting jobs in queue: ${waitingJobs.length}`);
        if (!waitingJobs.length) {
          this.debugLog("[processQueue] No waiting jobs, breaking");
          break; // No jobs in queue
        }

        const leasedClientIds = new Set<string>();
        const reservedJobIds = new Set<string>();

        // Build compatibility matrix and calculate job selectivity
        interface JobMatchInfo {
          jobPayload: typeof waitingJobs[0];
          job: JobRecord;
          compatibleClients: string[];
          selectivity: number; // Lower is more selective (fewer compatible clients)
        }

        const jobMatchInfos: JobMatchInfo[] = [];
        for (const jobPayload of waitingJobs) {
          const job = this.jobStore.get(jobPayload.jobId);
          if (!job) {
            this.debugLog(`[processQueue] Job ${jobPayload.jobId} not in jobStore, skipping`);
            continue;
          }

          const compatibleClients = idleClients
            .filter(client => {
              const canRun = this.clientManager.canClientRunJob(client, job);
              if (!canRun) {
                this.debugLog(`[processQueue] Job ${job.jobId.substring(0, 8)}... NOT compatible with ${client.id}. Checking why...`);
                this.debugLog(`[processQueue]   - preferredClientIds: ${JSON.stringify(job.options.preferredClientIds)}`);
                this.debugLog(`[processQueue]   - excludeClientIds: ${JSON.stringify(job.options.excludeClientIds)}`);
                this.debugLog(`[processQueue]   - client.id: ${client.id}`);
              }
              return canRun;
            })
            .map(client => client.id);

          this.debugLog(`[processQueue] Job ${job.jobId.substring(0, 8)}... compatible with: [${compatibleClients.join(", ")}] (selectivity=${compatibleClients.length})`);

          if (compatibleClients.length > 0) {
            jobMatchInfos.push({
              jobPayload,
              job,
              compatibleClients,
              selectivity: compatibleClients.length
            });
          }
        }

        this.debugLog(`[processQueue] Found ${jobMatchInfos.length} compatible job matches`);
        if (jobMatchInfos.length === 0) {
          this.debugLog("[processQueue] No compatible jobs for idle clients, breaking");
          break; // No compatible jobs for idle clients
        }

        // Sort jobs by priority first, then selectivity, to maximize throughput
        // 1. Higher priority jobs execute first (explicit user priority)
        // 2. More selective jobs (fewer compatible clients) assigned first within same priority
        // 3. Earlier queue position as final tiebreaker
        jobMatchInfos.sort((a, b) => {
          // Primary: priority (higher priority = higher precedence)
          const aPriority = a.job.options.priority ?? 0;
          const bPriority = b.job.options.priority ?? 0;
          if (aPriority !== bPriority) {
            return bPriority - aPriority; // Higher priority first
          }
          // Secondary: selectivity (fewer compatible clients = higher precedence)
          if (a.selectivity !== b.selectivity) {
            return a.selectivity - b.selectivity;
          }
          // Tertiary: maintain queue order (earlier jobs first)
          const aIndex = waitingJobs.indexOf(a.jobPayload);
          const bIndex = waitingJobs.indexOf(b.jobPayload);
          return aIndex - bIndex;
        });

        // Assign jobs to clients using the selectivity-based ordering
        let assignedAnyJob = false;
        for (const matchInfo of jobMatchInfos) {
          if (reservedJobIds.has(matchInfo.job.jobId)) continue;

          // Find first available compatible client
          const availableClient = matchInfo.compatibleClients.find(
            clientId => !leasedClientIds.has(clientId)
          );

          if (!availableClient) {
            this.debugLog(`[processQueue] No available client for job ${matchInfo.job.jobId.substring(0, 8)}...`);
            continue; // No available clients for this job
          }

          this.debugLog(`[processQueue] Reserving job ${matchInfo.job.jobId.substring(0, 8)}... for client ${availableClient}`);
          const reservation = await this.queue.reserveById(matchInfo.job.jobId);
          if (reservation) {
            // Mark as leased/reserved for this cycle
            leasedClientIds.add(availableClient);
            reservedJobIds.add(matchInfo.job.jobId);
            assignedAnyJob = true;

            // Get the lease (which marks the client as busy)
            const lease = this.clientManager.claim(matchInfo.job, availableClient);
            if (lease) {
              this.debugLog(`[processQueue] Starting job ${matchInfo.job.jobId.substring(0, 8)}... on client ${availableClient}`);
              this.runJob({ reservation, job: matchInfo.job, clientId: lease.clientId, release: lease.release }).catch((error) => {
                console.error("[WorkflowPool] Unhandled job error", error);
              });
            } else {
              // This should not happen since we checked canClientRunJob, but handle defensively
              console.error(`[processQueue.processQueue] CRITICAL: Failed to claim client ${availableClient} for job ${matchInfo.job.jobId} after successful check.`);
              await this.queue.retry(reservation.reservationId, { delayMs: matchInfo.job.options.retryDelayMs });
            }
          } else {
            this.debugLog(`[processQueue] Failed to reserve job ${matchInfo.job.jobId.substring(0, 8)}...`);
          }
        }

        this.debugLog(`[processQueue] Assigned any job in this iteration: ${assignedAnyJob}`);
        // If we didn't assign any jobs this iteration, no point continuing
        if (!assignedAnyJob) {
          this.debugLog("[processQueue] No jobs assigned, breaking");
          break;
        }
      }

    } finally {
      this.debugLog("[processQueue] Exiting, setting processing = false");
      this.processing = false;
      if (this.processQueued) {
        this.debugLog("[processQueue] Pending rerun detected, draining queue again");
        this.processQueued = false;
        void this.processQueue();
      }
    }
  }

  private async runJob(ctx: ActiveJobContext): Promise<void> {
    const { reservation, job, clientId, release } = ctx;
    let released = false;
    const safeRelease = (opts?: { success?: boolean }) => {
      if (released) {
        return;
      }
      released = true;
      release(opts);
    };
    const managed = this.clientManager.getClient(clientId);
    const client = managed?.client;
    if (!client) {
      await this.queue.retry(reservation.reservationId, { delayMs: job.options.retryDelayMs });
      safeRelease({ success: false });
      return;
    }
    job.status = "running";
    job.clientId = clientId;
    job.attempts += 1;
    reservation.payload.attempts = job.attempts;
    job.startedAt = Date.now();
    // Don't dispatch job:started here - wait until we have promptId in onPending
    // this.dispatchEvent(new CustomEvent("job:started", { detail: { job } }));

    const workflowPayload = cloneDeep(reservation.payload.workflow) as Record<string, any>;

    if (job.attachments?.length) {
      for (const attachment of job.attachments) {
        const filename = attachment.filename ?? `${job.jobId}-${attachment.nodeId}-${attachment.inputName}.bin`;
        const blob = attachment.file instanceof Buffer ? new Blob([new Uint8Array(attachment.file)]) : attachment.file;
        await client.ext.file.uploadImage(blob, filename, { override: true });

        const node = workflowPayload[attachment.nodeId];
        if (node?.inputs) {
          node.inputs[attachment.inputName] = filename;
        }
      }
    }

    const autoSeeds = this.applyAutoSeed(workflowPayload);
    let wfInstance = Workflow.from(workflowPayload);
    if (job.options.includeOutputs?.length) {
      for (const nodeId of job.options.includeOutputs) {
        if (nodeId) {
          wfInstance = wfInstance.output(nodeId as any);
        }
      }
    }
    (wfInstance as any).inferDefaultOutputs?.();

    // Use stored metadata if available (from Workflow instance), otherwise extract from recreated instance
    const outputNodeIds: string[] =
      reservation.payload.workflowMeta?.outputNodeIds ??
      (wfInstance as any).outputNodeIds ??
      job.options.includeOutputs ??
      [];
    const outputAliases: Record<string, string> =
      reservation.payload.workflowMeta?.outputAliases ?? (wfInstance as any).outputAliases ?? {};

    let promptBuilder = new PromptBuilder<any, any, any>(
      (wfInstance as any).json,
      (wfInstance as any).inputPaths ?? [],
      outputNodeIds as any
    );
    for (const nodeId of outputNodeIds) {
      const alias = outputAliases[nodeId] ?? nodeId;
      promptBuilder = promptBuilder.setOutputNode(alias as any, nodeId as any);
    }
    const wrapper = new CallWrapper(client, promptBuilder);

    // Setup profiling if enabled
    const profiler = this.opts.enableProfiling ? new JobProfiler(job.enqueuedAt, workflowPayload) : undefined;

    // Setup node execution timeout tracking
    const nodeExecutionTimeout = this.opts.nodeExecutionTimeoutMs ?? 300000; // 5 minutes default
    let nodeTimeoutId: NodeJS.Timeout | undefined;
    let lastNodeStartTime: number | undefined;
    let currentExecutingNode: string | null = null;

    const resetNodeTimeout = (nodeName?: string) => {
      if (nodeTimeoutId) {
        clearTimeout(nodeTimeoutId);
        nodeTimeoutId = undefined;
      }

      if (nodeExecutionTimeout > 0 && nodeName !== null) {
        lastNodeStartTime = Date.now();
        currentExecutingNode = nodeName || null;

        nodeTimeoutId = setTimeout(() => {
          const elapsed = Date.now() - (lastNodeStartTime || 0);
          const nodeInfo = currentExecutingNode ? ` (node: ${currentExecutingNode})` : "";
          completionError = new Error(
            `Node execution timeout: took longer than ${nodeExecutionTimeout}ms${nodeInfo}. ` +
              `Actual time: ${elapsed}ms. Server may be stuck or node is too slow for configured timeout.`
          );
          resolveCompletion?.();
        }, nodeExecutionTimeout);
      }
    };

    const clearNodeTimeout = () => {
      if (nodeTimeoutId) {
        clearTimeout(nodeTimeoutId);
        nodeTimeoutId = undefined;
      }
      currentExecutingNode = null;
      lastNodeStartTime = undefined;
    };

    // Setup profiling event listeners on the raw ComfyUI client
    if (profiler) {
      const onExecutionStart = (event: CustomEvent) => {
        const promptId = event.detail?.prompt_id;
        if (promptId) {
          profiler.onExecutionStart(promptId);
        }
      };

      const onExecutionCached = (event: CustomEvent) => {
        const nodes = event.detail?.nodes;
        if (Array.isArray(nodes)) {
          profiler.onCachedNodes(nodes.map(String));
        }
      };

      const onExecuting = (event: CustomEvent) => {
        const node = event.detail?.node;
        if (node === null) {
          // Workflow completed
          profiler.onExecutionComplete();
        } else if (node !== undefined) {
          profiler.onNodeExecuting(String(node));
        }
      };

      const onExecutionError = (event: CustomEvent) => {
        const detail = event.detail || {};
        if (detail.node !== undefined) {
          profiler.onNodeError(String(detail.node), detail.exception_message || "Execution error");
        }
      };

      // Attach listeners to client
      client.addEventListener("execution_start", onExecutionStart as EventListener);
      client.addEventListener("execution_cached", onExecutionCached as EventListener);
      client.addEventListener("executing", onExecuting as EventListener);
      client.addEventListener("execution_error", onExecutionError as EventListener);

      // Cleanup function to remove listeners
      const cleanupProfiler = () => {
        client.removeEventListener("execution_start", onExecutionStart as EventListener);
        client.removeEventListener("execution_cached", onExecutionCached as EventListener);
        client.removeEventListener("executing", onExecuting as EventListener);
        client.removeEventListener("execution_error", onExecutionError as EventListener);
      };

      // Ensure cleanup happens when job finishes
      wrapper.onFinished(() => cleanupProfiler());
      wrapper.onFailed(() => cleanupProfiler());
    }

    // Setup node execution timeout listeners (always active if timeout > 0)
    const onNodeExecuting = (event: CustomEvent) => {
      const node = event.detail?.node;
      if (node === null) {
        // Workflow completed - clear timeout
        clearNodeTimeout();
      } else if (node !== undefined) {
        // New node started - reset timeout
        resetNodeTimeout(String(node));
      }
    };

    const onNodeProgress = (event: CustomEvent) => {
      // Progress event means node is still working - reset timeout
      if (event.detail?.node) {
        resetNodeTimeout(String(event.detail.node));
      }
    };

    const onExecutionStarted = (event: CustomEvent) => {
      // Execution started - reset timeout for first node
      resetNodeTimeout("execution_start");
    };

    if (nodeExecutionTimeout > 0) {
      client.addEventListener("execution_start", onExecutionStarted as EventListener);
      client.addEventListener("executing", onNodeExecuting as EventListener);
      client.addEventListener("progress", onNodeProgress as EventListener);
    }

    const cleanupNodeTimeout = () => {
      clearNodeTimeout();
      if (nodeExecutionTimeout > 0) {
        client.removeEventListener("execution_start", onExecutionStarted as EventListener);
        client.removeEventListener("executing", onNodeExecuting as EventListener);
        client.removeEventListener("progress", onNodeProgress as EventListener);
      }
    };

    let pendingSettled = false;
    let resolvePending: (() => void) | undefined;
    let rejectPending: ((error: unknown) => void) | undefined;
    const pendingPromise = new Promise<void>((resolve, reject) => {
      resolvePending = () => {
        if (!pendingSettled) {
          pendingSettled = true;
          resolve();
        }
      };
      rejectPending = (err) => {
        if (!pendingSettled) {
          pendingSettled = true;
          reject(err);
        }
      };
    });

    let resolveCompletion: (() => void) | undefined;
    let completionError: unknown;
    // completionPromise is used to track when the wrapper completes (success or failure)
    // It's resolved in onFinished and onFailed handlers
    const completionPromise = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });

    let jobStartedDispatched = false;

    wrapper.onProgress((progress, promptId) => {
      if (!job.promptId && promptId) {
        job.promptId = promptId;
      }
      // Dispatch job:started on first progress update with promptId
      if (!jobStartedDispatched && job.promptId) {
        jobStartedDispatched = true;
        this.dispatchEvent(new CustomEvent("job:started", { detail: { job } }));
      }
      // Feed progress to profiler
      if (profiler) {
        profiler.onProgress(progress);
      }
      this.dispatchEvent(
        new CustomEvent("job:progress", {
          detail: { jobId: job.jobId, clientId, progress }
        })
      );
    });

    wrapper.onPreview((blob, promptId) => {
      if (!job.promptId && promptId) {
        job.promptId = promptId;
      }
      // Dispatch job:started on first preview with promptId
      if (!jobStartedDispatched && job.promptId) {
        jobStartedDispatched = true;
        this.dispatchEvent(new CustomEvent("job:started", { detail: { job } }));
      }
      this.dispatchEvent(
        new CustomEvent("job:preview", {
          detail: { jobId: job.jobId, clientId, blob }
        })
      );
    });

    wrapper.onPreviewMeta((payload, promptId) => {
      if (!job.promptId && promptId) {
        job.promptId = promptId;
      }
      // Dispatch job:started on first preview_meta with promptId
      if (!jobStartedDispatched && job.promptId) {
        jobStartedDispatched = true;
        this.dispatchEvent(new CustomEvent("job:started", { detail: { job } }));
      }
      this.dispatchEvent(
        new CustomEvent("job:preview_meta", {
          detail: { jobId: job.jobId, clientId, payload }
        })
      );
    });

    wrapper.onOutput((key, data, promptId) => {
      if (!job.promptId && promptId) {
        job.promptId = promptId;
      }
      this.dispatchEvent(
        new CustomEvent("job:output", {
          detail: { jobId: job.jobId, clientId, key: String(key), data }
        })
      );
    });

    wrapper.onPending((promptId) => {
      if (!job.promptId && promptId) {
        job.promptId = promptId;
      }
      // Don't dispatch job:started here - wait for first progress/preview with promptId
      this.dispatchEvent(new CustomEvent("job:accepted", { detail: { job } }));
      resolvePending?.();
    });

    wrapper.onStart((promptId) => {
      if (!job.promptId && promptId) {
        job.promptId = promptId;
      }
    });

    wrapper.onFinished((data, promptId) => {
      if (!job.promptId && promptId) {
        job.promptId = promptId;
      }
      job.status = "completed";
      job.lastError = undefined;

      const resultPayload: Record<string, unknown> = {};
      for (const nodeId of outputNodeIds) {
        const alias = outputAliases[nodeId] ?? nodeId;
        // CallWrapper uses alias keys when mapOutputKeys is configured, fallback to nodeId
        const nodeResult = (data as any)[alias];
        const fallbackResult = (data as any)[nodeId];
        const finalResult = nodeResult !== undefined ? nodeResult : fallbackResult;

        resultPayload[alias] = finalResult;
      }
      resultPayload._nodes = [...outputNodeIds];
      resultPayload._aliases = { ...outputAliases };
      if (job.promptId) {
        resultPayload._promptId = job.promptId;
      }
      if (Object.keys(autoSeeds).length) {
        resultPayload._autoSeeds = { ...autoSeeds };
      }
      job.result = resultPayload;
      job.completedAt = Date.now();
      this.clearJobFailures(job.jobId);

      // Cleanup timeouts
      cleanupNodeTimeout();

      // Attach profiling stats if profiling was enabled
      if (profiler) {
        job.profileStats = profiler.getStats();
      }

      completionError = undefined;
      this.dispatchEvent(new CustomEvent("job:completed", { detail: { job } }));
      safeRelease({ success: true });
      resolveCompletion?.();
    });

    wrapper.onFailed((error, promptId) => {
      this.debugLog("[debug] wrapper.onFailed", job.jobId, error.name);
      if (!job.promptId && promptId) {
        job.promptId = promptId;
      }
      job.lastError = error;

      // Cleanup timeouts
      cleanupNodeTimeout();

      rejectPending?.(error);
      completionError = error;
      this.debugLog("[debug] resolveCompletion available", Boolean(resolveCompletion));
      safeRelease({ success: false });
      resolveCompletion?.();
    });

    try {
      // Start the workflow execution
      const exec = wrapper.run();

      // Add timeout for execution start to prevent jobs getting stuck
      const executionStartTimeout = this.opts.executionStartTimeoutMs ?? 5000;
      let pendingTimeoutId: NodeJS.Timeout | undefined;

      if (executionStartTimeout > 0) {
        const pendingWithTimeout = Promise.race([
          pendingPromise,
          new Promise<never>((_, reject) => {
            pendingTimeoutId = setTimeout(() => {
              reject(
                new Error(
                  `Execution failed to start within ${executionStartTimeout}ms. ` +
                    `Server may be stuck or unresponsive.`
                )
              );
            }, executionStartTimeout);
          })
        ]);

        await pendingWithTimeout;
      } else {
        await pendingPromise;
      }

      if (executionStartTimeout > 0) {
        clearTimeout(pendingTimeoutId);
      }

      this.activeJobs.set(job.jobId, {
        reservation,
        job,
        clientId,
        release: (opts) => safeRelease(opts),
        cancel: async () => {
          try {
            wrapper.cancel("workflow pool cancel");
            if (job.promptId) {
              await client.ext.queue.interrupt(job.promptId);
            }
          } finally {
            this.activeJobs.delete(job.jobId);
            await this.queue.discard(reservation.reservationId, new Error("cancelled"));
            safeRelease({ success: false });
          }
        }
      });

      const result = await exec;
      
      // Wait for the wrapper to complete (onFinished or onFailed callback)
      await completionPromise;

      if (result === false) {
        const errorToThrow =
          (completionError instanceof Error ? completionError : undefined) ??
          (job.lastError instanceof Error ? job.lastError : undefined) ??
          new Error("Execution failed");
        throw errorToThrow;
      }

      await this.queue.commit(reservation.reservationId);
      safeRelease({ success: true});

    } catch (error) {
      // Immediately release the client on any failure
      safeRelease({ success: false });

      const latestStatus = this.jobStore.get(job.jobId)?.status;
      if (latestStatus === "cancelled") {
        return;
      }
      job.lastError = error;
      job.status = "failed";
      const remainingAttempts = job.options.maxAttempts - job.attempts;
      const failureAnalysis = analyzeWorkflowFailure(error);
      this.rememberJobFailure(job, clientId, failureAnalysis);
      if (failureAnalysis.blockClient === "permanent") {
        this.addPermanentExclusion(job, clientId);
        reservation.payload.options.excludeClientIds = [...(job.options.excludeClientIds ?? [])];
      }
      this.clientManager.recordFailure(clientId, job, error);
      const hasRetryPath = this.hasRetryPath(job);
      const willRetry = failureAnalysis.retryable && remainingAttempts > 0 && hasRetryPath;
      this.dispatchEvent(
        new CustomEvent("job:failed", {
          detail: { job, willRetry }
        })
      );
      if (willRetry) {
        const delay = this.opts.retryBackoffMs ?? job.options.retryDelayMs;
        this.dispatchEvent(new CustomEvent("job:retrying", { detail: { job, delayMs: delay } }));
        job.status = "queued";
        job.clientId = undefined;
        job.promptId = undefined;
        job.startedAt = undefined;
        job.completedAt = undefined;
        job.result = undefined;
        reservation.payload.options.excludeClientIds = [...(job.options.excludeClientIds ?? [])];
        await this.queue.retry(reservation.reservationId, { delayMs: delay });
        this.dispatchEvent(new CustomEvent("job:queued", { detail: { job } }));
        this.scheduleProcess(delay);
      } else {
        job.completedAt = Date.now();
        const finalError =
          !hasRetryPath && failureAnalysis.type === "client_incompatible" && this.jobFailureAnalysis.has(job.jobId)
            ? this.createWorkflowNotSupportedError(job, error)
            : error;
        job.lastError = finalError;
        await this.queue.discard(reservation.reservationId, finalError);
        this.clearJobFailures(job.jobId);
      }
    } finally {
      this.activeJobs.delete(job.jobId);
      this.debugLog(`[runJob.finally] Job ${job.jobId.substring(0, 8)}... completed, calling processQueue()`);
      void this.processQueue();
    }
  }
}
