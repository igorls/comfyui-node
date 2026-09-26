import { describe, it, expect, beforeEach } from "bun:test";
import path from "path";
import sharp from "sharp";
import { McpGenerationSession } from "../../src/mcp/generation-session.js";
import { WorkflowCatalog } from "../../src/mcp/workflow-catalog.js";
import { ComfyApi } from "../../src/client.js";

describe("McpGenerationSession", () => {
  let session: McpGenerationSession;
  let catalog: WorkflowCatalog;
  let mockClient: ComfyApi;

  // Helper to create synthetic test image
  async function createTestImage(width: number, height: number, color: { r: number; g: number; b: number }): Promise<Buffer> {
    return sharp({
      create: {
        width,
        height,
        channels: 3,
        background: color
      }
    })
      .png()
      .toBuffer();
  }

  beforeEach(() => {
    catalog = new WorkflowCatalog([path.resolve("./test")]);
    mockClient = new ComfyApi("http://127.0.0.1:8188");
    // Keep the lazy connect hermetic: never reach a real server on this port.
    mockClient.init = async () => mockClient;

    // Mock ComfyApi features
    mockClient.ext.system.getSystemStats = async () =>
      ({
        system: { os: "windows", ram_total: 16000000000, ram_free: 8000000000 },
        devices: [{ name: "RTX 4090", type: "cuda", vram_total: 24000000000, vram_free: 18000000000 }]
      } as any);

    mockClient.ext.queue.getQueue = async () =>
      ({
        queue_running: [],
        queue_pending: []
      } as any);
    // getInfo() reads the queue through the client's own HTTP helper, not ext.queue.
    mockClient.getQueue = mockClient.ext.queue.getQueue as any;

    mockClient.ext.node.getNodeDefs = async () => ({
      CheckpointLoaderSimple: {
        name: "CheckpointLoaderSimple",
        input: { required: { ckpt_name: [["sd_xl_base_1.0.safetensors", "v1-5-pruned.safetensors"]] } }
      }
    });
    mockClient.ext.node.getCheckpoints = async () => ["sd_xl_base_1.0.safetensors", "v1-5-pruned.safetensors"];
    mockClient.ext.node.getLoras = async () => ["detail_enhancer.safetensors"];
    mockClient.ext.node.getSamplerInfo = async () => ({
      sampler: ["euler", "euler_ancestral", "dpmpp_2m"],
      scheduler: ["normal", "karras", "exponential"]
    });

    session = new McpGenerationSession(mockClient, catalog);
  });

  it("getInfo() gathers system, queue, model, and workflow catalog summary", async () => {
    const info = await session.getInfo();

    expect(info.connected).toBe(false); // mock client not connected to live ws
    expect(info.reachable).toBe(true); // ...but its HTTP API answered
    expect(info.comfyUrl).toBe("http://127.0.0.1:8188");
    expect(info.system).toBeDefined();
    expect(info.system.os).toBe("windows");
    expect(info.devices.length).toBe(1);
    expect(info.models.checkpointsCount).toBe(2);
    expect(info.models.checkpoints).toContain("sd_xl_base_1.0.safetensors");
    expect(info.models.lorasCount).toBe(1);
    expect(info.workflowCatalog.workflowCount).toBeGreaterThan(0);
  });

  it("getInfo() starts the lazy connection and reports an unreachable server", async () => {
    let initCalls = 0;
    mockClient.init = async () => {
      initCalls++;
      return mockClient;
    };
    mockClient.ext.system.getSystemStats = async () => {
      throw new Error("ECONNREFUSED");
    };
    mockClient.getQueue = async () => {
      throw new Error("ECONNREFUSED");
    };

    const info = await session.getInfo();

    expect(initCalls).toBe(1);
    expect(info.reachable).toBe(false);
    expect(info.connected).toBe(false);
  });

  it("manages run records and inspects output images", async () => {
    const img1 = await createTestImage(512, 512, { r: 255, g: 0, b: 0 });
    const img2 = await createTestImage(512, 512, { r: 0, g: 255, b: 0 });

    const runId = "test_run_1";
    const runRecord: any = {
      runId,
      promptIds: ["prompt_1", "prompt_2"],
      status: "completed",
      workflow: {},
      workflowName: "test.json",
      appliedInputs: { prompt: "a red circle" },
      seeds: [1001, 1002],
      candidates: [
        {
          index: 0,
          promptId: "prompt_1",
          nodeId: "9",
          filename: "test_0.png",
          seed: 1001,
          imageBuffer: img1,
          mimeType: "image/png"
        },
        {
          index: 1,
          promptId: "prompt_2",
          nodeId: "9",
          filename: "test_1.png",
          seed: 1002,
          imageBuffer: img2,
          mimeType: "image/png"
        }
      ],
      createdAt: Date.now()
    };

    (session as any).runs.set(runId, runRecord);
    (session as any).promptToRunId.set("prompt_1", runId);

    // Test getRun
    expect(session.getRun(runId)).toBe(runRecord);
    expect(session.getRun("prompt_1")).toBe(runRecord);

    // Test inspect single image
    const singleInspect = await session.inspect({
      runId,
      candidateIndex: 0,
      mode: "image"
    });
    expect(singleInspect.imageContent).toBeDefined();
    expect(singleInspect.imageContent!.type).toBe("image");
    expect(singleInspect.metadata.candidateIndex).toBe(0);

    // Test inspect contact sheet
    const sheetInspect = await session.inspect({
      runId,
      mode: "contact_sheet"
    });
    expect(sheetInspect.imageContent).toBeDefined();
    expect(sheetInspect.metadata.totalCandidates).toBe(2);

    // Test inspect crop
    const cropInspect = await session.inspect({
      runId,
      candidateIndex: 0,
      mode: "crop",
      crop: { x: 0, y: 0, width: 256, height: 256, normalized: false }
    });
    expect(cropInspect.imageContent).toBeDefined();
    expect(cropInspect.metadata.crop.width).toBe(256);
  });

  it("inspects revisions with side-by-side comparison", async () => {
    const parentImg = await createTestImage(512, 512, { r: 50, g: 50, b: 50 });
    const childImg = await createTestImage(512, 512, { r: 200, g: 200, b: 200 });

    const parentRun: any = {
      runId: "parent_run",
      promptIds: ["p_1"],
      status: "completed",
      workflow: {},
      appliedInputs: { prompt: "initial sketch" },
      seeds: [42],
      candidates: [
        {
          index: 0,
          promptId: "p_1",
          nodeId: "9",
          filename: "parent.png",
          seed: 42,
          imageBuffer: parentImg,
          mimeType: "image/png"
        }
      ],
      createdAt: Date.now()
    };

    const childRun: any = {
      runId: "child_run",
      parentRunId: "parent_run",
      promptIds: ["p_2"],
      status: "completed",
      workflow: {},
      appliedInputs: { prompt: "refined sketch" },
      seeds: [42],
      candidates: [
        {
          index: 0,
          promptId: "p_2",
          nodeId: "9",
          filename: "child.png",
          seed: 42,
          imageBuffer: childImg,
          mimeType: "image/png"
        }
      ],
      createdAt: Date.now()
    };

    (session as any).runs.set("parent_run", parentRun);
    (session as any).runs.set("child_run", childRun);

    const compInspect = await session.inspect({
      runId: "child_run",
      mode: "compare"
    });

    expect(compInspect.imageContent).toBeDefined();
    expect(compInspect.metadata.compare.parentRunId).toBe("parent_run");
    expect(compInspect.metadata.compare.childRunId).toBe("child_run");
  });

  it("job() queries status and cancels jobs", async () => {
    let cancelledPromptId = "";
    mockClient.ext.queue.cancelPrompt = async (pid: string) => {
      cancelledPromptId = pid;
      return {} as any;
    };

    const runRecord: any = {
      runId: "job_test_run",
      promptIds: ["pid_123"],
      status: "running",
      candidates: [],
      createdAt: Date.now()
    };
    (session as any).runs.set("job_test_run", runRecord);

    // Status
    const statusRes = await session.job({ runId: "job_test_run", action: "status" });
    expect(statusRes.status).toBe("running");

    // Cancel
    const cancelRes = await session.job({ runId: "job_test_run", action: "cancel" });
    expect(cancelRes.status).toBe("cancelled");
    expect(cancelledPromptId).toBe("pid_123");
  });
});
