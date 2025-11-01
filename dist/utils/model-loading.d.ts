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
export declare const MODEL_LOADING_NODE_TYPES: readonly ["CheckpointLoaderSimple", "CheckpointLoader", "unCLIPCheckpointLoader", "VAELoader", "VAEDecode", "LoraLoader", "LoraLoaderModelOnly", "ControlNetLoader", "ControlNetApply", "ControlNetApplyAdvanced", "IPAdapterModelLoader", "IPAdapterApply", "CLIPLoader", "DualCLIPLoader", "CLIPVisionLoader", "UNETLoader", "DiffusersLoader", "StyleModelLoader", "UpscaleModelLoader", "GLIGENLoader", "PhotoMakerLoader", "InstantIDModelLoader", "AnimateDiffLoader", "ADE_AnimateDiffLoaderGen1", "ADE_AnimateDiffLoaderGen2", "FluxCheckpointLoader", "SD3CheckpointLoader", "comfy.sd1.CheckpointLoader", "comfy.sd2.CheckpointLoader", "comfy.sdxl.CheckpointLoader"];
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
export declare function isModelLoadingNode(nodeType: string): boolean;
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
export declare function workflowContainsModelLoading(workflow: object): boolean;
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
export declare function getModelLoadingNodes(workflow: object): Array<{
    nodeId: string;
    nodeType: string;
}>;
/**
 * Estimated cold start time multiplier for model loading nodes.
 * These are rough estimates based on typical hardware (HDD vs SSD, VRAM, etc.).
 */
export declare const MODEL_LOADING_TIME_ESTIMATES: {
    /** Checkpoint models (SD 1.5: ~2GB, SDXL: ~6GB, Flux: ~12GB+) */
    readonly checkpoint: {
        readonly hdd: 30000;
        readonly ssd: 10000;
        readonly nvme: 5000;
    };
    /** VAE models (~200-800MB) */
    readonly vae: {
        readonly hdd: 5000;
        readonly ssd: 2000;
        readonly nvme: 1000;
    };
    /** LoRA models (~50-200MB) */
    readonly lora: {
        readonly hdd: 3000;
        readonly ssd: 1000;
        readonly nvme: 500;
    };
    /** ControlNet models (~1-3GB) */
    readonly controlnet: {
        readonly hdd: 15000;
        readonly ssd: 5000;
        readonly nvme: 2500;
    };
    /** Other models (CLIP, upscale, etc.) */
    readonly other: {
        readonly hdd: 10000;
        readonly ssd: 3000;
        readonly nvme: 1500;
    };
};
/**
 * Storage type for estimating model loading times.
 */
export type StorageType = "hdd" | "ssd" | "nvme";
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
export declare function estimateModelLoadingTime(nodeType: string, storageType?: StorageType): number;
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
export declare function estimateWorkflowModelLoadingTime(workflow: object, storageType?: StorageType): number;
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
export declare function getTimeoutMultiplierForModelLoading(workflow: object, hasExecutedBefore?: boolean): number;
//# sourceMappingURL=model-loading.d.ts.map