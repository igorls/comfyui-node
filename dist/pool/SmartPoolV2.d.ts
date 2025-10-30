import { TypedEventTarget } from "../typed-event-target.js";
import { ComfyApi } from "../client.js";
import { Workflow } from "../workflow.js";
import type { WorkflowAffinity } from "./types/affinity.js";
import type { JobId, JobRecord } from "./types/job.js";
interface SmartPoolV2Options {
    connectionTimeoutMs?: number;
    jobExecutionTimeoutMs?: number;
    groupIdleTimeoutMs?: number;
    maxQueueDepth?: number;
}
interface ServerPerformanceMetrics {
    clientId: string;
    totalJobsCompleted: number;
    totalExecutionTimeMs: number;
    averageExecutionTimeMs: number;
    lastJobDurationMs?: number;
}
interface SmartPoolV2EventMap extends Record<string, CustomEvent<any>> {
    "job:queued": CustomEvent<{
        job: JobRecord;
    }>;
    "job:accepted": CustomEvent<{
        job: JobRecord;
        clientId: string;
    }>;
    "job:started": CustomEvent<{
        job: JobRecord;
        clientId: string;
        promptId: string;
    }>;
    "job:completed": CustomEvent<{
        job: JobRecord;
    }>;
    "job:failed": CustomEvent<{
        job: JobRecord;
        error: Error;
        willRetry?: boolean;
    }>;
    "group:idle-timeout": CustomEvent<{
        groupId: string;
        reason: string;
    }>;
    "server:idle": CustomEvent<{
        clientId: string;
        groupId?: string;
    }>;
}
export declare class SmartPoolV2 extends TypedEventTarget<SmartPoolV2EventMap> {
    private clientMap;
    private affinityGroups;
    private defaultQueue?;
    private jobStore;
    private executionContexts;
    private idleServers;
    private serverPerformance;
    private options;
    private isReady;
    private readyResolve?;
    constructor(clients: (ComfyApi | string)[], options?: SmartPoolV2Options);
    /**
     * Initialize pool and connect all clients
     */
    connect(): Promise<void>;
    /**
     * Wait for pool to be ready
     */
    ready(): Promise<void>;
    /**
     * Enqueue a workflow - automatically routed by workflow hash
     * Optional preferredClientIds overrides default routing for this specific job
     */
    enqueue(workflow: Workflow<any>, options?: {
        preferredClientIds?: string[];
        priority?: number;
        metadata?: Record<string, any>;
    }): Promise<JobId>;
    /**
     * Set workflow affinity - auto-creates group by workflow hash
     * Maps workflow hash to preferred servers
     */
    setAffinity(workflow: object, affinity: Omit<WorkflowAffinity, "workflowHash">): void;
    /**
     * Get job by ID
     */
    getJob(jobId: JobId): JobRecord | undefined;
    /**
     * Shutdown pool
     */
    shutdown(): void;
    /**
     * Get server performance metrics
     */
    getServerPerformance(clientId: string): ServerPerformanceMetrics | undefined;
    private createAffinityGroup;
    /**
     * Process affinity group queue - triggered by events only (no polling)
     */
    private processAffinityGroup;
    /**
     * Enqueue job on server and manage execution
     */
    private enqueueJobOnServer;
    /**
     * Handle job completion
     */
    private handleJobCompletion;
    /**
     * Handle job failure
     */
    private handleJobFailure;
    /**
     * Handle job timeout
     */
    private handleJobTimeout;
    private updateServerPerformance;
    private sortServersByPerformance;
}
export {};
//# sourceMappingURL=SmartPoolV2.d.ts.map