import { JobQueueProcessor } from "./job-queue-processor.js";
import { Workflow } from "./workflow.js";
import { MultiWorkflowPoolOptions, PoolEvent, JobResults } from "./interfaces.js";
/**
 * MultiWorkflowPool class to manage heterogeneous clusters of ComfyUI workers with different workflow capabilities.
 * Using a fully event driven architecture to handle client connections, job submissions, and failover strategies.
 * Zero polling is used; all operations are event driven. Maximizes responsiveness and scalability.
 */
export declare class MultiWorkflowPool {
    private events;
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
    }): void;
    removeClient(clientUrl: string): void;
    submitJob(workflow: Workflow<any>): Promise<string>;
    getJobStatus(jobId: string): import("./interfaces.js").JobStatus;
    cancelJob(jobId: string): Promise<void>;
    attachEventHook(event: string, listener: (e: PoolEvent) => void): void;
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