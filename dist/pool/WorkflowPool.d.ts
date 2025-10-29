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
     * @since 1.4.4
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
     * @since 1.4.4
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
export declare class WorkflowPool extends TypedEventTarget<WorkflowPoolEventMap> {
    private queue;
    private strategy;
    private clientManager;
    private opts;
    private jobStore;
    private jobFailureAnalysis;
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
    private applyAutoSeed;
    private rememberJobFailure;
    private clearJobFailures;
    private collectFailureReasons;
    private addPermanentExclusion;
    private hasRetryPath;
    private createWorkflowNotSupportedError;
    private processQueue;
    private runJob;
}
//# sourceMappingURL=WorkflowPool.d.ts.map