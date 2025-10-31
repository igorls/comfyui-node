import { Workflow } from "./workflow.js";
import { JobStateRegistry } from "./job-state-registry.js";
import { ClientRegistry } from "./client-registry.js";
import { Logger } from "./logger.js";
import { QueueJob } from "./interfaces.js";
export declare class JobQueueProcessor {
    private jobs;
    private clientRegistry;
    private logger;
    queue: Array<QueueJob>;
    workflowHash: string;
    isProcessing: boolean;
    maxAttempts: number;
    constructor(stateRegistry: JobStateRegistry, clientRegistry: ClientRegistry, workflowHash: string, logger: Logger);
    enqueueJob(newJobId: string, workflow: Workflow): Promise<void>;
    processQueue(): Promise<void>;
    private applyAutoSeed;
    private runJobOnClient;
    dequeueJob(jobId: string): void;
    private handleFailure;
    private retryOrMarkFailed;
    private processAttachedMedia;
}
//# sourceMappingURL=job-queue-processor.d.ts.map