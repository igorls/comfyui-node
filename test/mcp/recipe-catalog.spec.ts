import { describe, expect, test } from "bun:test";
import { RecipeCatalog } from "../../src/mcp/recipe-catalog.js";
import { WorkflowCatalog } from "../../src/mcp/workflow-catalog.js";

describe("RecipeCatalog", () => {
  const mockModels = {
    unets: ["krea2TurboOfficialComfy_krea2TurboNvfp4.safetensors", "z_image_turbo_nvfp4.safetensors", "flux1-schnell.safetensors"],
    checkpoints: ["sd_xl_base_1.0.safetensors", "oneObsession_v24.safetensors"],
    clips: ["qwen3_vl_4b_nvfp4_full.safetensors", "qwen_3_4b.safetensors", "t5xxl_fp8_e4m3fn.safetensors", "clip_l.safetensors"],
    vaes: ["krea2RealVae_v10.safetensors", "ae.safetensors"]
  };

  test("lists canonical recipes and matches installed models", () => {
    const catalog = new RecipeCatalog();
    const listResult = catalog.list(mockModels, { installedOnly: false });

    expect(listResult.count).toBeGreaterThanOrEqual(4);
    const recipeIds = listResult.recipes.map((r) => r.id);
    expect(recipeIds).toContain("krea2_turbo");
    expect(recipeIds).toContain("z_image_turbo");
    expect(recipeIds).toContain("sdxl_base");

    const krea2 = listResult.recipes.find((r) => r.id === "krea2_turbo")!;
    expect(krea2.isRunnable).toBe(true);
    expect(krea2.resolvedModels.unet).toBe("krea2TurboOfficialComfy_krea2TurboNvfp4.safetensors");
    expect(krea2.resolvedModels.clip).toBe("qwen3_vl_4b_nvfp4_full.safetensors");
    expect(krea2.resolvedModels.vae).toBe("krea2RealVae_v10.safetensors");
    expect(krea2.defaultParams.cfg).toBe(1.0);
    expect(krea2.defaultParams.steps).toBe(8);
  });

  test("scaffolds a valid krea2_turbo workflow graph", () => {
    const catalog = new RecipeCatalog();
    const scaffoldResult = catalog.scaffold("krea2_turbo", mockModels, {
      prompt: "an artistic photograph of a cat"
    });

    expect(scaffoldResult.recipe).toBe("krea2_turbo");
    expect(scaffoldResult.workflow).toBeDefined();
    expect(scaffoldResult.workflow["58"].inputs.unet_name).toBe("krea2TurboOfficialComfy_krea2TurboNvfp4.safetensors");
    expect(scaffoldResult.workflow["74"].inputs.clip_name).toBe("qwen3_vl_4b_nvfp4_full.safetensors");
    expect(scaffoldResult.workflow["75"].inputs.vae_name).toBe("krea2RealVae_v10.safetensors");
    expect(scaffoldResult.workflow["54"].inputs.text).toBe("an artistic photograph of a cat");
    expect(scaffoldResult.slots.prompt).toBe("54.inputs.text");

    const wfCatalog = new WorkflowCatalog([]);
    const validation = wfCatalog.validateWorkflow(scaffoldResult.workflow);
    expect(validation.valid).toBe(true);
    expect(validation.detectedOutputs).toContain("29");
  });

  test("scaffolds a valid z_image_turbo workflow graph", () => {
    const catalog = new RecipeCatalog();
    const scaffoldResult = catalog.scaffold("z_image_turbo", mockModels, {
      prompt: "high contrast portrait"
    });

    expect(scaffoldResult.recipe).toBe("z_image_turbo");
    expect(scaffoldResult.workflow["1"].inputs.unet_name).toBe("z_image_turbo_nvfp4.safetensors");
    expect(scaffoldResult.workflow["2"].class_type).toBe("ModelSamplingAuraFlow");
    expect(scaffoldResult.workflow["3"].inputs.clip_name).toBe("qwen_3_4b.safetensors");
    expect(scaffoldResult.workflow["4"].inputs.vae_name).toBe("ae.safetensors");

    const wfCatalog = new WorkflowCatalog([]);
    const validation = wfCatalog.validateWorkflow(scaffoldResult.workflow);
    expect(validation.valid).toBe(true);
    expect(validation.detectedOutputs).toContain("10");
  });

  test("scaffolds a valid sdxl_base workflow graph", () => {
    const catalog = new RecipeCatalog();
    const scaffoldResult = catalog.scaffold("sdxl_base", mockModels, {
      prompt: "cinematic landscape"
    });

    expect(scaffoldResult.recipe).toBe("sdxl_base");
    expect(scaffoldResult.workflow["4"].inputs.ckpt_name).toBe("sd_xl_base_1.0.safetensors");
    expect(scaffoldResult.workflow["6"].inputs.text).toBe("cinematic landscape");

    const wfCatalog = new WorkflowCatalog([]);
    const validation = wfCatalog.validateWorkflow(scaffoldResult.workflow);
    expect(validation.valid).toBe(true);
    expect(validation.detectedOutputs).toContain("9");
  });

  test("throws when scaffolding an unknown recipe", () => {
    const catalog = new RecipeCatalog();
    expect(() => catalog.scaffold("non_existent_recipe", mockModels)).toThrow(/not found/i);
  });
});
