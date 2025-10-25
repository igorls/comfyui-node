import { TypedEventTarget } from "../typed-event-target.js";
import type { ComfyApi } from "../client.js";
import type { QueueAdapter, QueueStats } from "./queue/QueueAdapter.js";
import type { FailoverStrategy } from "./failover/Strategy.js";
import type { JobRecord, WorkflowInput, WorkflowJobOptions, JobId } from "./types/job.js";
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
export declare class WorkflowPool extends TypedEventTarget<WorkflowPoolEventMap> {
    private queue;
    private strategy;
    private clientManager;
    private opts;
    private jobStore;
    private initPromise;
    private processing;
    private activeJobs;
    constructor(clients: ComfyApi[], opts?: WorkflowPoolOpts);
    ready(): Promise<void>;
    enqueue(workflowInput: WorkflowInput, options?: WorkflowJobOptions): Promise<JobId>;
    getJob(jobId: string): JobRecord | undefined;
    cancel(jobId: string): Promise<boolean>;
    shutdown(): Promise<void>;
    getQueueStats(): Promise<QueueStats>;
    private normalizeWorkflow;
    private generateJobId;
    private static fallbackId;
    private scheduleProcess;
    /**
     * 🎯 Coleta todos os checkpoints disponíveis nos clientes online e livres.
     * Isso permite que a fila reserve apenas jobs que PODEM ser processados AGORA.
     */
    private getAvailableCheckpoints;
    private applyAutoSeed;
    private processQueue;
    private runJob;
}
//# sourceMappingURL=WorkflowPool.d.ts.map