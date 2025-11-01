/**
 * Model loading detection utilities.
 *
 * These utilities help identify when ComfyUI is loading models (a typically slow operation)
 * vs. executing standard workflow nodes. This is useful for applying adaptive timeouts
 * and providing better progress feedback to users.
 */
/**
 * List of node types that typically load models from disk.
 * These operations can be very slow on first execution (cold start).
 */
export const MODEL_LOADING_NODE_TYPES = [
    // Checkpoint loaders
    "CheckpointLoaderSimple",
    "CheckpointLoader",
    "unCLIPCheckpointLoader",
    // VAE loaders
    "VAELoader",
    "VAEDecode",
    // LoRA loaders
    "LoraLoader",
    "LoraLoaderModelOnly",
    // ControlNet loaders
    "ControlNetLoader",
    "ControlNetApply",
    "ControlNetApplyAdvanced",
    // IP-Adapter loaders
    "IPAdapterModelLoader",
    "IPAdapterApply",
    // CLIP loaders
    "CLIPLoader",
    "DualCLIPLoader",
    "CLIPVisionLoader",
    // UNET loaders
    "UNETLoader",
    // Diffusion model loaders
    "DiffusersLoader",
    // Style model loaders
    "StyleModelLoader",
    // Upscale model loaders
    "UpscaleModelLoader",
    // GLIGEN loaders
    "GLIGENLoader",
    // PhotoMaker loaders
    "PhotoMakerLoader",
    // InstantID loaders
    "InstantIDModelLoader",
    // AnimateDiff loaders
    "AnimateDiffLoader",
    "ADE_AnimateDiffLoaderGen1",
    "ADE_AnimateDiffLoaderGen2",
    // Flux loaders
    "FluxCheckpointLoader",
    // SD3 loaders
    "SD3CheckpointLoader",
    // Common custom node loaders
    "comfy.sd1.CheckpointLoader",
    "comfy.sd2.CheckpointLoader",
    "comfy.sdxl.CheckpointLoader",
];
/**
 * Check if a node type is a model loading node.
 * Model loading nodes typically have longer execution times on first run
 * due to loading large files from disk into memory.
 *
 * @param nodeType - The class_type of the node to check
 * @returns true if the node is known to load models from disk
 *
 * @example
 * ```ts
 * if (isModelLoadingNode("CheckpointLoaderSimple")) {
 *   console.log("This node will load a checkpoint - may take a while!");
 * }
 * ```
 */
export function isModelLoadingNode(nodeType) {
    return MODEL_LOADING_NODE_TYPES.includes(nodeType);
}
/**
 * Check if a workflow contains any model loading nodes.
 * Useful for determining if a workflow might have a slow cold start.
 *
 * @param workflow - The workflow JSON object
 * @returns true if the workflow contains at least one model loading node
 *
 * @example
 * ```ts
 * const workflow = { ... };
 * if (workflowContainsModelLoading(workflow)) {
 *   console.log("First execution may be slow due to model loading");
 * }
 * ```
 */
export function workflowContainsModelLoading(workflow) {
    const nodes = Object.values(workflow);
    for (const node of nodes) {
        if (typeof node === "object" && node !== null) {
            const classType = node.class_type;
            if (classType && isModelLoadingNode(classType)) {
                return true;
            }
        }
    }
    return false;
}
/**
 * Extract all model loading nodes from a workflow.
 * Returns an array of node IDs and their types.
 *
 * @param workflow - The workflow JSON object
 * @returns Array of objects containing nodeId and nodeType for each model loading node
 *
 * @example
 * ```ts
 * const modelNodes = getModelLoadingNodes(workflow);
 * console.log(`Found ${modelNodes.length} model loading nodes:`);
 * modelNodes.forEach(({ nodeId, nodeType }) => {
 *   console.log(`  - ${nodeId}: ${nodeType}`);
 * });
 * ```
 */
export function getModelLoadingNodes(workflow) {
    const modelNodes = [];
    for (const [nodeId, node] of Object.entries(workflow)) {
        if (typeof node === "object" && node !== null) {
            const classType = node.class_type;
            if (classType && isModelLoadingNode(classType)) {
                modelNodes.push({ nodeId, nodeType: classType });
            }
        }
    }
    return modelNodes;
}
/**
 * Estimated cold start time multiplier for model loading nodes.
 * These are rough estimates based on typical hardware (HDD vs SSD, VRAM, etc.).
 */
