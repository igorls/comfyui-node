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
export class JobsFeature extends FeatureBase {
    constructor(client: ComfyApi) {
        super(client);
    }

    /**
     * Check if the Jobs API is supported by the connected ComfyUI server.
     * The Jobs API was introduced in ComfyUI v0.6.0.
     * 
     * @returns Promise resolving to true if supported, false otherwise
     */
    override async checkSupported(): Promise<boolean> {
        try {
            const response = await this.client.fetchApi("/api/jobs?limit=1");
            this.isSupported = response.ok;
            return this.isSupported;
        } catch {
            this.isSupported = false;
            return false;
        }
    }

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
    async getJobs(options: JobsListOptions = {}): Promise<JobsListResponse> {
        const params = new URLSearchParams();

        // Handle status filter (can be single value or array)
        if (options.status) {
            const statuses = Array.isArray(options.status) ? options.status : [options.status];
            params.set("status", statuses.join(","));
        }

        if (options.workflow_id) {
            params.set("workflow_id", options.workflow_id);
        }

        if (options.sort_by) {
            params.set("sort_by", options.sort_by);
        }

        if (options.sort_order) {
            params.set("sort_order", options.sort_order);
        }

        if (options.limit !== undefined) {
            params.set("limit", String(options.limit));
        }

        if (options.offset !== undefined) {
            params.set("offset", String(options.offset));
        }

        const queryString = params.toString();
        const url = queryString ? `/api/jobs?${queryString}` : "/api/jobs";

        const response = await this.client.fetchApi(url);

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: "Unknown error" }));
            throw new Error(`Failed to fetch jobs: ${error.error || response.statusText}`);
        }

        return response.json();
    }

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
    async getJob(jobId: string): Promise<Job | null> {
        const response = await this.client.fetchApi(`/api/jobs/${encodeURIComponent(jobId)}`);

        if (response.status === 404) {
            return null;
        }

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: "Unknown error" }));
            throw new Error(`Failed to fetch job: ${error.error || response.statusText}`);
        }

        return response.json();
    }

    /**
     * Get jobs filtered by a specific status.
     * Convenience method that wraps getJobs().
     * 
     * @param status - The status to filter by
     * @param limit - Maximum number of jobs to return (default 100)
     * @returns Promise resolving to array of jobs
     */
    async getJobsByStatus(status: JobStatus, limit = 100): Promise<Job[]> {
        const response = await this.getJobs({ status, limit });
        return response.jobs;
    }

    /**
     * Get currently running jobs.
     * Convenience method for getJobsByStatus(JobStatus.IN_PROGRESS).
     */
    async getRunningJobs(): Promise<Job[]> {
        return this.getJobsByStatus(JobStatus.IN_PROGRESS);
    }

    /**
     * Get pending (queued) jobs.
     * Convenience method for getJobsByStatus(JobStatus.PENDING).
     */
    async getPendingJobs(): Promise<Job[]> {
        return this.getJobsByStatus(JobStatus.PENDING);
    }

    /**
     * Get recently completed jobs.
     * 
     * @param limit - Maximum number of jobs to return (default 20)
     */
    async getCompletedJobs(limit = 20): Promise<Job[]> {
        return this.getJobsByStatus(JobStatus.COMPLETED, limit);
    }

    /**
     * Get recently failed jobs.
     * 
     * @param limit - Maximum number of jobs to return (default 20)
     */
    async getFailedJobs(limit = 20): Promise<Job[]> {
        return this.getJobsByStatus(JobStatus.FAILED, limit);
    }

    /**
     * Calculate execution duration for a completed job.
     * 
     * @param job - The job to calculate duration for
     * @returns Duration in milliseconds, or null if times are not available
     */
    getExecutionDuration(job: Job): number | null {
        if (job.execution_start_time && job.execution_end_time) {
            return job.execution_end_time - job.execution_start_time;
        }
        return null;
    }
}
