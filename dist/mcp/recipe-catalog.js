export const CANONICAL_RECIPES = [
    {
        id: "krea2_turbo",
        name: "Krea 2 Turbo (NVFP4 Photorealism)",
        description: "Ultra-photorealistic distilled diffusion pipeline using Krea 2 Turbo NVFP4, Qwen3-VL text encoder, layerwise attention rebalancing (ConditioningKrea2Rebalance), and beta57 schedule at CFG 1.0 (8 steps).",
        category: "image",
        distilled: true,
        requiredNodes: [
            "UNETLoader",
            "CLIPLoader",
            "VAELoader",
            "ConditioningKrea2Rebalance",
            "ConditioningZeroOut",
            "EmptyLatentImage",
            "KSampler",
            "VAEDecode",
            "SaveImage"
        ],
        modelRequirements: {
            unetPatterns: [/krea.*turbo.*nvfp4/i, /krea/i],
            clipPatterns: [/qwen3.*vl.*nvfp4/i, /qwen.*vl/i, /qwen/i],
            vaePatterns: [/krea.*vae/i, /vae/i]
        },
        defaultParams: {
            width: 1024,
            height: 1024,
            steps: 8,
            cfg: 1.0,
            sampler: "euler",
            scheduler: "beta57"
        },
        defaultSlots: {
            prompt: "54.inputs.text",
            seed: "56.inputs.seed",
            steps: "56.inputs.steps",
            cfg: "56.inputs.cfg"
        },
        buildGraph: (models, options) => {
            const prompt = options?.prompt || "ultra realistic photographic portrait, natural studio lighting, 8k resolution";
            const width = options?.width || 1024;
            const height = options?.height || 1024;
            const seed = options?.seed ?? Math.floor(Math.random() * 1000000000);
            return {
                "29": {
                    class_type: "SaveImage",
                    inputs: {
                        filename_prefix: "Krea2_turbo",
                        images: ["57", 0]
                    }
                },
                "54": {
                    class_type: "CLIPTextEncode",
                    inputs: {
                        text: prompt,
                        clip: ["74", 0]
                    }
                },
                "55": {
                    class_type: "EmptyLatentImage",
                    inputs: {
                        width,
                        height,
                        batch_size: 1
                    }
                },
                "56": {
                    class_type: "KSampler",
                    inputs: {
                        seed,
                        steps: 8,
                        cfg: 1.0,
                        sampler_name: "euler",
                        scheduler: "beta57",
                        denoise: 1.0,
                        model: ["58", 0],
                        positive: ["72", 0],
                        negative: ["59", 0],
                        latent_image: ["55", 0]
                    }
                },
                "57": {
                    class_type: "VAEDecode",
                    inputs: {
                        samples: ["56", 0],
                        vae: ["75", 0]
                    }
                },
                "58": {
                    class_type: "UNETLoader",
                    inputs: {
                        unet_name: models.unet || "krea2TurboOfficialComfy_krea2TurboNvfp4.safetensors",
                        weight_dtype: "default"
                    }
                },
                "59": {
                    class_type: "ConditioningZeroOut",
                    inputs: {
                        conditioning: ["54", 0]
                    }
                },
                "72": {
                    class_type: "ConditioningKrea2Rebalance",
                    inputs: {
                        multiplier: 3.0,
                        per_layer_weights: "1.0,1.0,1.0,1.0,1.0,1.0,1.0,2.5,5.0,1.1,4.0,1.0",
                        conditioning: ["54", 0]
                    }
                },
                "74": {
                    class_type: "CLIPLoader",
                    inputs: {
                        clip_name: models.clip || "qwen3_vl_4b_nvfp4_full.safetensors",
                        type: "krea2",
                        device: "default"
                    }
                },
                "75": {
                    class_type: "VAELoader",
                    inputs: {
                        vae_name: models.vae || "krea2RealVae_v10.safetensors"
                    }
                }
            };
        }
    },
    {
        id: "z_image_turbo",
        name: "Z-Image Turbo (NVFP4 Distilled Flow)",
        description: "High-contrast distilled flow pipeline using Z-Image Turbo NVFP4, ModelSamplingAuraFlow (shift: 3.0), Lumina2 Qwen text encoder, and res_multistep sampling at CFG 1.0 (8 steps).",
        category: "image",
        distilled: true,
        requiredNodes: [
            "UNETLoader",
            "ModelSamplingAuraFlow",
            "CLIPLoader",
            "VAELoader",
            "ConditioningZeroOut",
            "EmptySD3LatentImage",
            "KSampler",
            "VAEDecode",
            "SaveImage"
        ],
        modelRequirements: {
            unetPatterns: [/z_image.*turbo.*nvfp4/i, /z_image/i],
            clipPatterns: [/qwen_3_4b/i, /qwen.*vl/i, /qwen/i],
            vaePatterns: [/ae\.safetensors/i, /flux.*vae/i, /vae/i]
        },
        defaultParams: {
            width: 1024,
            height: 1024,
            steps: 8,
            cfg: 1.0,
            sampler: "res_multistep",
            scheduler: "simple"
        },
        defaultSlots: {
            prompt: "5.inputs.text",
            seed: "8.inputs.seed",
            steps: "8.inputs.steps",
            cfg: "8.inputs.cfg"
        },
        buildGraph: (models, options) => {
            const prompt = options?.prompt || "Dramatic studio portrait, high contrast chiaroscuro lighting, 8k resolution, raw photo";
            const width = options?.width || 1024;
            const height = options?.height || 1024;
            const seed = options?.seed ?? Math.floor(Math.random() * 1000000000);
            return {
                "1": {
                    class_type: "UNETLoader",
                    inputs: {
                        unet_name: models.unet || "z_image_turbo_nvfp4.safetensors",
                        weight_dtype: "default"
                    }
                },
                "2": {
                    class_type: "ModelSamplingAuraFlow",
                    inputs: {
                        shift: 3.0,
                        model: ["1", 0]
                    }
                },
                "3": {
                    class_type: "CLIPLoader",
                    inputs: {
                        clip_name: models.clip || "qwen_3_4b.safetensors",
                        type: "lumina2",
                        device: "default"
                    }
                },
                "4": {
                    class_type: "VAELoader",
                    inputs: {
                        vae_name: models.vae || "ae.safetensors"
                    }
                },
                "5": {
                    class_type: "CLIPTextEncode",
                    inputs: {
                        text: prompt,
                        clip: ["3", 0]
                    }
                },
                "6": {
                    class_type: "ConditioningZeroOut",
                    inputs: {
                        conditioning: ["5", 0]
                    }
                },
                "7": {
                    class_type: "EmptySD3LatentImage",
                    inputs: {
                        width,
                        height,
                        batch_size: 1
                    }
                },
                "8": {
                    class_type: "KSampler",
                    inputs: {
                        seed,
                        steps: 8,
                        cfg: 1.0,
                        sampler_name: "res_multistep",
                        scheduler: "simple",
                        denoise: 1.0,
                        model: ["2", 0],
                        positive: ["5", 0],
                        negative: ["6", 0],
                        latent_image: ["7", 0]
                    }
                },
                "9": {
                    class_type: "VAEDecode",
                    inputs: {
                        samples: ["8", 0],
                        vae: ["4", 0]
                    }
                },
                "10": {
                    class_type: "SaveImage",
                    inputs: {
                        filename_prefix: "z-image-turbo",
                        images: ["9", 0]
                    }
                }
            };
        }
    },
    {
        id: "sdxl_base",
        name: "SDXL Base (All-in-One Checkpoint)",
        description: "Standard Stable Diffusion XL base pipeline with integrated text encoders, VAE, and ancestral sampling at CFG 6.5 (20–30 steps).",
        category: "image",
        distilled: false,
        requiredNodes: [
            "CheckpointLoaderSimple",
            "CLIPTextEncode",
            "EmptyLatentImage",
            "KSampler",
            "VAEDecode",
            "SaveImage"
        ],
        modelRequirements: {
            checkpointPatterns: [/sd_xl_base/i, /oneObsession/i, /juggernaut.*xl/i, /xl/i, /safetensors/i]
        },
        defaultParams: {
            width: 1024,
            height: 1024,
            steps: 25,
            cfg: 6.5,
            sampler: "euler_ancestral",
            scheduler: "karras"
        },
        defaultSlots: {
            prompt: "6.inputs.text",
            negative_prompt: "7.inputs.text",
            seed: "3.inputs.seed",
            steps: "3.inputs.steps",
            cfg: "3.inputs.cfg",
            ckpt_name: "4.inputs.ckpt_name"
        },
        buildGraph: (models, options) => {
            const prompt = options?.prompt || "A stunning cinematic landscape, dramatic volumetric lighting, 8k resolution";
            const negativePrompt = options?.negativePrompt || "blurry, low quality, distorted, watermark";
            const width = options?.width || 1024;
            const height = options?.height || 1024;
            const seed = options?.seed ?? Math.floor(Math.random() * 1000000000);
            return {
                "3": {
                    class_type: "KSampler",
                    inputs: {
                        seed,
                        steps: 25,
                        cfg: 6.5,
                        sampler_name: "euler_ancestral",
                        scheduler: "karras",
                        denoise: 1.0,
                        model: ["4", 0],
                        positive: ["6", 0],
                        negative: ["7", 0],
                        latent_image: ["5", 0]
                    }
                },
                "4": {
                    class_type: "CheckpointLoaderSimple",
                    inputs: {
                        ckpt_name: models.checkpoint || "sd_xl_base_1.0.safetensors"
                    }
                },
                "5": {
                    class_type: "EmptyLatentImage",
                    inputs: {
                        width,
                        height,
                        batch_size: 1
                    }
                },
                "6": {
                    class_type: "CLIPTextEncode",
                    inputs: {
                        text: prompt,
                        clip: ["4", 1]
                    }
                },
                "7": {
                    class_type: "CLIPTextEncode",
                    inputs: {
                        text: negativePrompt,
                        clip: ["4", 1]
                    }
                },
                "8": {
                    class_type: "VAEDecode",
                    inputs: {
                        samples: ["3", 0],
                        vae: ["4", 2]
                    }
                },
                "9": {
                    class_type: "SaveImage",
                    inputs: {
                        filename_prefix: "SDXL_Output",
                        images: ["8", 0]
                    }
                }
            };
        }
    },
    {
        id: "flux_schnell",
        name: "Flux Schnell (4-Step Turbo)",
        description: "Fast 4-step distilled generation with Flux Schnell and DualCLIPLoader (CLIP-L + T5).",
        category: "image",
        distilled: true,
        requiredNodes: ["UNETLoader", "DualCLIPLoader", "VAELoader", "CLIPTextEncode", "EmptySD3LatentImage", "KSampler", "VAEDecode", "SaveImage"],
        modelRequirements: {
            unetPatterns: [/flux.*schnell/i, /flux/i],
            clipPatterns: [/t5/i, /clip.*l/i],
            vaePatterns: [/flux.*vae/i, /ae\.safetensors/i]
        },
        defaultParams: {
            width: 1024,
            height: 1024,
            steps: 4,
            cfg: 1.0,
            sampler: "euler",
            scheduler: "simple"
        },
        defaultSlots: {
            prompt: "6.inputs.text",
            seed: "3.inputs.seed"
        },
        buildGraph: (models, options) => {
            const prompt = options?.prompt || "A photorealistic portrait of an astronaut, vibrant colors, 8k resolution";
            const width = options?.width || 1024;
            const height = options?.height || 1024;
            const seed = options?.seed ?? Math.floor(Math.random() * 1000000000);
            return {
                "1": {
                    class_type: "UNETLoader",
                    inputs: {
                        unet_name: models.unet || "flux1-schnell.safetensors",
                        weight_dtype: "default"
                    }
                },
                "2": {
                    class_type: "DualCLIPLoader",
                    inputs: {
                        clip_name1: "clip_l.safetensors",
                        clip_name2: "t5xxl_fp8_e4m3fn.safetensors",
                        type: "flux"
                    }
                },
                "3": {
                    class_type: "VAELoader",
                    inputs: {
                        vae_name: models.vae || "ae.safetensors"
                    }
                },
                "6": {
                    class_type: "CLIPTextEncode",
                    inputs: {
                        text: prompt,
                        clip: ["2", 0]
                    }
                },
                "7": {
                    class_type: "ConditioningZeroOut",
                    inputs: {
                        conditioning: ["6", 0]
                    }
                },
                "5": {
                    class_type: "EmptySD3LatentImage",
                    inputs: {
                        width,
                        height,
                        batch_size: 1
                    }
                },
                "8": {
                    class_type: "KSampler",
                    inputs: {
                        seed,
                        steps: 4,
                        cfg: 1.0,
                        sampler_name: "euler",
                        scheduler: "simple",
                        denoise: 1.0,
                        model: ["1", 0],
                        positive: ["6", 0],
                        negative: ["7", 0],
                        latent_image: ["5", 0]
                    }
                },
                "9": {
                    class_type: "VAEDecode",
                    inputs: {
                        samples: ["8", 0],
                        vae: ["3", 0]
                    }
                },
                "10": {
                    class_type: "SaveImage",
                    inputs: {
                        filename_prefix: "Flux_Schnell",
                        images: ["9", 0]
                    }
                }
            };
        }
    }
];
export class RecipeCatalog {
    recipes = new Map();
    constructor(customRecipes = []) {
        for (const r of CANONICAL_RECIPES) {
            this.recipes.set(r.id, r);
        }
        for (const r of customRecipes) {
            this.recipes.set(r.id, r);
        }
    }
    /**
     * Helper to match available models against regex patterns
     */
    findMatchingModel(available, patterns) {
        if (!patterns || patterns.length === 0 || !available)
            return undefined;
        for (const pattern of patterns) {
            const match = available.find((m) => pattern.test(m));
            if (match)
                return match;
        }
        return undefined;
    }
    /**
     * Check if a recipe is runnable with the server's installed models
     */
    isRecipeRunnable(recipe, availableModels) {
        const missing = [];
        const resolved = {};
        if (recipe.modelRequirements.unetPatterns) {
            const unet = this.findMatchingModel(availableModels.unets, recipe.modelRequirements.unetPatterns);
            if (unet)
                resolved.unet = unet;
            else
                missing.push("UNET / Diffusion Model");
        }
        if (recipe.modelRequirements.checkpointPatterns) {
            const ckpt = this.findMatchingModel(availableModels.checkpoints, recipe.modelRequirements.checkpointPatterns);
            if (ckpt)
                resolved.checkpoint = ckpt;
            else
                missing.push("Checkpoint Model");
        }
        if (recipe.modelRequirements.clipPatterns) {
            const clip = this.findMatchingModel(availableModels.clips, recipe.modelRequirements.clipPatterns);
            if (clip)
                resolved.clip = clip;
            else
                missing.push("CLIP Text Encoder");
        }
        if (recipe.modelRequirements.vaePatterns) {
            const vae = this.findMatchingModel(availableModels.vaes, recipe.modelRequirements.vaePatterns);
            if (vae)
                resolved.vae = vae;
            else
                missing.push("VAE");
        }
        return {
            runnable: missing.length === 0,
            resolvedModels: resolved,
            missing
        };
    }
    /**
     * List recipes with status against installed models
     */
    list(availableModels, options) {
        const category = options?.category || "all";
        const installedOnly = options?.installedOnly ?? true;
        const results = [];
        for (const recipe of this.recipes.values()) {
            if (category !== "all" && recipe.category !== category)
                continue;
            const { runnable, resolvedModels, missing } = this.isRecipeRunnable(recipe, availableModels);
            if (installedOnly && !runnable)
                continue;
            results.push({
                id: recipe.id,
                name: recipe.name,
                description: recipe.description,
                category: recipe.category,
                distilled: recipe.distilled,
                isRunnable: runnable,
                resolvedModels,
                missingModels: missing,
                defaultParams: recipe.defaultParams,
                slots: Object.keys(recipe.defaultSlots)
            });
        }
        return {
            count: results.length,
            recipes: results
        };
    }
    /**
     * Scaffold a ready-to-run workflow graph for a given recipe
     */
    scaffold(recipeId, availableModels, input) {
        const recipe = this.recipes.get(recipeId);
        if (!recipe) {
            const availableIds = Array.from(this.recipes.keys()).join(", ");
            throw new Error(`Recipe '${recipeId}' not found. Available recipes: ${availableIds}`);
        }
        const { resolvedModels } = this.isRecipeRunnable(recipe, availableModels);
        const graph = recipe.buildGraph(resolvedModels, {
            prompt: input?.prompt,
            negativePrompt: input?.negativePrompt,
            width: input?.width,
            height: input?.height
        });
        return {
            recipe: recipe.id,
            workflow: graph,
            slots: recipe.defaultSlots,
            params: recipe.defaultParams
        };
    }
}
//# sourceMappingURL=recipe-catalog.js.map