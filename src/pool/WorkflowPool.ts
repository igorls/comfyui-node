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

/**
 * Configuration options for WorkflowPool.
 */
export interface WorkflowPoolOpts {
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
  private initPromise: Promise<void>;
  private processing = false;
  private activeJobs: Map<JobId, ActiveJobContext> = new Map();

  constructor(clients: ComfyApi[], opts?: WorkflowPoolOpts) {
    super();
    this.strategy = opts?.failoverStrategy ?? new SmartFailoverStrategy();
    this.queue = opts?.queueAdapter ?? new MemoryQueueAdapter();
    this.clientManager = new ClientManager(this.strategy, {
      healthCheckIntervalMs: opts?.healthCheckIntervalMs ?? 30000
    });
    this.opts = opts ?? {};
    this.clientManager.on("client:state", (ev) => {
      this.dispatchEvent(new CustomEvent("client:state", { detail: ev.detail }));
      // 🎯 Quando um cliente ficar livre, tenta processar fila novamente
      // Isso garante que jobs esperando por checkpoints específicos sejam processados
      if (!ev.detail.busy && ev.detail.online) {
        this.scheduleProcess(10); // Pequeno delay para evitar loop tight
      }
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
        this.dispatchEvent(new CustomEvent("pool:ready", {
          detail: { clientIds: this.clientManager.list().map((c) => c.id) }
        }));
      })
      .catch((error) => {
        this.dispatchEvent(new CustomEvent("pool:error", { detail: { error } }));
      });
  }

  async ready(): Promise<void> {
    await this.initPromise;
  }

