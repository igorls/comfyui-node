import { JobRecord, WorkflowPool } from "../../src/index.ts";

export function waitForJob(pool: WorkflowPool, jobId: string): Promise<JobRecord> {
  const job = pool.getJob(jobId);
  if (job) {
    if (job.status === "completed") {
      return Promise.resolve(job);
    }
    if (job.status === "failed" || job.status === "cancelled") {
      return Promise.reject(job);
    }
  }

  return new Promise((resolve, reject) => {
    const completedListener = (e: CustomEvent<{ job: JobRecord }>) => {
      try {
        const job = e.detail.job as any;
        if (job.id === jobId || job.jobId === jobId) {
          cleanUp();
          resolve(e.detail.job);
        }
      } catch (error) {
        console.error("Error in job:completed listener:", error);
      }
    };
    const failedListener = (e: CustomEvent<{ job: JobRecord; willRetry: boolean }>) => {
      try {
        const job = e.detail.job as any;
        if ((job.id === jobId || job.jobId === jobId) && !e.detail.willRetry) {
          cleanUp();
          reject(e.detail.job);
        }
      } catch (error) {
        console.error("Error in job:failed listener:", error);
      }
    };
    const cancelledListener = (e: CustomEvent<{ job: JobRecord }>) => {
      try {
        const job = e.detail.job as any;
        if (job.id === jobId || job.jobId === jobId) {
          cleanUp();
          reject(e.detail.job);
        }
      } catch (error) {
        console.error("Error in job:cancelled listener:", error);
      }
    };
    const cleanUp = () => {
      pool.removeEventListener("job:completed", completedListener as any);
      pool.removeEventListener("job:failed", failedListener as any);
      pool.removeEventListener("job:cancelled", cancelledListener as any);
    };
    pool.addEventListener("job:completed", completedListener as any);
    pool.addEventListener("job:failed", failedListener as any);
    pool.addEventListener("job:cancelled", cancelledListener as any);
  });
}
