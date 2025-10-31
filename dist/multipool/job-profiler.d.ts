/**
 * Job Profiler for MultiWorkflowPool - Automatic per-node execution profiling
 * ===========================================================================
 *
 * Captures detailed execution metrics for workflow jobs automatically:
 * - Per-node execution timing
 * - Progress tracking for nodes that emit progress events
 * - Execution order and dependencies
 * - Node types and metadata
 *
 * Usage:
 * ```ts
 * const pool = new MultiWorkflowPool({ enableProfiling: true });
 * const jobId = await pool.submitJob(workflow);
 *
 * const results = await pool.waitForJobCompletion(jobId);
 * console.log(results.profileStats);
 * ```
 */
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
 * JobProfiler tracks execution metrics for a single workflow job.
 */
export declare class JobProfiler {
    private queuedAt;
    private startedAt?;
    private completedAt?;
    private promptId?;
    private nodeProfiles;
    private lastExecutingNode;
    constructor(queuedAt: number, workflowJson?: Record<string, any>);
    /**
     * Record execution start event
     */
    onExecutionStart(promptId: string): void;
    /**
     * Record cached nodes
     */
    onCachedNodes(nodeIds: string[]): void;
    /**
     * Record node execution start
     */
    onNodeExecuting(nodeId: string): void;
    /**
     * Record node completion (when next node starts or execution ends)
     */
    private completeNode;
    /**
     * Record execution end (node: null event)
     */
    onExecutionComplete(): void;
    /**
     * Record progress event for a node
     */
    onProgress(nodeId: string | number, value: number, max: number): void;
    /**
     * Record node execution error
     */
    onNodeError(nodeId: string, error: string): void;
    /**
     * Generate final profile statistics
     */
    getStats(): JobProfileStats;
}
//# sourceMappingURL=job-profiler.d.ts.map