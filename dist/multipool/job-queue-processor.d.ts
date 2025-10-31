import { MultiWorkflowPool } from "src/multipool/multi-workflow-pool.js";
import { Workflow } from "src/multipool/workflow.js";
export declare class JobQueueProcessor {
    pool: MultiWorkflowPool;
    queue: Array<{
        jobId: string;
        workflow: Workflow;
    }>;
    constructor(pool: MultiWorkflowPool);
    enqueueJob(newJobId: string, workflow: Workflow): void;
}
//# sourceMappingURL=job-queue-processor.d.ts.map