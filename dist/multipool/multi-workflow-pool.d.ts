import { Workflow } from "src/multipool/workflow.js";
import { PoolEvent } from "src/multipool/interfaces.js";
/**
 * MultiWorkflowPool class to manage heterogeneous clusters of ComfyUI workers with different workflow capabilities.
 * Using a fully event driven architecture to handle client connections, job submissions, and failover strategies.
 * Zero polling is used; all operations are event driven. Maximizes responsiveness and scalability.
 */
export declare class MultiWorkflowPool {
    private events;
    private clientRegistry;
    private jobRegistry;
    private queues;
    constructor();
    init(): Promise<void>;
    shutdown(): Promise<void>;
    addClient(clientUrl: string): void;
    removeClient(clientUrl: string): void;
    submitJob(workflow: Workflow): Promise<`${string}-${string}-${string}-${string}-${string}`>;
    getJobStatus(jobId: string): void;
    cancelJob(jobId: string): Promise<void>;
    attachEventHook(event: string, listener: (e: PoolEvent) => void): void;
    private assertQueue;
}
//# sourceMappingURL=multi-workflow-pool.d.ts.map