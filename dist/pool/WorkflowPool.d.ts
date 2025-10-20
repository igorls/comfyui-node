import { TypedEventTarget } from "../typed-event-target.js";
import type { ComfyApi } from "../client.js";
import type { QueueAdapter, QueueStats } from "./queue/QueueAdapter.js";
import type { FailoverStrategy } from "./failover/Strategy.js";
import type { JobRecord, WorkflowInput, WorkflowJobOptions, JobId } from "./types/job.js";
import type { WorkflowPoolEventMap } from "./types/events.js";
interface WorkflowPoolOpts {
    queueAdapter?: QueueAdapter;
    failoverStrategy?: FailoverStrategy;
    retryBackoffMs?: number;
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
    private applyAutoSeed;
    private processQueue;
    private runJob;
}
export {};
//# sourceMappingURL=WorkflowPool.d.ts.map