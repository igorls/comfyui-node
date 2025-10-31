import { MultiWorkflowPool } from "src/multipool/multi-workflow-pool.js";
import { Workflow } from "src/multipool/workflow.js";
import { ImageInfo } from "src/types/api.js";
import { ClientRegistry } from "src/multipool/client-registry.js";
export type JobStatus = "pending" | "assigned" | "running" | "completed" | "failed" | "canceled" | "no_clients";
export type JobResultStatus = "completed" | "failed" | "canceled";
export interface JobState {
    jobId: string;
    prompt_id?: string;
    assignedClientUrl?: string;
    workflow: Workflow;
    status: JobStatus;
    autoSeeds?: Record<string, number>;
    resolver: ((results: JobResults) => void) | null;
    resultsPromise?: Promise<JobResults>;
    images?: ImageInfo[];
    onProgress?: (progress: any) => void;
    onPreview?: (preview: any) => void;
}
export interface JobResults {
    status: JobResultStatus;
    jobId: string;
    prompt_id: string;
    images: string[];
    error?: any;
}
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
    updateJobProgress(prompt_id: string, value: number, max: number): void;
    updateJobPreviewMetadata(prompt_id: any, metadata: any, blob: Blob): void;
    setJobFailure(jobId: string, bodyJSON: any): void;
}
//# sourceMappingURL=job-state-registry.d.ts.map