import { WorkflowAffinity } from "./types/affinity.js";
import { JobId, JobRecord } from "./types/job.js";
import { ComfyApi } from "src/client.js";
import { Workflow } from "src/workflow.js";
import { TypedEventTarget } from "src/typed-event-target.js";
interface SmartPoolOptions {
    connectionTimeoutMs: number;
}
interface PoolEvent {
    type: string;
    promptId: string;
    clientId: string;
    workflowHash: string;
    data?: any;
}
interface ClientQueueState {
    queuedJobs: number;
    runningJobs: number;
}
interface SmartPoolEventMap extends Record<string, CustomEvent<any>> {
    "job:queued": CustomEvent<{
        job: JobRecord;
    }>;
    "job:accepted": CustomEvent<{
        job: JobRecord;
    }>;
    "job:started": CustomEvent<{
        job: JobRecord;
    }>;
    "job:completed": CustomEvent<{
        job: JobRecord;
    }>;
    "job:failed": CustomEvent<{
        job: JobRecord;
        willRetry?: boolean;
    }>;
}
export declare class SmartPool extends TypedEventTarget<SmartPoolEventMap> {
    clientMap: Map<string, ComfyApi>;
    clientQueueStates: Map<string, ClientQueueState>;
    jobStore: Map<JobId, JobRecord>;
    affinities: Map<string, WorkflowAffinity>;
    private queueAdapter;
    private processingNextJob;
    private options;
    hooks: {
        any?: (event: PoolEvent) => void;
        [key: string]: ((event: PoolEvent) => void) | undefined;
    };
    constructor(clients: (ComfyApi | string)[], options?: Partial<SmartPoolOptions>);
    emitLegacy(event: PoolEvent): void;
    connect(): Promise<void>;
    shutdown(): void;
    syncQueueStates(): Promise<void>;
    addJob(jobId: JobId, jobRecord: JobRecord): void;
    getJob(jobId: JobId): JobRecord | undefined;
    removeJob(jobId: JobId): void;
    setAffinity(workflow: object, affinity: Omit<WorkflowAffinity, "workflowHash">): void;
    getAffinity(workflowHash: string): WorkflowAffinity | undefined;
    removeAffinity(workflowHash: string): void;
    /**
     * Enqueue a workflow for execution by the pool.
     * Auto-triggers processing via setImmediate (batteries included).
     */
    enqueue(workflow: Workflow<any>, opts?: {
        preferredClientIds?: string[];
        priority?: number;
    }): Promise<JobId>;
    /**
     * Entry point for queue processing with deduplication guard.
     * Prevents concurrent processing of jobs.
     * Poll-based approach: check idle servers, collect compatible jobs, enqueue only when slots available.
     */
    private processNextJobQueued;
    /**
     * Find servers that are currently idle (no running or pending jobs)
     */
    private findIdleServers;
    /**
     * Assign compatible jobs from our queue to idle servers
     * Returns number of jobs assigned
     */
    private assignJobsToIdleServers;
    /**
     * Check if a job is compatible with a server
     */
    private isJobCompatibleWithServer;
    /**
     * Enqueue a job on a specific server
     * Returns true if successful, false if failed
     */
    private enqueueJobOnServer;
    /**
     * Retrieve images from a completed job's execution.
     */
    getJobOutputImages(jobId: JobId, nodeId?: string): Promise<Array<{
        filename: string;
        blob: Blob;
    }>>;
    executeImmediate(workflow: Workflow<any>, opts: {
        preferableClientIds?: string[];
    }): Promise<any>;
    /**
     * Build the return value for executeImmediate() with images and blob.
     */
    private buildExecuteImmediateResult;
    private waitForExecutionCompletion;
}
export {};
//# sourceMappingURL=SmartPool.d.ts.map