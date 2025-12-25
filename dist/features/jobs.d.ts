import { ComfyApi } from "../client.js";
import { Job, JobsListOptions, JobsListResponse, JobStatus } from "../types/api.js";
import { FeatureBase } from "./base.js";
/**
 * Jobs API feature for unified job management (ComfyUI v0.6.0+).
 *
 * Provides access to the unified `/api/jobs` endpoints which offer:
 * - Consistent job representation across all states (pending, in_progress, completed, failed)
 * - Filtering by status and workflow ID
 * - Sorting by creation time or execution duration
 * - Pagination support
 * - Summary fields for efficient list views
 *
 * @example
 * ```typescript
 * const api = new ComfyApi("http://localhost:8188");
 * await api.init();
 *
 * // List recent completed jobs
 * const { jobs, pagination } = await api.ext.jobs.getJobs({
 *   status: JobStatus.COMPLETED,
 *   limit: 10,
 *   sort_order: "desc"
 * });
 *
 * // Get specific job details
 * const job = await api.ext.jobs.getJob("prompt-id-here");
 * ```
 *
 * @since ComfyUI v0.6.0
 */
export declare class JobsFeature extends FeatureBase {
    constructor(client: ComfyApi);
    /**
     * Check if the Jobs API is supported by the connected ComfyUI server.
     * The Jobs API was introduced in ComfyUI v0.6.0.
     *
     * @returns Promise resolving to true if supported, false otherwise
     */
    checkSupported(): Promise<boolean>;
    /**
     * List all jobs with optional filtering, sorting, and pagination.
     *
     * @param options - Query options for filtering and pagination
     * @returns Promise resolving to jobs list with pagination info
     *
     * @example
     * ```typescript
     * // Get all pending and in-progress jobs
     * const { jobs } = await api.ext.jobs.getJobs({
     *   status: [JobStatus.PENDING, JobStatus.IN_PROGRESS]
     * });
     *
     * // Get paginated completed jobs sorted by execution time
     * const { jobs, pagination } = await api.ext.jobs.getJobs({
     *   status: JobStatus.COMPLETED,
     *   sort_by: "execution_duration",
     *   sort_order: "desc",
     *   limit: 20,
     *   offset: 0
     * });
     *
     * // Iterate through pages
     * while (pagination.has_more) {
     *   const next = await api.ext.jobs.getJobs({
     *     limit: 20,
     *     offset: pagination.offset + jobs.length
     *   });
     *   // process next.jobs...
     * }
     * ```
     */
    getJobs(options?: JobsListOptions): Promise<JobsListResponse>;
    /**
     * Get a single job by its ID with full details including outputs.
     *
     * @param jobId - The job/prompt ID to retrieve
     * @returns Promise resolving to the job details, or null if not found
     *
     * @example
     * ```typescript
     * const job = await api.ext.jobs.getJob("abc-123-def");
     * if (job) {
     *   console.log(`Job ${job.id}: ${job.status}`);
     *   if (job.status === JobStatus.COMPLETED) {
     *     console.log(`Outputs: ${job.outputs_count}`);
     *     console.log(`Duration: ${job.execution_end_time - job.execution_start_time}ms`);
     *   }
     * }
     * ```
     */
    getJob(jobId: string): Promise<Job | null>;
    /**
     * Get jobs filtered by a specific status.
     * Convenience method that wraps getJobs().
     *
     * @param status - The status to filter by
     * @param limit - Maximum number of jobs to return (default 100)
     * @returns Promise resolving to array of jobs
     */
    getJobsByStatus(status: JobStatus, limit?: number): Promise<Job[]>;
    /**
     * Get currently running jobs.
     * Convenience method for getJobsByStatus(JobStatus.IN_PROGRESS).
     */
    getRunningJobs(): Promise<Job[]>;
    /**
     * Get pending (queued) jobs.
     * Convenience method for getJobsByStatus(JobStatus.PENDING).
     */
    getPendingJobs(): Promise<Job[]>;
    /**
     * Get recently completed jobs.
     *
     * @param limit - Maximum number of jobs to return (default 20)
     */
    getCompletedJobs(limit?: number): Promise<Job[]>;
    /**
     * Get recently failed jobs.
     *
     * @param limit - Maximum number of jobs to return (default 20)
     */
    getFailedJobs(limit?: number): Promise<Job[]>;
    /**
     * Calculate execution duration for a completed job.
     *
     * @param job - The job to calculate duration for
     * @returns Duration in milliseconds, or null if times are not available
     */
    getExecutionDuration(job: Job): number | null;
}
//# sourceMappingURL=jobs.d.ts.map