  async enqueue(workflowInput: WorkflowInput, options?: WorkflowJobOptions): Promise<JobId> {
    await this.ready();
    const workflowJson = this.normalizeWorkflow(workflowInput);
    const workflowHash = hashWorkflow(workflowJson);
    const jobId = options?.jobId ?? this.generateJobId();

    // Extract workflow metadata (outputAliases, outputNodeIds, etc.) if input is a Workflow instance
    let workflowMeta: { outputNodeIds?: string[]; outputAliases?: Record<string, string> } | undefined;
    if (workflowInput instanceof Workflow) {
      workflowMeta = {
        outputNodeIds: (workflowInput as any).outputNodeIds ?? [],
        outputAliases: (workflowInput as any).outputAliases ?? {}
      };
    }

    // Auto-detect required checkpoints if not explicitly provided
    let requiredCheckpoints = options?.requiredCheckpoints;
    if (!requiredCheckpoints || requiredCheckpoints.length === 0) {
      try {
        if (workflowInput instanceof Workflow) {
          requiredCheckpoints = workflowInput.extractCheckpoints();
        } else {
          // Try to detect checkpoints from raw JSON
          const tempWf = Workflow.from(workflowJson);
          requiredCheckpoints = tempWf.extractCheckpoints();
        }
      } catch (e) {
        // Non-fatal: proceed without checkpoint filtering
        console.warn('[WorkflowPool] Failed to extract checkpoints from workflow:', e);
      }
    }

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
        preferredClientIds: options?.preferredClientIds ?? [],
        excludeClientIds: options?.excludeClientIds ?? [],
        requiredCheckpoints: requiredCheckpoints ?? [],
        metadata: options?.metadata ?? {},
        includeOutputs: options?.includeOutputs ?? []
      }
    };

    const record: JobRecord = {
      ...payload,
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
        this.dispatchEvent(new CustomEvent("job:cancelled", { detail: { job: record } }));
        return true;
      }
    }
    const active = this.activeJobs.get(jobId);
    if (active?.cancel) {
      await active.cancel();
      record.status = "cancelled";
      record.completedAt = Date.now();
      this.dispatchEvent(new CustomEvent("job:cancelled", { detail: { job: record } }));
      return true;
    }
    return false;
  }

  async shutdown(): Promise<void> {
    this.clientManager.destroy();
    await this.queue.shutdown();
    for (const [, ctx] of this.activeJobs) {
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
    return (globalThis.crypto && "randomUUID" in globalThis.crypto)
      ? globalThis.crypto.randomUUID()
      : `job_${Math.random().toString(36).slice(2, 10)}`;
  }

  private scheduleProcess(delayMs: number) {
    const wait = Math.max(delayMs, 10);
    setTimeout(() => {
      void this.processQueue();
    }, wait);
  }

  /**
   * 🎯 Coleta todos os checkpoints disponíveis nos clientes online e livres.
   * Isso permite que a fila reserve apenas jobs que PODEM ser processados AGORA.
   */
  private async getAvailableCheckpoints(): Promise<string[]> {
    const allCheckpoints = new Set<string>();
    const clients = this.clientManager.list();
    
    for (const managed of clients) {
      // Só considera clientes online e livres
      if (!managed.online || managed.busy) {
        continue;
      }
      
      try {
        // Busca checkpoints do cliente (com cache)
        const checkpoints = await this.clientManager.getClientCheckpoints(managed.id);
        checkpoints.forEach(ckpt => allCheckpoints.add(ckpt));
      } catch (error) {
        // Ignora erros e continua com outros clientes
        console.warn(`[WorkflowPool] Failed to get checkpoints for client ${managed.id}:`, error);
      }
    }
    
    return Array.from(allCheckpoints);
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

  private async processQueue(): Promise<void> {
    if (this.processing) {
      return;
    }
    this.processing = true;
    try {
      while (true) {
        // 🎯 Coleta checkpoints disponíveis de TODOS os clientes online e livres
        const availableCheckpoints = await this.getAvailableCheckpoints();
        
        // Se NÃO HÁ clientes disponíveis, para o loop
        const availableClients = this.clientManager.list().filter(c => c.online && !c.busy);
        if (availableClients.length === 0) {
          break;
        }
        
        // Tenta reservar o PRIMEIRO job da fila se for compatível
        const reservation = await this.queue.reserve({ availableCheckpoints });
        if (!reservation) {
          // Nenhum job disponível OU primeiro job não é compatível com nodes disponíveis
          // Para o loop e aguarda mudanças (cliente ficar livre, etc)
          break;
        }
        const job = this.jobStore.get(reservation.payload.jobId);
        if (!job) {
          await this.queue.commit(reservation.reservationId);
          continue;
        }
        const lease = await this.clientManager.claimAsync(job);
        if (!lease) {
          // Não deveria acontecer (já filtramos por checkpoints), mas mantemos fallback
          await this.queue.retry(reservation.reservationId, { delayMs: job.options.retryDelayMs });
          this.scheduleProcess(job.options.retryDelayMs);
          break;
        }
        this.runJob({ reservation, job, clientId: lease.clientId, release: lease.release }).catch((error) => {
          console.error("[WorkflowPool] Unhandled job error", error);
        });
      }
    } finally {
      this.processing = false;
    }
  }

  private async runJob(ctx: ActiveJobContext): Promise<void> {
    const { reservation, job, clientId, release } = ctx;
    const managed = this.clientManager.getClient(clientId);
    const client = managed?.client;
    if (!client) {
      await this.queue.retry(reservation.reservationId, { delayMs: job.options.retryDelayMs });
      release({ success: false });
      return;
    }
    job.status = "running";
    job.clientId = clientId;
    job.attempts += 1;
    reservation.payload.attempts = job.attempts;
    job.startedAt = Date.now();
    // Don't dispatch job:started here - will be dispatched in onPending when we have promptId
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
    const outputNodeIds: string[] = reservation.payload.workflowMeta?.outputNodeIds ??
      (wfInstance as any).outputNodeIds ??
      job.options.includeOutputs ?? [];
    const outputAliases: Record<string, string> = reservation.payload.workflowMeta?.outputAliases ??
      (wfInstance as any).outputAliases ?? {};

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
    let rejectCompletion: ((error: unknown) => void) | undefined;
    const completionPromise = new Promise<void>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
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
      this.dispatchEvent(new CustomEvent("job:completed", { detail: { job } }));
      resolveCompletion?.();
    });

    wrapper.onFailed((error, promptId) => {
      if (!job.promptId && promptId) {
        job.promptId = promptId;
      }
      job.lastError = error;
      rejectPending?.(error);
      rejectCompletion?.(error);
    });

    try {
      const exec = wrapper.run();
      await pendingPromise;
      this.activeJobs.set(job.jobId, {
        reservation,
        job,
        clientId,
        release,
        cancel: async () => {
          try {
            if (job.promptId) {
              await client.ext.queue.interrupt(job.promptId);
            }
          } finally {
            this.activeJobs.delete(job.jobId);
            await this.queue.discard(reservation.reservationId, new Error("cancelled"));
            release({ success: false });
          }
        }
      });
      const result = await exec;
      if (result === false) {
        // Execution failed - try to get the error from completionPromise rejection
        try {
          await completionPromise;
        } catch (err) {
          throw err;
        }
        throw job.lastError ?? new Error("Execution failed");
      }
      await completionPromise;
      await this.queue.commit(reservation.reservationId);
      release({ success: true });
    } catch (error) {
      const latestStatus = this.jobStore.get(job.jobId)?.status;
      if (latestStatus === "cancelled") {
        release({ success: false });
        return;
      }
      job.lastError = error;
      job.status = "failed";
      this.clientManager.recordFailure(clientId, job, error);
      const remainingAttempts = job.options.maxAttempts - job.attempts;
      const willRetry = remainingAttempts > 0;
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
        await this.queue.retry(reservation.reservationId, { delayMs: delay });
        this.dispatchEvent(new CustomEvent("job:queued", { detail: { job } }));
        this.scheduleProcess(delay);
        release({ success: false });
      } else {
        job.completedAt = Date.now();
        await this.queue.discard(reservation.reservationId, error);
        release({ success: false });
      }
    } finally {
      this.activeJobs.delete(job.jobId);
      void this.processQueue();
    }
  }
}
