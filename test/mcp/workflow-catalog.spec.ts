import { describe, it, expect } from "bun:test";
import path from "path";
import fs from "fs/promises";
import { WorkflowCatalog } from "../../src/mcp/workflow-catalog.js";

describe("workflow-catalog", () => {
  const testDir = path.resolve("./test");
  const catalog = new WorkflowCatalog([testDir]);

  it("detects standard slots on example workflow", async () => {
    const meta = await catalog.getWorkflow("example-txt2img-workflow.json");
    expect(meta).not.toBeNull();
    expect(meta!.name).toBe("example-txt2img-workflow.json");

    const slots = meta!.slots;
    expect(slots.prompt).toBeDefined();
    expect(slots.prompt.nodeId).toBe("6");
    expect(slots.prompt.inputName).toBe("text");

    expect(slots.negative_prompt).toBeDefined();
    expect(slots.negative_prompt.nodeId).toBe("7");
    expect(slots.negative_prompt.inputName).toBe("text");

    expect(slots.seed).toBeDefined();
    expect(slots.seed.nodeId).toBe("3");

    expect(slots.width).toBeDefined();
    expect(slots.width.nodeId).toBe("5");

    expect(slots.height).toBeDefined();
    expect(slots.height.nodeId).toBe("5");

    expect(slots.ckpt_name).toBeDefined();
    expect(slots.ckpt_name.nodeId).toBe("4");
  });

  it("scans configured directories", async () => {
    const workflows = await catalog.scan();
    expect(workflows.length).toBeGreaterThan(0);
    const found = workflows.find((w) => w.name === "example-txt2img-workflow.json");
    expect(found).toBeDefined();
  });

  it("applies slot overrides to workflow JSON", async () => {
    const meta = await catalog.getWorkflow("example-txt2img-workflow.json");
    const overridden = catalog.applyOverrides(meta!.rawWorkflow, meta!.slots, {
      prompt: "A beautiful sunny mountain landscape",
      negative_prompt: "bad quality",
      seed: 4242,
      width: 1024,
      height: 768
    });

    expect(overridden["6"].inputs.text).toBe("A beautiful sunny mountain landscape");
    expect(overridden["7"].inputs.text).toBe("bad quality");
    expect(overridden["3"].inputs.seed).toBe(4242);
    expect(overridden["5"].inputs.width).toBe(1024);
    expect(overridden["5"].inputs.height).toBe(768);
  });

  it("applies explicit node path overrides", async () => {
    const meta = await catalog.getWorkflow("example-txt2img-workflow.json");
    const overridden = catalog.applyOverrides(meta!.rawWorkflow, meta!.slots, {
      "6.inputs.text": "Explicit path text",
      "3.steps": 35
    });

    expect(overridden["6"].inputs.text).toBe("Explicit path text");
    expect(overridden["3"].inputs.steps).toBe(35);
  });

  it("validates workflow against live node definitions", async () => {
    const meta = await catalog.getWorkflow("example-txt2img-workflow.json");

    const mockNodeDefs: Record<string, any> = {
      KSampler: { input: { required: { seed: ["INT"] } } },
      CheckpointLoaderSimple: { input: { required: { ckpt_name: [["v1-5-pruned.safetensors", "sd_xl_base_1.0.safetensors"]] } } },
      EmptyLatentImage: { input: { required: { width: ["INT"], height: ["INT"] } } },
      CLIPTextEncode: { input: { required: { text: ["STRING"] } } },
      VAEDecode: { input: { required: {} } },
      SaveImage: { input: { required: {} } },
      UpscaleModelLoader: { input: { required: {} } },
      ImageUpscaleWithModel: { input: { required: {} } }
    };

    const result = catalog.validateWorkflow(meta!.rawWorkflow, mockNodeDefs);
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it("catches missing nodes in validation", async () => {
    const meta = await catalog.getWorkflow("example-txt2img-workflow.json");
    const incompleteDefs: Record<string, any> = {
      KSampler: { input: { required: {} } }
      // Missing CheckpointLoaderSimple, CLIPTextEncode, etc.
    };

    const result = catalog.validateWorkflow(meta!.rawWorkflow, incompleteDefs);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("CheckpointLoaderSimple"))).toBe(true);
  });

  it("rejects UI-format graph JSON with actionable error message", () => {
    const uiWorkflow = {
      nodes: [{ id: 1, type: "KSampler" }],
      links: [[1, 0, 2, 0, "MODEL"]]
    };

    const result = catalog.validateWorkflow(uiWorkflow, null);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("UI format");
  });
});
