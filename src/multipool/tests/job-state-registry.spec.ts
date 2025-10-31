import { describe, it, expect, beforeEach, jest } from "bun:test";
import { JobStateRegistry } from "../job-state-registry.js";
import { MultiWorkflowPool } from "../multi-workflow-pool.js";
import { ClientRegistry } from "../client-registry.js";
import { Workflow } from "../workflow.js";
import { Logger } from "../logger.js";

describe("JobStateRegistry", () => {
  let jobRegistry: JobStateRegistry;
  let poolMock: MultiWorkflowPool;
  let clientRegistryMock: ClientRegistry;
  let loggerMock: Logger;

  beforeEach(() => {
    // Mock MultiWorkflowPool
    poolMock = {
      options: { enableProfiling: false },
      queues: new Map(),
    } as any;

    loggerMock = new Logger("test", "silent");

    // Mock ClientRegistry
    clientRegistryMock = new ClientRegistry(poolMock, loggerMock);

    // Initialize JobStateRegistry
    jobRegistry = new JobStateRegistry(poolMock, clientRegistryMock);
  });

  it("should add a new job with a pending status", () => {
    const workflow = new Workflow({});
    const jobId = jobRegistry.addJob(workflow);

    expect(jobId).toBeString();
    expect(jobRegistry.getJobStatus(jobId)).toBe("pending");
    const jobState = jobRegistry.jobs.get(jobId);
    expect(jobState).toBeDefined();
    expect(jobState?.workflow).toBe(workflow);
    expect(jobState?.resolver).toBeFunction();
    expect(jobState?.resultsPromise).toBeInstanceOf(Promise);
  });

  it("should throw an error when getting the status of a non-existent job", () => {
    expect(() => jobRegistry.getJobStatus("non-existent-job-id")).toThrow(
      "Job with ID non-existent-job-id not found."
    );
  });

  it("should set job status", () => {
    const workflow = new Workflow({});
    const jobId = jobRegistry.addJob(workflow);
    jobRegistry.setJobStatus(jobId, "assigned", "http://localhost:8188");

    expect(jobRegistry.getJobStatus(jobId)).toBe("assigned");
    const jobState = jobRegistry.jobs.get(jobId);
    expect(jobState?.assignedClientUrl).toBe("http://localhost:8188");
  });

  it("should set prompt ID and map it to job ID", () => {
    const workflow = new Workflow({});
    const jobId = jobRegistry.addJob(workflow);
    const promptId = "prompt-123";

    jobRegistry.setPromptId(jobId, promptId);

    const jobState = jobRegistry.jobs.get(jobId);
    expect(jobState?.prompt_id).toBe(promptId);
    expect(jobRegistry.promptIdToJobId.get(promptId)).toBe(jobId);
  });

  it("should complete a job and resolve the promise", async () => {
    const workflow = new Workflow({});
    const jobId = jobRegistry.addJob(workflow);
    const promptId = "prompt-123";
    jobRegistry.setPromptId(jobId, promptId);
    jobRegistry.setJobStatus(jobId, "running", "http://localhost:8188");

    const resultsPromise = jobRegistry.waitForResults(jobId);

    // Simulate adding images
    jobRegistry.addJobImages(promptId, [{ filename: "test.png", subfolder: "", type: "output" }]);
    
    // Mock client for image URL generation
    clientRegistryMock.clients.set("http://localhost:8188", {
        api: { ext: { file: { getPathImage: (image: any) => `http://localhost:8188/view?filename=${image.filename}` } } }
    } as any);

    jobRegistry.completeJob(promptId);

    const results = await resultsPromise;

    expect(jobRegistry.getJobStatus(jobId)).toBe("completed");
    expect(results.status).toBe("completed");
    expect(results.jobId).toBe(jobId);
    expect(results.prompt_id).toBe(promptId);
    expect(results.images).toEqual(["http://localhost:8188/view?filename=test.png"]);
  });

  it("should fail a job and resolve the promise with an error", async () => {
    const workflow = new Workflow({});
    const jobId = jobRegistry.addJob(workflow);
    const promptId = "prompt-456";
    jobRegistry.setPromptId(jobId, promptId);
    jobRegistry.setJobStatus(jobId, "running");

    const resultsPromise = jobRegistry.waitForResults(jobId);
    const errorDetails = { error: "Test error" };

    jobRegistry.setJobFailure(jobId, errorDetails);

    const results = await resultsPromise;

    expect(jobRegistry.getJobStatus(jobId)).toBe("failed");
    expect(results.status).toBe("failed");
    expect(results.jobId).toBe(jobId);
    expect(results.prompt_id).toBe(promptId);
    expect(results.error).toEqual(errorDetails);
  });
    
  it("should enable profiling when the pool option is set", () => {
    poolMock.options.enableProfiling = true;
    jobRegistry = new JobStateRegistry(poolMock, clientRegistryMock);
    
    const workflow = new Workflow({});
    const jobId = jobRegistry.addJob(workflow);
    
    const jobState = jobRegistry.jobs.get(jobId);
    expect(jobState?.profiler).toBeDefined();
  });

  describe("cancelJob", () => {
    it("should cancel a pending job", async () => {
      const workflow = new Workflow({});
      const jobId = jobRegistry.addJob(workflow);
      const resultsPromise = jobRegistry.waitForResults(jobId);

      // Mock queue to check if dequeue is called
      const queueMock = { dequeueJob: jest.fn() };
      jobRegistry.pool.queues.set(workflow.structureHash || "general", queueMock as any);

      await jobRegistry.cancelJob(jobId);

      expect(jobRegistry.getJobStatus(jobId)).toBe("canceled");
      expect(queueMock.dequeueJob).toHaveBeenCalledWith(jobId);

      const result = await resultsPromise;
      expect(result.status).toBe("canceled");
    });

    it("should cancel a running job", async () => {
      const workflow = new Workflow({});
      const jobId = jobRegistry.addJob(workflow);
      const promptId = "prompt-789";
      const clientUrl = "http://localhost:8188";
      jobRegistry.setJobStatus(jobId, "running", clientUrl);
      jobRegistry.setPromptId(jobId, promptId);

      const resultsPromise = jobRegistry.waitForResults(jobId);

      // Mock client and its API
      const clientApiMock = { ext: { queue: { interrupt: jest.fn() } } };
      clientRegistryMock.clients.set(clientUrl, { api: clientApiMock, state: "busy" } as any);

      // Mock queue processing
      const queueMock = { processQueue: jest.fn().mockResolvedValue(undefined) };
      jobRegistry.pool.queues.set(workflow.structureHash || "general", queueMock as any);

      await jobRegistry.cancelJob(jobId);

      expect(jobRegistry.getJobStatus(jobId)).toBe("canceled");
      expect(clientApiMock.ext.queue.interrupt).toHaveBeenCalledWith(promptId);
      expect(clientRegistryMock.clients.get(clientUrl)?.state).toBe("idle");
      expect(queueMock.processQueue).toHaveBeenCalled();

      const result = await resultsPromise;
      expect(result.status).toBe("canceled");
    });

    it("should throw an error when trying to cancel a completed job", async () => {
      const workflow = new Workflow({});
      const jobId = jobRegistry.addJob(workflow);
      jobRegistry.setJobStatus(jobId, "completed");

      await expect(jobRegistry.cancelJob(jobId)).rejects.toThrow(
        `Cannot cancel job ${jobId} with status completed.`
      );
    });
  });
});