export const MODEL_LOADING_TIME_ESTIMATES = {
    /** Checkpoint models (SD 1.5: ~2GB, SDXL: ~6GB, Flux: ~12GB+) */
    checkpoint: {
        hdd: 30000, // 30 seconds on HDD
        ssd: 10000, // 10 seconds on SSD
        nvme: 5000, // 5 seconds on NVMe
    },
    /** VAE models (~200-800MB) */
    vae: {
        hdd: 5000, // 5 seconds on HDD
        ssd: 2000, // 2 seconds on SSD
        nvme: 1000, // 1 second on NVMe
    },
    /** LoRA models (~50-200MB) */
    lora: {
        hdd: 3000, // 3 seconds on HDD
        ssd: 1000, // 1 second on SSD
        nvme: 500, // 0.5 seconds on NVMe
    },
    /** ControlNet models (~1-3GB) */
    controlnet: {
        hdd: 15000, // 15 seconds on HDD
        ssd: 5000, // 5 seconds on SSD
        nvme: 2500, // 2.5 seconds on NVMe
    },
    /** Other models (CLIP, upscale, etc.) */
    other: {
        hdd: 10000, // 10 seconds on HDD
        ssd: 3000, // 3 seconds on SSD
        nvme: 1500, // 1.5 seconds on NVMe
    },
};
/**
 * Estimate the model loading time for a node type.
 * This is a rough estimate and actual times may vary significantly based on:
 * - Storage type and speed
 * - Model size
 * - Available VRAM
 * - System memory
 * - CPU performance
 *
 * @param nodeType - The class_type of the node
 * @param storageType - The type of storage (defaults to "ssd")
 * @returns Estimated loading time in milliseconds, or 0 if not a model loading node
 *
 * @example
 * ```ts
 * const estimatedTime = estimateModelLoadingTime("CheckpointLoaderSimple", "nvme");
 * console.log(`Estimated loading time: ${estimatedTime}ms`);
 * ```
 */
export function estimateModelLoadingTime(nodeType, storageType = "ssd") {
    if (!isModelLoadingNode(nodeType)) {
        return 0;
    }
    const lower = nodeType.toLowerCase();
    // Checkpoint loaders
    if (lower.includes("checkpoint")) {
        return MODEL_LOADING_TIME_ESTIMATES.checkpoint[storageType];
    }
    // VAE loaders
    if (lower.includes("vae")) {
        return MODEL_LOADING_TIME_ESTIMATES.vae[storageType];
    }
    // LoRA loaders
    if (lower.includes("lora")) {
        return MODEL_LOADING_TIME_ESTIMATES.lora[storageType];
    }
    // ControlNet loaders
    if (lower.includes("controlnet")) {
        return MODEL_LOADING_TIME_ESTIMATES.controlnet[storageType];
    }
    // Default to "other" category
    return MODEL_LOADING_TIME_ESTIMATES.other[storageType];
}
/**
 * Calculate the total estimated model loading time for a workflow.
 * This assumes all models need to be loaded from disk (cold start).
 * On subsequent runs, models may be cached in VRAM/RAM.
 *
 * @param workflow - The workflow JSON object
 * @param storageType - The type of storage (defaults to "ssd")
 * @returns Total estimated loading time in milliseconds
 *
 * @example
 * ```ts
 * const totalTime = estimateWorkflowModelLoadingTime(workflow, "nvme");
 * console.log(`Estimated cold start time: ${totalTime / 1000}s`);
 * ```
 */
export function estimateWorkflowModelLoadingTime(workflow, storageType = "ssd") {
    const modelNodes = getModelLoadingNodes(workflow);
    let totalTime = 0;
    for (const { nodeType } of modelNodes) {
        totalTime += estimateModelLoadingTime(nodeType, storageType);
    }
    return totalTime;
}
/**
 * Determine if a timeout should be extended for first execution based on model loading.
 * Returns a recommended timeout multiplier.
 *
 * @param workflow - The workflow JSON object
 * @param hasExecutedBefore - Whether this workflow has been executed before on this client
 * @returns Recommended timeout multiplier (1.0 = no change, 2.0 = double timeout, etc.)
 *
 * @example
 * ```ts
 * const baseTimeout = 60000; // 1 minute
 * const multiplier = getTimeoutMultiplierForModelLoading(workflow, false);
 * const adjustedTimeout = baseTimeout * multiplier;
 * console.log(`Using timeout: ${adjustedTimeout}ms (${multiplier}x base)`);
 * ```
 */
export function getTimeoutMultiplierForModelLoading(workflow, hasExecutedBefore = false) {
    // If already executed, models are likely cached
    if (hasExecutedBefore) {
        return 1.0;
    }
    const modelNodes = getModelLoadingNodes(workflow);
    // No model loading nodes
    if (modelNodes.length === 0) {
        return 1.0;
    }
    // 1-2 model nodes: 2x timeout
    if (modelNodes.length <= 2) {
        return 2.0;
    }
    // 3-4 model nodes: 3x timeout
    if (modelNodes.length <= 4) {
        return 3.0;
    }
    // 5+ model nodes: 4x timeout (very heavy workflow)
    return 4.0;
}
//# sourceMappingURL=model-loading.js.map