import { WorkflowAffinity } from "./types/affinity.js";
import { JobId, JobRecord } from "./types/job.js";
import { ComfyApi } from "src/client.js";
import { Workflow } from "src/workflow.js";
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
export declare class SmartPool {
    clientMap: Map<string, ComfyApi>;
    clientQueueStates: Map<string, ClientQueueState>;
    jobStore: Map<JobId, JobRecord>;
    affinities: Map<string, WorkflowAffinity>;
    private options;
    hooks: {
        any?: (event: PoolEvent) => void;
        [key: string]: ((event: PoolEvent) => void) | undefined;
    };
    constructor(clients: (ComfyApi | string)[], options?: Partial<SmartPoolOptions>);
    emit(event: PoolEvent): void;
    connect(): Promise<void>;
    shutdown(): void;
    syncQueueStates(): Promise<void>;
    addJob(jobId: JobId, jobRecord: JobRecord): void;
    getJob(jobId: JobId): JobRecord | undefined;
    removeJob(jobId: JobId): void;
    setAffinity(workflow: object, affinity: Omit<WorkflowAffinity, "workflowHash">): void;
    getAffinity(workflowHash: string): WorkflowAffinity | undefined;
    removeAffinity(workflowHash: string): void;
    executeImmediate(workflow: Workflow<any>, opts: {
        preferableClientIds?: string[];
    }): Promise<any>;
    private waitForExecutionCompletion;
}
export {};
//# sourceMappingURL=SmartPool.d.ts.map