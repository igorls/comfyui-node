import { PoolEventManager } from "./pool-event-manager.js";
import { JobQueueProcessor } from "./job-queue-processor.js";
import { Workflow } from "./workflow.js";
import { MultiWorkflowPoolOptions, PoolEvent, JobResults, SubmitJobOptions } from "./interfaces.js";
/**
 * MultiWorkflowPool class to manage heterogeneous clusters of ComfyUI workers with different workflow capabilities.
 * Using a fully event driven architecture to handle client connections, job submissions, and failover strategies.
 * Zero polling is used; all operations are event driven. Maximizes responsiveness and scalability.
 */
export declare class MultiWorkflowPool {
    protected events: PoolEventManager;
    private clientRegistry;
    private jobRegistry;
    queues: Map<string, JobQueueProcessor>;
    options: Required<MultiWorkflowPoolOptions>;
    monitoringInterval?: Timer;
    constructor(options?: MultiWorkflowPoolOptions);
    init(): Promise<void>;
    shutdown(): Promise<void>;
    addClient(clientUrl: string, options?: {
        workflowAffinity: Workflow<any>[];
        priority?: number;
        clientId?: string;
    }): void;
    removeClient(clientUrl: string): void;
    submitJob(workflow: Workflow<any>, options?: SubmitJobOptions): Promise<string>;
    /**
     * Submit a LOGICAL job that has a distinct workflow variant per host
     * capability — e.g. the same render compiled for different GPUs or model
     * quantizations, where each host can only run its own variant (different model
     * filenames give the variants different structure hashes).
     *
     * Register each host's variant with `addClient({ workflowAffinity: [variant] })`.
     * This picks the variant whose registered clients include an idle host right
     * now (highest effective priority wins); if none are idle, it enqueues the
     * first variant that has capable clients so the job runs when one of its hosts
     * frees. Routing then goes through {@link submitJob}, so the usual
     * queueing / failover / retry / monitoring all apply.
     *
     * Note: once enqueued in the no-idle-host case, a job commits to its chosen
     * variant's hosts; it is NOT re-routed to a different variant if another
     * variant's host frees first. For batch/backfill workloads (submitting many
     * logical jobs) each call lands on a currently-idle host, which spreads work
     * across a heterogeneous pool.
     */
    submitToVariants(variants: Workflow<any>[], options?: SubmitJobOptions): Promise<string>;
    getJobStatus(jobId: string): import("./interfaces.js").JobStatus;
    cancelJob(jobId: string): Promise<void>;
    attachEventHook(event: string, listener: (e: PoolEvent) => void): void;
    detachEventHook(event: string, listener: (e: PoolEvent) => void): void;
    /**
     * Emit a pool event (for internal components like registries)
     */
    emitEvent(event: PoolEvent): void;
    /**
     * Re-trigger the queues a now-idle client is able to serve: its affinity
     * queues PLUS the shared "general" queue. Any idle client may pull a general
     * job — including clients registered without affinity (whose affinity set is
     * empty/undefined) — so the general queue must always be poked. Without it,
     * general-queue jobs submitted while every client was busy, and every job on
     * a no-affinity client, would never be pulled after the initial drain (the
     * only other re-trigger is a new submission).
     */
    private triggerQueuesForIdleClient;
    private assertQueue;
    private attachHandlersToClient;
    private printStatusSummary;
    waitForJobCompletion(jobId: string): Promise<JobResults>;
    attachJobProgressListener(jobId: string, progressListener: (progress: {
        value: number;
        max: number;
    }) => void): void;
    attachJobPreviewListener(jobId: string, previewListener: (preview: {
        blob: Blob;
        metadata: any;
    }) => void): void;
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
    }>;
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
    } | null;
    /**
     * Get all clients that have affinity for a specific workflow
     * @param workflow - The workflow to check affinity for
     * @returns Array of client URLs that can handle this workflow
     */
    getClientsForWorkflow(workflow: Workflow<any>): string[];
    /**
     * Get all idle clients currently available for work
     * @returns Array of idle client information
     */
    getIdleClients(): Array<{
        url: string;
        nodeName: string;
        priority?: number;
    }>;
    /**
     * Check if there are any clients available for a specific workflow
     * @param workflow - The workflow to check
     * @returns True if at least one client has affinity for this workflow
     */
    hasClientsForWorkflow(workflow: Workflow<any>): boolean;
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
    };
}
//# sourceMappingURL=multi-workflow-pool.d.ts.map