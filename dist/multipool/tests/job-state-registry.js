import { randomUUID } from "node:crypto";
export class JobStateRegistry {
    pool;
    jobs = new Map();
    constructor(pool) {
        this.pool = pool;
    }
    addJob(workflow) {
        // Create new job id
        const jobId = randomUUID();
        const jobState = {
            jobId,
            workflow,
            status: 'pending',
        };
        this.jobs.set(jobId, jobState);
        return jobId;
    }
    getJobStatus(jobId) {
    }
    cancelJob(jobId) {
    }
}
//# sourceMappingURL=job-state-registry.js.map