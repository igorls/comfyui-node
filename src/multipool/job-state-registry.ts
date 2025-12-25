import { randomUUID } from "node:crypto";
import { JobProfiler } from "./job-profiler.js";
import { JobResults, JobState, JobStatus } from "./interfaces.js";
import { MultiWorkflowPool } from "./multi-workflow-pool.js";
import { ClientRegistry } from "./client-registry.js";
import { Workflow } from "./workflow.js";
import { ImageInfo } from "../types/api.js";

export class JobStateRegistry {

  pool: MultiWorkflowPool;
  clients: ClientRegistry;

  // Map of jobId to JobState
  jobs: Map<string, JobState> = new Map();

  // Map of prompt_id to jobId
  promptIdToJobId: Map<string, string> = new Map();

  constructor(pool: MultiWorkflowPool, clients: ClientRegistry) {
    this.pool = pool;
    this.clients = clients;
  }

  addJob(workflow: Workflow): string {
    // Create new job id
    const jobId = randomUUID();
    let resolver: ((results: JobResults) => void) | null = null;
    const resultsPromise = new Promise<JobResults>((resolve) => {
      resolver = resolve;
    });
    const jobState: JobState = {
      jobId,
      workflow,
      status: "pending",
      resolver,
      resultsPromise
    };

    // Initialize profiler if enabled
    if (this.pool.options.enableProfiling) {
      jobState.profiler = new JobProfiler(Date.now(), workflow.toJSON());
    }

    this.jobs.set(jobId, jobState);
    return jobId;
  }

  getJobStatus(jobId: string): JobStatus {
    const jobState = this.jobs.get(jobId);
    if (!jobState) {
      throw new Error(`Job with ID ${jobId} not found.`);
    }
    return jobState.status;
  }

  async cancelJob(jobId: string) {
    const jobState = this.jobs.get(jobId);
    if (!jobState) {
      throw new Error(`Job with ID ${jobId} not found.`);
    }
    if (jobState.status === "completed" || jobState.status === "canceled") {
      throw new Error(`Cannot cancel job ${jobId} with status ${jobState.status}.`);
    }

    if (jobState.status === "assigned" || jobState.status === "running") {
      // Notify assigned client to cancel the job
      if (jobState.assignedClientUrl) {
        const client = this.clients.clients.get(jobState.assignedClientUrl);
        if (client) {
          try {

            await client.api.ext.queue.interrupt(jobState.prompt_id);

            // Mark job as canceled
            jobState.status = "canceled";

            // Mark client as idle
            client.state = "idle";

            // Also resolve the promise to avoid hanging
            if (jobState.resolver) {
              const results: JobResults = {
                status: "canceled",
                jobId: jobState.jobId,
                prompt_id: jobState.prompt_id!,
                images: []
              };
              jobState.resolver(results);
              jobState.resolver = null;
            }

            // Process the queue to allow next job to proceed
            this.processQueue(jobState.workflow.structureHash);

          } catch (e) {
            console.error(`Failed to notify client ${jobState.assignedClientUrl} to cancel job ${jobId}:`, e);
          }
        }
      }
    } else {
      // For pending or no_clients status, just mark as canceled
      jobState.status = "canceled";

      // Also resolve the promise to avoid hanging
      if (jobState.resolver) {
        const results: JobResults = {
          status: "canceled",
          jobId: jobState.jobId,
          prompt_id: jobState.prompt_id!,
          images: []
        };
        jobState.resolver(results);
        jobState.resolver = null;
      }

      // Remove from queue if necessary
      this.removeJobFromQueue(jobState);
    }
  }

  setJobStatus(jobId: string, newStatus: JobStatus, assignedClientUrl?: string) {
    const jobState = this.jobs.get(jobId);
    if (!jobState) {
      throw new Error(`Job with ID ${jobId} not found.`);
    }
    jobState.status = newStatus as JobStatus;
    if (assignedClientUrl) {
      jobState.assignedClientUrl = assignedClientUrl;
    }
  }

  updateJobAutoSeeds(jobId: string, autoSeeds: Record<string, number>) {
    const jobState = this.jobs.get(jobId);
    if (!jobState) {
      throw new Error(`Job with ID ${jobId} not found.`);
    }
    jobState.autoSeeds = autoSeeds;
  }

  setPromptId(jobId: string, prompt_id: string) {
    const jobState = this.jobs.get(jobId);
    if (!jobState) {
      throw new Error(`Job with ID ${jobId} not found.`);
    }
    jobState.prompt_id = prompt_id;
    this.promptIdToJobId.set(prompt_id, jobId);

    // Notify profiler of execution start
    if (jobState.profiler) {
      jobState.profiler.onExecutionStart(prompt_id);
    }
  }

  completeJob(prompt_id: string) {
    const jobState = this.jobs.get(this.promptIdToJobId.get(prompt_id) || "");
    if (!jobState || !jobState.prompt_id) {
      throw new Error(`No job state found for prompt_id ${prompt_id} when completing job.`);
    }
    if (jobState.prompt_id === prompt_id) {
      jobState.status = "completed";

      // Notify profiler of completion
      if (jobState.profiler) {
        jobState.profiler.onExecutionComplete();
      }

      if (jobState.resolver) {
        const results: JobResults = {
          status: "completed",
          jobId: jobState.jobId,
          prompt_id: jobState.prompt_id!,
          images: []
        };

        // Prepare images
        if (jobState.images && jobState.images.length > 0 && jobState.assignedClientUrl) {
          const client = this.clients.clients.get(jobState.assignedClientUrl);
          if (client) {
            for (let i = 0; i < jobState.images.length; i++) {
              const image = jobState.images[i];
              const imageUrl = client.api.ext.file.getPathImage(image);
              results.images.push(imageUrl);
            }
          }
        }

        // Include encrypted images captured via WebSocket (avoids slow history fetch)
        if (jobState.encryptedImages && jobState.encryptedImages.length > 0) {
          results.encryptedImages = jobState.encryptedImages;
        }

        // Add profiler stats if available
        if (jobState.profiler) {
          results.profileStats = jobState.profiler.getStats();
        }

        jobState.resolver(results);
        jobState.resolver = null;
      }
    }
  }

