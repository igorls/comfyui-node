import { MultiWorkflowPool } from "src/multipool/multi-workflow-pool.js";
import { Workflow } from "src/multipool/workflow.js";
interface JobState {
    jobId: string;
    workflow: Workflow;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'canceled';
}
export declare class JobStateRegistry {
    pool: MultiWorkflowPool;
    jobs: Map<string, JobState>;
    constructor(pool: MultiWorkflowPool);
    addJob(workflow: Workflow): `${string}-${string}-${string}-${string}-${string}`;
    getJobStatus(jobId: string): void;
    cancelJob(jobId: string): void;
}
export {};
//# sourceMappingURL=job-state-registry.d.ts.map