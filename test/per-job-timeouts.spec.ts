import { WorkflowPool } from "../src/pool/WorkflowPool";
import { ComfyApi } from "../src/client";
import { Workflow } from "../src/workflow";

describe("Per-Job Timeout Overrides", () => {
  let pool: WorkflowPool;
  let mockClient: ComfyApi;

  beforeEach(() => {
    mockClient = new ComfyApi("http://localhost:8188", "test-client");

    // Mock the init method to prevent network calls
    mockClient.init = async () => {
      (mockClient as any).socket = { readyState: 1 }; // OPEN state
      (mockClient as any).clientId = "test-client";
    };

    pool = new WorkflowPool([mockClient], {
      executionStartTimeoutMs: 5000,
      nodeExecutionTimeoutMs: 60000
    });
  });

  afterEach(async () => {
    await pool.shutdown();
    mockClient.destroy();
  });

  describe("WorkflowJobOptions timeout fields", () => {
    test("accepts executionStartTimeoutMs override", async () => {
      const workflow = {
        "1": { class_type: "KSampler", inputs: { steps: 20 } }
      };

      const jobId = await pool.enqueue(workflow, {
        executionStartTimeoutMs: 10000 // Override to 10 seconds
      });

      const job = pool.getJob(jobId);
      expect(job).toBeDefined();
      expect(job?.timeouts?.executionStartTimeoutMs).toBe(10000);
    });

    test("accepts nodeExecutionTimeoutMs override", async () => {
      const workflow = {
        "1": { class_type: "KSampler", inputs: { steps: 20 } }
      };

      const jobId = await pool.enqueue(workflow, {
        nodeExecutionTimeoutMs: 120000 // Override to 2 minutes
      });

      const job = pool.getJob(jobId);
      expect(job).toBeDefined();
      expect(job?.timeouts?.nodeExecutionTimeoutMs).toBe(120000);
    });

    test("accepts both timeout overrides simultaneously", async () => {
      const workflow = {
        "1": { class_type: "KSampler", inputs: { steps: 20 } }
      };

      const jobId = await pool.enqueue(workflow, {
        executionStartTimeoutMs: 8000,
        nodeExecutionTimeoutMs: 180000
      });

      const job = pool.getJob(jobId);
      expect(job).toBeDefined();
      expect(job?.timeouts?.executionStartTimeoutMs).toBe(8000);
      expect(job?.timeouts?.nodeExecutionTimeoutMs).toBe(180000);
    });

    test("uses pool defaults when no override specified", async () => {
      const workflow = {
        "1": { class_type: "KSampler", inputs: { steps: 20 } }
      };

      const jobId = await pool.enqueue(workflow, {
        // No timeout overrides
      });

      const job = pool.getJob(jobId);
      expect(job).toBeDefined();
      // Timeouts object should not have values or be undefined
      expect(job?.timeouts?.executionStartTimeoutMs).toBeUndefined();
      expect(job?.timeouts?.nodeExecutionTimeoutMs).toBeUndefined();
    });

    test("allows zero timeout to disable timeout", async () => {
      const workflow = {
        "1": { class_type: "KSampler", inputs: { steps: 20 } }
      };

      const jobId = await pool.enqueue(workflow, {
        executionStartTimeoutMs: 0,
        nodeExecutionTimeoutMs: 0
      });

      const job = pool.getJob(jobId);
      expect(job).toBeDefined();
      expect(job?.timeouts?.executionStartTimeoutMs).toBe(0);
      expect(job?.timeouts?.nodeExecutionTimeoutMs).toBe(0);
    });
  });

  describe("timeout storage in job payload", () => {
    test("stores timeout overrides in job payload", async () => {
      const workflow = {
        "1": { class_type: "KSampler", inputs: { steps: 20 } }
      };

      const jobId = await pool.enqueue(workflow, {
        executionStartTimeoutMs: 15000,
        nodeExecutionTimeoutMs: 300000
      });

      const job = pool.getJob(jobId);
      expect(job).toBeDefined();
      expect(job?.timeouts).toBeDefined();
      expect(job?.timeouts?.executionStartTimeoutMs).toBe(15000);
      expect(job?.timeouts?.nodeExecutionTimeoutMs).toBe(300000);
    });

    test("timeout overrides persist through job lifecycle", async () => {
      const workflow = {
        "1": { class_type: "KSampler", inputs: { steps: 20 } }
      };

      const jobId = await pool.enqueue(workflow, {
        executionStartTimeoutMs: 20000,
        nodeExecutionTimeoutMs: 240000
      });

      // Get job multiple times to ensure timeouts persist
      const job1 = pool.getJob(jobId);
      const job2 = pool.getJob(jobId);

      expect(job1?.timeouts?.executionStartTimeoutMs).toBe(20000);
      expect(job2?.timeouts?.executionStartTimeoutMs).toBe(20000);
      expect(job1?.timeouts?.nodeExecutionTimeoutMs).toBe(240000);
      expect(job2?.timeouts?.nodeExecutionTimeoutMs).toBe(240000);
    });

    test("different jobs can have different timeout overrides", async () => {
      const workflow1 = {
        "1": { class_type: "KSampler", inputs: { steps: 10 } }
      };
      const workflow2 = {
        "1": { class_type: "KSampler", inputs: { steps: 50 } }
      };

      const jobId1 = await pool.enqueue(workflow1, {
        nodeExecutionTimeoutMs: 60000 // 1 minute
      });

      const jobId2 = await pool.enqueue(workflow2, {
        nodeExecutionTimeoutMs: 600000 // 10 minutes
      });

      const job1 = pool.getJob(jobId1);
      const job2 = pool.getJob(jobId2);

      expect(job1?.timeouts?.nodeExecutionTimeoutMs).toBe(60000);
      expect(job2?.timeouts?.nodeExecutionTimeoutMs).toBe(600000);
    });
  });

  describe("Workflow instance support", () => {
    test("accepts timeout overrides when using Workflow instance", async () => {
      const workflowJson = {
        "1": { class_type: "KSampler", inputs: { steps: 20 } }
      };
      const workflow = Workflow.from(workflowJson);

      const jobId = await pool.enqueue(workflow, {
        executionStartTimeoutMs: 12000,
        nodeExecutionTimeoutMs: 180000
      });

      const job = pool.getJob(jobId);
      expect(job).toBeDefined();
      expect(job?.timeouts?.executionStartTimeoutMs).toBe(12000);
      expect(job?.timeouts?.nodeExecutionTimeoutMs).toBe(180000);
    });
  });

  describe("timeout override validation", () => {
    test("accepts positive timeout values", async () => {
      const workflow = {
        "1": { class_type: "KSampler", inputs: { steps: 20 } }
      };

      const jobId = await pool.enqueue(workflow, {
        executionStartTimeoutMs: 1,
        nodeExecutionTimeoutMs: 1
      });

      const job = pool.getJob(jobId);
      expect(job?.timeouts?.executionStartTimeoutMs).toBe(1);
      expect(job?.timeouts?.nodeExecutionTimeoutMs).toBe(1);
    });

    test("accepts very large timeout values", async () => {
      const workflow = {
        "1": { class_type: "KSampler", inputs: { steps: 20 } }
      };

      const largeTimeout = 3600000; // 1 hour

      const jobId = await pool.enqueue(workflow, {
        executionStartTimeoutMs: largeTimeout,
        nodeExecutionTimeoutMs: largeTimeout * 2
      });

      const job = pool.getJob(jobId);
      expect(job?.timeouts?.executionStartTimeoutMs).toBe(largeTimeout);
      expect(job?.timeouts?.nodeExecutionTimeoutMs).toBe(largeTimeout * 2);
    });
  });

  describe("pool configuration defaults", () => {
    test("pool without default timeouts uses library defaults when no override", async () => {
      const mockClient2 = new ComfyApi("http://localhost:8188", "test-client-2");

      // Mock the init method to prevent network calls
      mockClient2.init = async () => {
        (mockClient2 as any).socket = { readyState: 1 }; // OPEN state
        (mockClient2 as any).clientId = "test-client-2";
      };

      const poolNoDefaults = new WorkflowPool([mockClient2]);

      const workflow = {
        "1": { class_type: "KSampler", inputs: { steps: 20 } }
      };

      const jobId = await poolNoDefaults.enqueue(workflow);

      const job = poolNoDefaults.getJob(jobId);
      expect(job).toBeDefined();
      // Should use library defaults (not specified in pool opts)
      expect(job?.timeouts?.executionStartTimeoutMs).toBeUndefined();
      expect(job?.timeouts?.nodeExecutionTimeoutMs).toBeUndefined();

      await poolNoDefaults.shutdown();
      mockClient2.destroy();
    });

    test("job override takes precedence over pool default", async () => {
      // Pool has defaults of 5000 and 60000
      const workflow = {
        "1": { class_type: "KSampler", inputs: { steps: 20 } }
      };

      const jobId = await pool.enqueue(workflow, {
        executionStartTimeoutMs: 25000, // Override pool default
        nodeExecutionTimeoutMs: 200000 // Override pool default
      });

      const job = pool.getJob(jobId);
      expect(job?.timeouts?.executionStartTimeoutMs).toBe(25000);
      expect(job?.timeouts?.nodeExecutionTimeoutMs).toBe(200000);
    });
  });

  describe("use cases", () => {
    test("model loading workflow with extended timeout", async () => {
      const workflowWithModelLoading = {
        "1": { class_type: "CheckpointLoaderSimple", inputs: {} },
        "2": { class_type: "LoraLoader", inputs: {} },
        "3": { class_type: "VAELoader", inputs: {} },
        "4": { class_type: "KSampler", inputs: { steps: 20 } }
      };

      // Give extra time for model loading on first run
      const jobId = await pool.enqueue(workflowWithModelLoading, {
        executionStartTimeoutMs: 30000, // 30 seconds
        nodeExecutionTimeoutMs: 600000 // 10 minutes
      });

      const job = pool.getJob(jobId);
      expect(job?.timeouts?.executionStartTimeoutMs).toBe(30000);
      expect(job?.timeouts?.nodeExecutionTimeoutMs).toBe(600000);
    });

    test("fast workflow with reduced timeout", async () => {
      const fastWorkflow = {
        "1": { class_type: "EmptyLatentImage", inputs: {} },
        "2": { class_type: "SaveImage", inputs: {} }
      };

      // Use shorter timeouts for fast workflows
      const jobId = await pool.enqueue(fastWorkflow, {
        executionStartTimeoutMs: 2000, // 2 seconds
        nodeExecutionTimeoutMs: 10000 // 10 seconds
      });

      const job = pool.getJob(jobId);
      expect(job?.timeouts?.executionStartTimeoutMs).toBe(2000);
      expect(job?.timeouts?.nodeExecutionTimeoutMs).toBe(10000);
    });

    test("high-res upscale workflow with very long timeout", async () => {
      const upscaleWorkflow = {
        "1": { class_type: "UpscaleModelLoader", inputs: {} },
        "2": { class_type: "ImageUpscaleWithModel", inputs: {} }
      };

      // Upscaling can take a very long time
      const jobId = await pool.enqueue(upscaleWorkflow, {
        nodeExecutionTimeoutMs: 1800000 // 30 minutes
      });

      const job = pool.getJob(jobId);
      expect(job?.timeouts?.nodeExecutionTimeoutMs).toBe(1800000);
    });

    test("critical workflow with no timeout", async () => {
      const criticalWorkflow = {
        "1": { class_type: "KSampler", inputs: { steps: 1000 } }
      };

      // Disable timeout for critical long-running workflow
      const jobId = await pool.enqueue(criticalWorkflow, {
        executionStartTimeoutMs: 0,
        nodeExecutionTimeoutMs: 0
      });

      const job = pool.getJob(jobId);
      expect(job?.timeouts?.executionStartTimeoutMs).toBe(0);
      expect(job?.timeouts?.nodeExecutionTimeoutMs).toBe(0);
    });
  });

  describe("integration with other job options", () => {
    test("timeout overrides work alongside other job options", async () => {
      const workflow = {
        "1": { class_type: "KSampler", inputs: { steps: 20 } }
      };

      const jobId = await pool.enqueue(workflow, {
        priority: 10,
        maxAttempts: 5,
        retryDelayMs: 2000,
        executionStartTimeoutMs: 15000,
        nodeExecutionTimeoutMs: 120000,
        metadata: { user: "test", workflow_type: "txt2img" }
      });

      const job = pool.getJob(jobId);
      expect(job).toBeDefined();
      expect(job?.options.priority).toBe(10);
      expect(job?.options.maxAttempts).toBe(5);
      expect(job?.options.retryDelayMs).toBe(2000);
      expect(job?.timeouts?.executionStartTimeoutMs).toBe(15000);
      expect(job?.timeouts?.nodeExecutionTimeoutMs).toBe(120000);
      expect(job?.options.metadata).toEqual({ user: "test", workflow_type: "txt2img" });
    });

    test("timeout overrides preserved with preferredClientIds", async () => {
      const workflow = {
        "1": { class_type: "KSampler", inputs: { steps: 20 } }
      };

      const jobId = await pool.enqueue(workflow, {
        preferredClientIds: ["test-client"],
        executionStartTimeoutMs: 20000,
        nodeExecutionTimeoutMs: 180000
      });

      const job = pool.getJob(jobId);
      expect(job?.options.preferredClientIds).toContain("test-client");
      expect(job?.timeouts?.executionStartTimeoutMs).toBe(20000);
      expect(job?.timeouts?.nodeExecutionTimeoutMs).toBe(180000);
    });
  });
});