  private processQueue(structureHash: string | undefined) {
    let queue = this.pool.queues.get(structureHash || "general");
    if (queue) {
      queue.processQueue().catch(reason => {
        console.error(`Error processing job queue for workflow hash ${structureHash}:`, reason);
      });
    }
  }

  async waitForResults(jobId: string): Promise<JobResults> {
    const jobState = this.jobs.get(jobId);
    if (!jobState) {
      throw new Error(`Job with ID ${jobId} not found.`);
    }
    if (!jobState.resultsPromise) {
      throw new Error(`Job with ID ${jobId} does not have a results promise.`);
    }
    return jobState.resultsPromise;
  }

  addJobImages(prompt_id: string, images: ImageInfo[]) {
    const state = this.jobs.get(this.promptIdToJobId.get(prompt_id) || "");
    if (!state) {
      throw new Error(`No job state found for prompt_id ${prompt_id} when adding images.`);
    }
    if (state.prompt_id === prompt_id) {
      state.images = [...images];
      return;
    }
  }

  /**
   * Store encrypted images from EncryptedSaveImage nodes captured via WebSocket.
   * This enables direct delivery without fetching from /history API.
   */
  addJobEncryptedImages(prompt_id: string, encryptedImages: Array<{ encrypted_base64: string; index?: number; saved_path?: string | null }>) {
    const state = this.jobs.get(this.promptIdToJobId.get(prompt_id) || "");
    if (!state) {
      console.warn(`No job state found for prompt_id ${prompt_id} when adding encrypted images.`);
      return;
    }
    if (state.prompt_id === prompt_id) {
      // Append to existing encrypted images (multiple nodes may emit)
      if (!state.encryptedImages) {
        state.encryptedImages = [];
      }
      state.encryptedImages.push(...encryptedImages);
    }
  }

  private removeJobFromQueue(jobState: JobState) {
    let queue = this.pool.queues.get(jobState.workflow.structureHash || "general");
    if (queue) {
      queue.dequeueJob(jobState.jobId);
    }
  }

  attachJobProgressListener(jobId: string, progressListener: (progress: {
    value: number;
    max: number;
  }) => void) {
    const jobState = this.jobs.get(jobId);
    if (!jobState) {
      throw new Error(`Job with ID ${jobId} not found.`);
    }
    jobState.onProgress = progressListener;
  }

  attachJobPreviewListener(jobId: string, previewListener: (preview: {
    metadata: any;
    blob: Blob;
  }) => void) {
    const jobState = this.jobs.get(jobId);
    if (!jobState) {
      throw new Error(`Job with ID ${jobId} not found.`);
    }
    jobState.onPreview = previewListener;
  }

  updateJobProgress(prompt_id: string, value: number, max: number, nodeId?: string | number) {
    const state = this.jobs.get(this.promptIdToJobId.get(prompt_id) || "");
    if (!state) {
      console.warn(`No job state found for prompt_id ${prompt_id} when updating progress.`);
      return;
    }
    if (state.onProgress && state.prompt_id === prompt_id) {
      state.onProgress({ value, max });
    }

    // Notify profiler
    if (state.profiler && nodeId !== undefined) {
      state.profiler.onProgress(nodeId, value, max);
    }
  }

  updateJobPreviewMetadata(prompt_id: any, metadata: any, blob: Blob) {
    const state = this.jobs.get(this.promptIdToJobId.get(prompt_id) || "");
    if (!state) {
      console.warn(`No job state found for prompt_id ${prompt_id} when updating preview metadata.`);
      return;
    }
    if (state.onPreview && state.prompt_id === prompt_id) {
      state.onPreview({ metadata, blob });
    }
  }

  setJobFailure(jobId: string, bodyJSON: any) {
    const jobState = this.jobs.get(jobId);
    if (!jobState) {
      throw new Error(`Job with ID ${jobId} not found.`);
    }
    jobState.status = "failed";

    // Notify profiler of completion (even on failure)
    if (jobState.profiler) {
      jobState.profiler.onExecutionComplete();
    }

    if (jobState.resolver) {
      const results: JobResults = {
        status: "failed",
        jobId: jobState.jobId,
        prompt_id: jobState.prompt_id!,
        images: [],
        error: bodyJSON
      };

      // Add profiler stats even on failure
      if (jobState.profiler) {
        results.profileStats = jobState.profiler.getStats();
      }

      jobState.resolver(results);
      jobState.resolver = null;
    }
  }

  /**
   * Track node execution start for profiling
   */
  onNodeExecuting(prompt_id: string, nodeId: string) {
    const state = this.jobs.get(this.promptIdToJobId.get(prompt_id) || "");
    if (state?.profiler && state.prompt_id === prompt_id) {
      state.profiler.onNodeExecuting(nodeId);
    }
  }

  /**
   * Track cached nodes for profiling
   */
  onCachedNodes(prompt_id: string, nodeIds: string[]) {
    const state = this.jobs.get(this.promptIdToJobId.get(prompt_id) || "");
    if (state?.profiler && state.prompt_id === prompt_id) {
      state.profiler.onCachedNodes(nodeIds);
    }
  }
}