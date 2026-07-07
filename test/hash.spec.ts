import { describe, it, expect } from "bun:test";
import { hashWorkflow } from "../src/pool/utils/hash";

// Contract for the structural workflow hash used by both pools for routing +
// failover grouping. It must be STABLE across volatile parameters (prompt,
// seed, dimensions, cfg, steps, node titles) and SENSITIVE to structure
// (topology, class types) and to capability-relevant model references.

// A small but representative ComfyUI prompt graph.
const base = () => ({
  "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" } },
  "2": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: "a red fox" } },
  "3": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: "blurry, low quality" } },
  "4": { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
  "5": {
    class_type: "KSampler",
    inputs: { model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0], seed: 42, steps: 20, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 1 },
    _meta: { title: "Sampler" },
  },
  "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
  "7": { class_type: "SaveImage", inputs: { images: ["6", 0], filename_prefix: "out" } },
});

describe("hashWorkflow — structural stability", () => {
  it("is stable across prompt text", () => {
    const a = base();
    const b = base(); b["2"].inputs.text = "a blue whale"; b["3"].inputs.text = "ugly";
    expect(hashWorkflow(b)).toBe(hashWorkflow(a));
  });

  it("is stable across seed / steps / cfg / dimensions", () => {
    const a = base();
    const b = base();
    b["5"].inputs.seed = 999999; b["5"].inputs.steps = 8; b["5"].inputs.cfg = 2;
    b["4"].inputs.width = 768; b["4"].inputs.height = 1344;
    expect(hashWorkflow(b)).toBe(hashWorkflow(a));
  });

  it("is stable across node _meta / titles", () => {
    const a = base();
    const b = base(); (b["5"] as any)._meta = { title: "Different Title" };
    expect(hashWorkflow(b)).toBe(hashWorkflow(a));
  });

  it("is stable across input key ordering", () => {
    const a = base();
    const b = base();
    // rebuild node 5 inputs in a different key order
    b["5"].inputs = { denoise: 1, scheduler: "normal", sampler_name: "euler", cfg: 7, steps: 20, seed: 42, latent_image: ["4", 0], negative: ["3", 0], positive: ["2", 0], model: ["1", 0] } as any;
    expect(hashWorkflow(b)).toBe(hashWorkflow(a));
  });
});

describe("hashWorkflow — structural sensitivity", () => {
  it("changes when a model reference changes (capability)", () => {
    const a = base();
    const b = base(); b["1"].inputs.ckpt_name = "dreamshaper_8.safetensors";
    expect(hashWorkflow(b)).not.toBe(hashWorkflow(a));
  });

  it("changes when a node's class_type changes", () => {
    const a = base();
    const b = base(); (b["5"] as any).class_type = "KSamplerAdvanced";
    expect(hashWorkflow(b)).not.toBe(hashWorkflow(a));
  });

  it("changes when the connection topology changes", () => {
    const a = base();
    const b = base(); b["5"].inputs.positive = ["3", 0]; b["5"].inputs.negative = ["2", 0]; // swap pos/neg wiring
    expect(hashWorkflow(b)).not.toBe(hashWorkflow(a));
  });

  it("changes when a node is added", () => {
    const a = base();
    const b: any = base(); b["8"] = { class_type: "LoraLoader", inputs: { lora_name: "detail.safetensors", model: ["1", 0], clip: ["1", 1], strength_model: 1, strength_clip: 1 } };
    expect(hashWorkflow(b)).not.toBe(hashWorkflow(a));
  });

  it("does NOT change for per-job data files (input images)", () => {
    const a: any = base();
    a["9"] = { class_type: "LoadImage", inputs: { image: "cat.png" } };
    const b: any = base();
    b["9"] = { class_type: "LoadImage", inputs: { image: "dog.png" } };
    expect(hashWorkflow(b)).toBe(hashWorkflow(a));
  });
});
