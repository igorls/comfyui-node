import {
  isModelLoadingNode,
  workflowContainsModelLoading,
  getModelLoadingNodes,
  estimateModelLoadingTime,
  estimateWorkflowModelLoadingTime,
  getTimeoutMultiplierForModelLoading,
  MODEL_LOADING_NODE_TYPES,
  MODEL_LOADING_TIME_ESTIMATES
} from "../src/utils/model-loading";

describe("Model Loading Detection", () => {
  describe("isModelLoadingNode", () => {
    test("identifies checkpoint loaders", () => {
      expect(isModelLoadingNode("CheckpointLoaderSimple")).toBe(true);
      expect(isModelLoadingNode("CheckpointLoader")).toBe(true);
      expect(isModelLoadingNode("unCLIPCheckpointLoader")).toBe(true);
    });

    test("identifies VAE loaders", () => {
      expect(isModelLoadingNode("VAELoader")).toBe(true);
      expect(isModelLoadingNode("VAEDecode")).toBe(true);
    });

    test("identifies LoRA loaders", () => {
      expect(isModelLoadingNode("LoraLoader")).toBe(true);
      expect(isModelLoadingNode("LoraLoaderModelOnly")).toBe(true);
    });

    test("identifies ControlNet loaders", () => {
      expect(isModelLoadingNode("ControlNetLoader")).toBe(true);
      expect(isModelLoadingNode("ControlNetApply")).toBe(true);
      expect(isModelLoadingNode("ControlNetApplyAdvanced")).toBe(true);
    });

    test("identifies CLIP loaders", () => {
      expect(isModelLoadingNode("CLIPLoader")).toBe(true);
      expect(isModelLoadingNode("DualCLIPLoader")).toBe(true);
      expect(isModelLoadingNode("CLIPVisionLoader")).toBe(true);
    });

    test("identifies upscale model loaders", () => {
      expect(isModelLoadingNode("UpscaleModelLoader")).toBe(true);
    });

    test("identifies AnimateDiff loaders", () => {
      expect(isModelLoadingNode("AnimateDiffLoader")).toBe(true);
      expect(isModelLoadingNode("ADE_AnimateDiffLoaderGen1")).toBe(true);
      expect(isModelLoadingNode("ADE_AnimateDiffLoaderGen2")).toBe(true);
    });

    test("identifies new model loaders (Flux, SD3)", () => {
      expect(isModelLoadingNode("FluxCheckpointLoader")).toBe(true);
      expect(isModelLoadingNode("SD3CheckpointLoader")).toBe(true);
    });

    test("returns false for non-model-loading nodes", () => {
      expect(isModelLoadingNode("KSampler")).toBe(false);
      expect(isModelLoadingNode("EmptyLatentImage")).toBe(false);
      expect(isModelLoadingNode("CLIPTextEncode")).toBe(false);
      expect(isModelLoadingNode("SaveImage")).toBe(false);
      expect(isModelLoadingNode("PreviewImage")).toBe(false);
    });

    test("handles case sensitivity", () => {
      // Should be exact match
      expect(isModelLoadingNode("checkpointloadersimple")).toBe(false);
      expect(isModelLoadingNode("CHECKPOINTLOADERSIMPLE")).toBe(false);
    });

    test("handles empty strings", () => {
      expect(isModelLoadingNode("")).toBe(false);
    });
  });

  describe("workflowContainsModelLoading", () => {
    test("detects workflows with model loading nodes", () => {
      const workflow = {
        "1": {
          class_type: "CheckpointLoaderSimple",
          inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" }
        },
        "2": {
          class_type: "KSampler",
          inputs: { steps: 20 }
        }
      };

      expect(workflowContainsModelLoading(workflow)).toBe(true);
    });

    test("returns false for workflows without model loading", () => {
      const workflow = {
        "1": {
          class_type: "EmptyLatentImage",
          inputs: { width: 512, height: 512 }
        },
        "2": {
          class_type: "KSampler",
          inputs: { steps: 20 }
        }
      };

      expect(workflowContainsModelLoading(workflow)).toBe(false);
    });

    test("handles empty workflows", () => {
      expect(workflowContainsModelLoading({})).toBe(false);
    });

    test("handles workflows with multiple model loading nodes", () => {
      const workflow = {
        "1": {
          class_type: "CheckpointLoaderSimple",
          inputs: {}
        },
        "2": {
          class_type: "LoraLoader",
          inputs: {}
        },
        "3": {
          class_type: "VAELoader",
          inputs: {}
        }
      };

      expect(workflowContainsModelLoading(workflow)).toBe(true);
    });

    test("handles malformed nodes gracefully", () => {
      const workflow = {
        "1": null,
        "2": undefined,
        "3": "not-an-object",
        "4": {
          class_type: "CheckpointLoaderSimple"
        }
      };

      expect(workflowContainsModelLoading(workflow)).toBe(true);
    });
  });

  describe("getModelLoadingNodes", () => {
    test("extracts model loading nodes from workflow", () => {
      const workflow = {
        "1": {
          class_type: "CheckpointLoaderSimple",
          inputs: {}
        },
        "2": {
          class_type: "KSampler",
          inputs: {}
        },
        "3": {
          class_type: "LoraLoader",
          inputs: {}
        }
      };

      const nodes = getModelLoadingNodes(workflow);

      expect(nodes).toHaveLength(2);
      expect(nodes).toContainEqual({ nodeId: "1", nodeType: "CheckpointLoaderSimple" });
      expect(nodes).toContainEqual({ nodeId: "3", nodeType: "LoraLoader" });
    });

    test("returns empty array for workflows without model loading", () => {
      const workflow = {
        "1": {
          class_type: "KSampler",
          inputs: {}
        },
        "2": {
          class_type: "SaveImage",
          inputs: {}
        }
      };

      const nodes = getModelLoadingNodes(workflow);
      expect(nodes).toEqual([]);
    });

    test("preserves node IDs", () => {
      const workflow = {
        "42": {
          class_type: "CheckpointLoaderSimple",
          inputs: {}
        },
        "100": {
          class_type: "VAELoader",
          inputs: {}
        }
      };

      const nodes = getModelLoadingNodes(workflow);

      expect(nodes).toContainEqual({ nodeId: "42", nodeType: "CheckpointLoaderSimple" });
      expect(nodes).toContainEqual({ nodeId: "100", nodeType: "VAELoader" });
    });

    test("handles malformed nodes gracefully", () => {
      const workflow = {
        "1": null,
        "2": { class_type: "CheckpointLoaderSimple" },
        "3": undefined,
        "4": "not-an-object"
      };

      const nodes = getModelLoadingNodes(workflow);
      expect(nodes).toHaveLength(1);
      expect(nodes[0]).toEqual({ nodeId: "2", nodeType: "CheckpointLoaderSimple" });
    });
  });

  describe("estimateModelLoadingTime", () => {
    test("estimates checkpoint loading time", () => {
      expect(estimateModelLoadingTime("CheckpointLoaderSimple", "ssd")).toBe(
        MODEL_LOADING_TIME_ESTIMATES.checkpoint.ssd
      );
      expect(estimateModelLoadingTime("CheckpointLoader", "nvme")).toBe(MODEL_LOADING_TIME_ESTIMATES.checkpoint.nvme);
      expect(estimateModelLoadingTime("FluxCheckpointLoader", "hdd")).toBe(MODEL_LOADING_TIME_ESTIMATES.checkpoint.hdd);
    });

    test("estimates VAE loading time", () => {
      expect(estimateModelLoadingTime("VAELoader", "ssd")).toBe(MODEL_LOADING_TIME_ESTIMATES.vae.ssd);
      expect(estimateModelLoadingTime("VAEDecode", "nvme")).toBe(MODEL_LOADING_TIME_ESTIMATES.vae.nvme);
    });

    test("estimates LoRA loading time", () => {
      expect(estimateModelLoadingTime("LoraLoader", "ssd")).toBe(MODEL_LOADING_TIME_ESTIMATES.lora.ssd);
      expect(estimateModelLoadingTime("LoraLoaderModelOnly", "hdd")).toBe(MODEL_LOADING_TIME_ESTIMATES.lora.hdd);
    });

    test("estimates ControlNet loading time", () => {
      expect(estimateModelLoadingTime("ControlNetLoader", "ssd")).toBe(MODEL_LOADING_TIME_ESTIMATES.controlnet.ssd);
      expect(estimateModelLoadingTime("ControlNetApply", "nvme")).toBe(MODEL_LOADING_TIME_ESTIMATES.controlnet.nvme);
    });

    test("defaults to 'other' category for unknown model loaders", () => {
      expect(estimateModelLoadingTime("CLIPLoader", "ssd")).toBe(MODEL_LOADING_TIME_ESTIMATES.other.ssd);
      expect(estimateModelLoadingTime("UpscaleModelLoader", "nvme")).toBe(MODEL_LOADING_TIME_ESTIMATES.other.nvme);
    });

    test("returns 0 for non-model-loading nodes", () => {
      expect(estimateModelLoadingTime("KSampler", "ssd")).toBe(0);
      expect(estimateModelLoadingTime("SaveImage", "nvme")).toBe(0);
      expect(estimateModelLoadingTime("EmptyLatentImage", "hdd")).toBe(0);
    });

    test("defaults to SSD when storage type not specified", () => {
      expect(estimateModelLoadingTime("CheckpointLoaderSimple")).toBe(MODEL_LOADING_TIME_ESTIMATES.checkpoint.ssd);
    });

    test("handles all storage types correctly", () => {
      const nodeType = "CheckpointLoaderSimple";

      expect(estimateModelLoadingTime(nodeType, "hdd")).toBe(MODEL_LOADING_TIME_ESTIMATES.checkpoint.hdd);
      expect(estimateModelLoadingTime(nodeType, "ssd")).toBe(MODEL_LOADING_TIME_ESTIMATES.checkpoint.ssd);
      expect(estimateModelLoadingTime(nodeType, "nvme")).toBe(MODEL_LOADING_TIME_ESTIMATES.checkpoint.nvme);
    });
  });

  describe("estimateWorkflowModelLoadingTime", () => {
    test("sums loading times for all model nodes", () => {
      const workflow = {
        "1": {
          class_type: "CheckpointLoaderSimple",
          inputs: {}
        },
        "2": {
          class_type: "VAELoader",
          inputs: {}
        },
        "3": {
          class_type: "LoraLoader",
          inputs: {}
        }
      };

      const expected =
        MODEL_LOADING_TIME_ESTIMATES.checkpoint.ssd +
        MODEL_LOADING_TIME_ESTIMATES.vae.ssd +
        MODEL_LOADING_TIME_ESTIMATES.lora.ssd;

      expect(estimateWorkflowModelLoadingTime(workflow, "ssd")).toBe(expected);
    });

    test("returns 0 for workflows without model loading", () => {
      const workflow = {
        "1": {
          class_type: "KSampler",
          inputs: {}
        },
        "2": {
          class_type: "SaveImage",
          inputs: {}
        }
      };

      expect(estimateWorkflowModelLoadingTime(workflow, "ssd")).toBe(0);
    });

    test("handles different storage types", () => {
      const workflow = {
        "1": {
          class_type: "CheckpointLoaderSimple",
          inputs: {}
        }
      };

      expect(estimateWorkflowModelLoadingTime(workflow, "hdd")).toBe(MODEL_LOADING_TIME_ESTIMATES.checkpoint.hdd);
      expect(estimateWorkflowModelLoadingTime(workflow, "ssd")).toBe(MODEL_LOADING_TIME_ESTIMATES.checkpoint.ssd);
      expect(estimateWorkflowModelLoadingTime(workflow, "nvme")).toBe(MODEL_LOADING_TIME_ESTIMATES.checkpoint.nvme);
    });

    test("defaults to SSD when storage type not specified", () => {
      const workflow = {
        "1": {
          class_type: "LoraLoader",
          inputs: {}
        }
      };

      expect(estimateWorkflowModelLoadingTime(workflow)).toBe(MODEL_LOADING_TIME_ESTIMATES.lora.ssd);
    });
  });

  describe("getTimeoutMultiplierForModelLoading", () => {
    test("returns 1.0 for workflows without model loading", () => {
      const workflow = {
        "1": {
          class_type: "KSampler",
          inputs: {}
        }
      };

      expect(getTimeoutMultiplierForModelLoading(workflow)).toBe(1.0);
    });

    test("returns 1.0 if workflow has been executed before", () => {
      const workflow = {
        "1": {
          class_type: "CheckpointLoaderSimple",
          inputs: {}
        },
        "2": {
          class_type: "LoraLoader",
          inputs: {}
        },
        "3": {
          class_type: "VAELoader",
          inputs: {}
        }
      };

      expect(getTimeoutMultiplierForModelLoading(workflow, true)).toBe(1.0);
    });

    test("returns 2.0 for 1-2 model nodes (first execution)", () => {
      const workflow1 = {
        "1": {
          class_type: "CheckpointLoaderSimple",
          inputs: {}
        }
      };

      expect(getTimeoutMultiplierForModelLoading(workflow1, false)).toBe(2.0);

      const workflow2 = {
        "1": {
          class_type: "CheckpointLoaderSimple",
          inputs: {}
        },
        "2": {
          class_type: "LoraLoader",
          inputs: {}
        }
      };

      expect(getTimeoutMultiplierForModelLoading(workflow2, false)).toBe(2.0);
    });

    test("returns 3.0 for 3-4 model nodes (first execution)", () => {
      const workflow = {
        "1": {
          class_type: "CheckpointLoaderSimple",
          inputs: {}
        },
        "2": {
          class_type: "LoraLoader",
          inputs: {}
        },
        "3": {
          class_type: "VAELoader",
          inputs: {}
        }
      };

      expect(getTimeoutMultiplierForModelLoading(workflow, false)).toBe(3.0);

      const workflow4 = {
        ...workflow,
        "4": {
          class_type: "ControlNetLoader",
          inputs: {}
        }
      };

      expect(getTimeoutMultiplierForModelLoading(workflow4, false)).toBe(3.0);
    });

    test("returns 4.0 for 5+ model nodes (first execution)", () => {
      const workflow = {
        "1": { class_type: "CheckpointLoaderSimple", inputs: {} },
        "2": { class_type: "LoraLoader", inputs: {} },
        "3": { class_type: "VAELoader", inputs: {} },
        "4": { class_type: "ControlNetLoader", inputs: {} },
        "5": { class_type: "CLIPLoader", inputs: {} }
      };

      expect(getTimeoutMultiplierForModelLoading(workflow, false)).toBe(4.0);

      const workflow6 = {
        ...workflow,
        "6": { class_type: "UpscaleModelLoader", inputs: {} }
      };

      expect(getTimeoutMultiplierForModelLoading(workflow6, false)).toBe(4.0);
    });

    test("defaults to hasExecutedBefore=false", () => {
      const workflow = {
        "1": {
          class_type: "CheckpointLoaderSimple",
          inputs: {}
        }
      };

      // Should assume first execution
      expect(getTimeoutMultiplierForModelLoading(workflow)).toBe(2.0);
    });
  });

  describe("MODEL_LOADING_NODE_TYPES constant", () => {
    test("is exported and contains expected types", () => {
      expect(MODEL_LOADING_NODE_TYPES).toContain("CheckpointLoaderSimple");
      expect(MODEL_LOADING_NODE_TYPES).toContain("VAELoader");
      expect(MODEL_LOADING_NODE_TYPES).toContain("LoraLoader");
      expect(MODEL_LOADING_NODE_TYPES).toContain("ControlNetLoader");
    });

    test("is a const array (readonly at compile time)", () => {
      // TypeScript 'as const' provides compile-time readonly guarantee
      // At runtime, the array is still mutable, but TypeScript prevents modifications
      expect(Array.isArray(MODEL_LOADING_NODE_TYPES)).toBe(true);
      expect(MODEL_LOADING_NODE_TYPES.length).toBeGreaterThan(0);
    });
  });

  describe("MODEL_LOADING_TIME_ESTIMATES constant", () => {
    test("contains all required categories", () => {
      expect(MODEL_LOADING_TIME_ESTIMATES.checkpoint).toBeDefined();
      expect(MODEL_LOADING_TIME_ESTIMATES.vae).toBeDefined();
      expect(MODEL_LOADING_TIME_ESTIMATES.lora).toBeDefined();
      expect(MODEL_LOADING_TIME_ESTIMATES.controlnet).toBeDefined();
      expect(MODEL_LOADING_TIME_ESTIMATES.other).toBeDefined();
    });

    test("each category has all storage types", () => {
      for (const category of Object.values(MODEL_LOADING_TIME_ESTIMATES)) {
        expect(category.hdd).toBeGreaterThan(0);
        expect(category.ssd).toBeGreaterThan(0);
        expect(category.nvme).toBeGreaterThan(0);
      }
    });

    test("estimates follow expected performance order (hdd > ssd > nvme)", () => {
      for (const category of Object.values(MODEL_LOADING_TIME_ESTIMATES)) {
        expect(category.hdd).toBeGreaterThan(category.ssd);
        expect(category.ssd).toBeGreaterThan(category.nvme);
      }
    });
  });

  describe("integration scenarios", () => {
    test("typical SDXL workflow", () => {
      const workflow = {
        "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" } },
        "2": { class_type: "CLIPTextEncode", inputs: { text: "prompt" } },
        "3": { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024 } },
        "4": { class_type: "KSampler", inputs: { steps: 20 } },
        "5": { class_type: "VAEDecode", inputs: {} },
        "6": { class_type: "SaveImage", inputs: {} }
      };

      expect(workflowContainsModelLoading(workflow)).toBe(true);

      const modelNodes = getModelLoadingNodes(workflow);
      expect(modelNodes).toHaveLength(2);
      expect(modelNodes.some((n) => n.nodeType === "CheckpointLoaderSimple")).toBe(true);
      expect(modelNodes.some((n) => n.nodeType === "VAEDecode")).toBe(true);

      const totalTime = estimateWorkflowModelLoadingTime(workflow, "ssd");
      expect(totalTime).toBeGreaterThan(0);

      const multiplier = getTimeoutMultiplierForModelLoading(workflow, false);
      expect(multiplier).toBe(2.0); // 2 model nodes
    });

    test("complex workflow with LoRA and ControlNet", () => {
      const workflow = {
        "1": { class_type: "CheckpointLoaderSimple", inputs: {} },
        "2": { class_type: "LoraLoader", inputs: {} },
        "3": { class_type: "LoraLoader", inputs: {} },
        "4": { class_type: "ControlNetLoader", inputs: {} },
        "5": { class_type: "VAELoader", inputs: {} },
        "6": { class_type: "KSampler", inputs: {} }
      };

      const modelNodes = getModelLoadingNodes(workflow);
      expect(modelNodes).toHaveLength(5);

      const multiplier = getTimeoutMultiplierForModelLoading(workflow, false);
      expect(multiplier).toBe(4.0); // 5+ model nodes
    });

    test("simple workflow without model loading", () => {
      const workflow = {
        "1": { class_type: "EmptyLatentImage", inputs: {} },
        "2": { class_type: "KSampler", inputs: {} },
        "3": { class_type: "SaveImage", inputs: {} }
      };

      expect(workflowContainsModelLoading(workflow)).toBe(false);
      expect(getModelLoadingNodes(workflow)).toEqual([]);
      expect(estimateWorkflowModelLoadingTime(workflow)).toBe(0);
      expect(getTimeoutMultiplierForModelLoading(workflow)).toBe(1.0);
    });
  });
});
