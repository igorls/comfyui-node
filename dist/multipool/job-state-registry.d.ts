import { JobResults, JobState, JobStatus } from "./interfaces.js";
import { MultiWorkflowPool } from "./multi-workflow-pool.js";
import { ClientRegistry } from "./client-registry.js";
import { Workflow } from "./workflow.js";
import { ImageInfo } from "../types/api.js";
export declare class JobStateRegistry {
    pool: MultiWorkflowPool;
    clients: ClientRegistry;
    jobs: Map<string, JobState>;
    promptIdToJobId: Map<string, string>;
    constructor(pool: MultiWorkflowPool, clients: ClientRegistry);
    addJob(workflow: Workflow): string;
    getJobStatus(jobId: string): JobStatus;
    cancelJob(jobId: string): Promise<void>;
    setJobStatus(jobId: string, newStatus: JobStatus, assignedClientUrl?: string): void;
    updateJobAutoSeeds(jobId: string, autoSeeds: Record<string, number>): void;
    setPromptId(jobId: string, prompt_id: string): void;
    completeJob(prompt_id: string): void;
    private processQueue;
    waitForResults(jobId: string): Promise<JobResults>;
    addJobImages(prompt_id: string, images: ImageInfo[]): void;
    private removeJobFromQueue;
    attachJobProgressListener(jobId: string, progressListener: (progress: {
        value: number;
        max: number;
    }) => void): void;
    attachJobPreviewListener(jobId: string, previewListener: (preview: {
        metadata: any;
        blob: Blob;
    }) => void): void;
    updateJobProgress(prompt_id: string, value: number, max: number, nodeId?: string | number): void;
    updateJobPreviewMetadata(prompt_id: any, metadata: any, blob: Blob): void;
    setJobFailure(jobId: string, bodyJSON: any): void;
    /**
     * Track node execution start for profiling
     */
    onNodeExecuting(prompt_id: string, nodeId: string): void;
    /**
     * Track cached nodes for profiling
     */
    onCachedNodes(prompt_id: string, nodeIds: string[]): void;
}
//# sourceMappingURL=job-state-registry.d.ts.map