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
import { JobProfileStats } from "./interfaces.js";
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