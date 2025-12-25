import { ImageInfo } from "../types/api.js";
import { ComfyApi } from "../client.js";
import { Workflow } from "./workflow.js";
import { JobProfiler } from "./job-profiler.js";
/**
 * Pool event emitted through PoolEventManager
 * All ComfyUI client events are forwarded with the prefix "client:"
 */
export interface PoolEvent {
    type: string;
    payload: any;
}
/**
 * Client event payload forwarded from ComfyUI WebSocket events
 */
export interface ClientEventPayload {
    /** URL of the client that emitted the event */
    clientUrl: string;
    /** Node name of the client */
    clientName: string;
    /** Original ComfyUI event type (status, progress, executing, etc.) */
    eventType: string;
    /** Original event data from ComfyUI */
    eventData: any;
}
export interface MultiWorkflowPoolOptions {
    connectionTimeoutMs?: number;
    enableMonitoring?: boolean;
    monitoringIntervalMs?: number;
    enableProfiling?: boolean;
}
export type ClientState = "idle" | "busy" | "offline";
export interface EnhancedClient {
    url: string;
    state: ClientState;
    nodeName: string;
    priority?: number;
    api: ComfyApi;
    workflowAffinity?: Set<string>;
}
export interface NodeExecutionProfile {
    /** Node ID */
    nodeId: string;
    /** Node class type (e.g., KSampler, VAELoader) */
    type?: string;
    /** Node title/label */
    title?: string;
    /** Timestamp when node started executing (ms since epoch) */
    startedAt?: number;
    /** Timestamp when node completed (ms since epoch) */
    completedAt?: number;
    /** Execution duration in milliseconds */
    duration?: number;
    /** Progress events captured for this node */
    progressEvents?: Array<{
        timestamp: number;
        value: number;
        max: number;
    }>;
    /** Whether this node was cached (instant execution) */
    cached: boolean;
    /** Execution status */
    status: 'pending' | 'executing' | 'completed' | 'cached' | 'failed';
    /** Error message if failed */
    error?: string;
}
export interface JobProfileStats {
    /** Prompt ID from ComfyUI */
    promptId?: string;
    /** Total execution time from queue to completion (ms) */
    totalDuration: number;
    /** Time spent in queue before execution started (ms) */
    queueTime: number;
    /** Actual execution time (ms) */
    executionTime: number;
    /** Timestamp when job was queued */
    queuedAt: number;
    /** Timestamp when execution started */
    startedAt?: number;
    /** Timestamp when execution completed */
    completedAt: number;
    /** Per-node execution profiles */
    nodes: NodeExecutionProfile[];
    /** Execution timeline summary */
    summary: {
        /** Total number of nodes in workflow */
        totalNodes: number;
        /** Number of nodes actually executed */
        executedNodes: number;
        /** Number of cached nodes */
        cachedNodes: number;
        /** Number of failed nodes */
        failedNodes: number;
        /** Slowest nodes (top 5) */
        slowestNodes: Array<{
            nodeId: string;
            type?: string;
            title?: string;
            duration: number;
        }>;
        /** Nodes that emitted progress events */
        progressNodes: string[];
    };
}
/**
 * Options for submitting a job to the pool
 */
export interface SubmitJobOptions {
    /**
     * Per-client priority overrides for this job submission.
     * Key: client URL, Value: priority number (higher = more preferred)
     * These overrides take precedence over the static priorities set at addClient() time.
     */
    priorityOverrides?: Map<string, number> | Record<string, number>;
}
export interface QueueJob {
    jobId: string;
    workflow: Workflow;
    attempts: number;
    /** Priority overrides for client selection */
    priorityOverrides?: Map<string, number>;
}
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
    /** Encrypted images captured from EncryptedSaveImage nodes via WebSocket */
    encryptedImages?: Array<{
        encrypted_base64: string;
        index?: number;
        saved_path?: string | null;
    }>;
    onProgress?: (progress: any) => void;
    onPreview?: (preview: any) => void;
    profiler?: JobProfiler;
}
export interface JobResults {
    status: JobResultStatus;
    jobId: string;
    prompt_id: string;
    images: string[];
    /** Encrypted images from EncryptedSaveImage nodes (WebSocket delivery) */
    encryptedImages?: Array<{
        encrypted_base64: string;
        index?: number;
        saved_path?: string | null;
    }>;
    error?: any;
    profileStats?: JobProfileStats;
}
//# sourceMappingURL=interfaces.d.ts.map