import type { Workflow, WorkflowResult } from "../../workflow.js";

export type JobId = string;

export type WorkflowInput = Workflow | object | string | { toJSON(): object };

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
}

export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface WorkflowJobPayload {
  jobId: JobId;
  workflow: object;
  workflowHash: string;
  options: Required<Pick<WorkflowJobOptions, "maxAttempts" | "retryDelayMs">> &
    Omit<WorkflowJobOptions, "maxAttempts" | "retryDelayMs" | "jobId" | "attachments">;
  attempts: number;
  enqueuedAt: number;
  /** Workflow metadata (outputAliases, outputNodeIds) preserved from Workflow instance */
  workflowMeta?: {
    outputNodeIds?: string[];
    outputAliases?: Record<string, string>;
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
}
