import type { Workflow, WorkflowResult } from "../../workflow.js";
import type { JobProfileStats } from "../profiling/JobProfiler.js";
export type JobId = string;
export type WorkflowInput = Workflow | object | string | {
    toJSON(): object;
};
export interface WorkflowJobAttachment {
    nodeId: string;
    inputName: string;
    file: Blob | Buffer;
    filename?: string;
}
export interface WorkflowJobOptions {
    /** Optional priority (higher executes first). Defaults to 0. */
    priority?: number;
    /** Explicit job id to reuse. Random UUID generated when omitted. */
    jobId?: JobId;
    /** Maximum retry attempts across clients. Defaults to 3. */
    maxAttempts?: number;
    /** Milliseconds to wait before retrying a failed job. Defaults to 1000. */
    retryDelayMs?: number;
    /** Optional list of preferred client ids. */
    preferredClientIds?: string[];
    /** Optional list of client ids to exclude. */
    excludeClientIds?: string[];
    /** Arbitrary user metadata persisted alongside the job. */
    metadata?: Record<string, unknown>;
    /** Include node ids when collecting outputs from the workflow. */
    includeOutputs?: string[];
    /** File attachments for the workflow. */
    attachments?: WorkflowJobAttachment[];
    /**
     * Override timeout in milliseconds for execution to start after job is queued.
     * If not specified, uses pool's default executionStartTimeoutMs.
     */
    executionStartTimeoutMs?: number;
    /**
     * Override timeout in milliseconds for individual node execution.
     * If not specified, uses pool's default nodeExecutionTimeoutMs.
     */
    nodeExecutionTimeoutMs?: number;
}
export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export interface WorkflowJobPayload {
    jobId: JobId;
    workflow: object;
    workflowHash: string;
    options: Required<Pick<WorkflowJobOptions, "maxAttempts" | "retryDelayMs">> & Omit<WorkflowJobOptions, "maxAttempts" | "retryDelayMs" | "jobId" | "attachments">;
    attempts: number;
    enqueuedAt: number;
    /** Workflow metadata (outputAliases, outputNodeIds) preserved from Workflow instance */
    workflowMeta?: {
        outputNodeIds?: string[];
        outputAliases?: Record<string, string>;
    };
    /** Per-job timeout overrides */
    timeouts?: {
        executionStartTimeoutMs?: number;
        nodeExecutionTimeoutMs?: number;
    };
}
export interface JobRecord extends WorkflowJobPayload {
    attachments?: WorkflowJobAttachment[];
    status: JobStatus;
    lastError?: unknown;
    clientId?: string;
    promptId?: string;
    result?: WorkflowResult | Record<string, unknown>;
    startedAt?: number;
    completedAt?: number;
    /** Execution profiling stats (only present when profiling enabled) */
    profileStats?: JobProfileStats;
}
//# sourceMappingURL=job.d.ts.map