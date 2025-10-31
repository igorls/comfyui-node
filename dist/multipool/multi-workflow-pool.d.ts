import { JobResults } from "./job-state-registry.js";
import { JobQueueProcessor } from "./job-queue-processor.js";
import { Workflow } from "./workflow.js";
import { MultiWorkflowPoolOptions, PoolEvent } from "./interfaces.js";
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
    private options;
    private logger;
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
    getJobStatus(jobId: string): import("./job-state-registry.js").JobStatus;
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
}
//# sourceMappingURL=multi-workflow-pool.d.ts.map