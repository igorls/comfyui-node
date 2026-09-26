import { z } from "zod";

/**
 * Input schema for comfy_info tool
 */
export const ComfyInfoInputSchema = z.object({
  includeModels: z.boolean().optional().describe("Whether to include the full list of checkpoints and LoRAs (default: true)"),
  includeStats: z.boolean().optional().describe("Whether to include system RAM and device stats (default: true)")
});
export type ComfyInfoInput = z.infer<typeof ComfyInfoInputSchema>;

/**
 * Input schema for comfy_nodes tool (live node discovery & schema introspection)
 */
export const ComfyNodesInputSchema = z.object({
  query: z.string().optional().describe("Search query for node classes, display names, categories, or search aliases (e.g. 'sampler', 'hunyuan', 'video', 'lora', 'upscale')"),
  classType: z.string().optional().describe("Specific node class name to retrieve complete pin schema, input/output types, defaults, and wiring rules (e.g. 'KSampler', 'CheckpointLoaderSimple')"),
  category: z.string().optional().describe("Filter nodes by category path (e.g. 'sampling', 'loaders', 'conditioning', 'image', 'audio', '3d', 'latent')"),
  outputOnly: z.boolean().optional().describe("Filter to only terminal output nodes that save/preview media (e.g. SaveImage, VHS_VideoCombine, SaveAudio, SaveGLTF)"),
  limit: z.number().int().min(1).max(200).optional().default(50).describe("Maximum number of search results to return (default: 50)")
});
export type ComfyNodesInput = z.infer<typeof ComfyNodesInputSchema>;

/**
 * Input schema for comfy_recipes tool (curated canonical architecture recipes & scaffolding)
 */
export const ComfyRecipesInputSchema = z.object({
  action: z.enum(["list", "scaffold"]).optional().default("list").describe("Action to perform: 'list' (discover curated recipes matching installed models) or 'scaffold' (generate a validated workflow graph)"),
  recipe: z.string().optional().describe("Recipe ID to scaffold (e.g. 'krea2_turbo', 'z_image_turbo', 'sdxl_base', 'flux_dev', 'wan2_1_video', 'ltxv_video')"),
  category: z.enum(["all", "image", "video", "audio", "3d"]).optional().default("all").describe("Filter recipes by media category (default: 'all')"),
  installedOnly: z.boolean().optional().default(true).describe("Filter recipes to only those whose required models are installed on the target ComfyUI server (default: true)"),
  prompt: z.string().optional().describe("Initial prompt to embed in the scaffolded workflow"),
  negativePrompt: z.string().optional().describe("Initial negative prompt to embed in the scaffolded workflow"),
  width: z.number().int().optional().describe("Image/video width (defaults to recipe standard)"),
  height: z.number().int().optional().describe("Image/video height (defaults to recipe standard)"),
  saveName: z.string().optional().describe("If provided, automatically saves the scaffolded workflow into storage with this filename (e.g. 'my_krea2.json')"),
  overwrite: z.boolean().optional().default(false).describe("Whether to overwrite an existing workflow file when saveName is provided (default: false)")
});
export type ComfyRecipesInput = z.infer<typeof ComfyRecipesInputSchema>;

/**
 * Input schema for comfy_validate tool
 */
export const ComfyValidateInputSchema = z.object({
  workflow: z.union([z.string(), z.record(z.string(), z.any())]).describe("Workflow name/path or raw API workflow JSON object to validate against live server node definitions")
});
export type ComfyValidateInput = z.infer<typeof ComfyValidateInputSchema>;

/**
 * Input schema for comfy_workflows tool (list, inspect, save, delete)
 */
export const ComfyWorkflowsInputSchema = z.object({
  action: z.enum(["list", "inspect", "save", "delete"]).optional().default("list").describe("Action to perform: 'list' (all workflows), 'inspect' (detailed slots & node graph), 'save' (persist workflow to storage), 'delete' (remove workflow)"),
  workflow: z.union([z.string(), z.record(z.string(), z.any())]).optional().describe("Workflow name/path to inspect, or raw API workflow JSON object to save"),
  name: z.string().optional().describe("Workflow filename or ID (e.g. 'my_sdxl_workflow.json') when saving or deleting"),
  dir: z.string().optional().describe("Specific workflow directory to search or save into (defaults to primary configured storage directory)"),
  slots: z.record(z.string(), z.string()).optional().describe("Optional friendly slot mapping to persist with sidecar (e.g. { 'prompt': '6.inputs.text', 'seed': '3.seed' })"),
  overwrite: z.boolean().optional().default(false).describe("Whether to overwrite an existing workflow file when action is 'save' (default: false)")
});
export type ComfyWorkflowsInput = z.infer<typeof ComfyWorkflowsInputSchema>;

/**
 * Input schema for comfy_generate tool
 */
export const ComfyGenerateInputSchema = z.object({
  workflow: z.union([z.string(), z.record(z.string(), z.any())]).describe("Workflow name/path from catalog, or raw API workflow JSON object"),
  inputs: z.record(z.string(), z.any()).optional().describe("Input overrides by friendly slot name (e.g. prompt, seed, width) or direct node path (e.g. 6.inputs.text or 6.text)"),
  count: z.number().int().min(1).max(10).optional().default(1).describe("Number of candidate variations to generate with varying seeds (default: 1, max: 10)"),
  seed: z.number().int().optional().describe("Base seed to use for generation (defaults to random)"),
  seedPolicy: z.enum(["random", "fixed", "sequential"]).optional().default("random").describe("Seed policy when count > 1 (random, fixed, sequential)"),
  images: z.record(z.string(), z.string()).optional().describe("Map of node ID or slot name to local image file paths to attach and upload"),
  outputNodes: z.array(z.string()).optional().describe("Optional specific output node IDs or aliases to collect"),
  wait: z.boolean().optional().default(true).describe("Whether to wait for execution to complete before returning (default: true)"),
  timeoutMs: z.number().int().min(1000).optional().default(120000).describe("Timeout in milliseconds when waiting for completion (default: 120000)")
});
export type ComfyGenerateInput = z.infer<typeof ComfyGenerateInputSchema>;

/**
 * Crop region specification
 */
export const CropBoundsSchema = z.object({
  x: z.number().min(0).describe("Left offset (pixels or 0.0-1.0 normalized)"),
  y: z.number().min(0).describe("Top offset (pixels or 0.0-1.0 normalized)"),
  width: z.number().positive().describe("Crop width (pixels or 0.0-1.0 normalized)"),
  height: z.number().positive().describe("Crop height (pixels or 0.0-1.0 normalized)"),
  normalized: z.boolean().optional().describe("Whether coordinates are normalized between 0.0 and 1.0 (default: auto-detected if all <= 1.0)")
});
export type CropBounds = z.infer<typeof CropBoundsSchema>;

/**
 * Input schema for comfy_inspect tool
 */
export const ComfyInspectInputSchema = z.object({
  runId: z.string().describe("Run ID or prompt ID to inspect"),
  candidateIndex: z.number().int().min(0).optional().default(0).describe("Index of the candidate to inspect (0-based, default: 0)"),
  mode: z.enum(["contact_sheet", "image", "crop", "compare", "original"]).optional().describe("Inspection mode: 'contact_sheet' (labeled grid of all candidates), 'image' (single candidate), 'crop' (sub-region), 'compare' (side-by-side with previous run), 'original' (local path + metadata)"),
  crop: CropBoundsSchema.optional().describe("Crop bounds if mode is 'crop'"),
  compareRunId: z.string().optional().describe("Run ID of the previous generation to compare against (used when mode is 'compare', defaults to parent run)"),
  maxDimension: z.number().int().min(256).max(4096).optional().default(1024).describe("Maximum bounded width/height for review image (default: 1024)"),
  format: z.enum(["jpeg", "png", "webp"]).optional().default("jpeg").describe("Image format for review rendition (default: jpeg)")
});
export type ComfyInspectInput = z.infer<typeof ComfyInspectInputSchema>;

/**
 * Input schema for comfy_revise tool
 */
export const ComfyReviseInputSchema = z.object({
  runId: z.string().describe("Parent run ID to revise"),
  prompt: z.string().optional().describe("Updated positive prompt text"),
  negativePrompt: z.string().optional().describe("Updated negative prompt text"),
  inputs: z.record(z.string(), z.any()).optional().describe("Additional slot or node input overrides"),
  seedPolicy: z.union([z.enum(["keep", "new"]), z.number().int()]).optional().default("new").describe("Seed policy: 'new' (randomize), 'keep' (re-use parent seed), or specific seed number"),
  count: z.number().int().min(1).max(10).optional().default(1).describe("Number of candidate variations to generate (default: 1)"),
  note: z.string().optional().describe("Optional note explaining the revision intention for provenance"),
  wait: z.boolean().optional().default(true).describe("Whether to wait for execution to complete before returning (default: true)"),
  timeoutMs: z.number().int().min(1000).optional().default(120000).describe("Timeout in milliseconds when waiting for completion (default: 120000)")
});
export type ComfyReviseInput = z.infer<typeof ComfyReviseInputSchema>;

/**
 * Input schema for comfy_job tool
 */
export const ComfyJobInputSchema = z.object({
  runId: z.string().describe("Run ID or ComfyUI prompt ID"),
  action: z.enum(["status", "wait", "cancel"]).optional().default("status").describe("Action to perform on the job (status, wait, cancel)"),
  timeoutMs: z.number().int().min(500).optional().default(30000).describe("Timeout in milliseconds when action is 'wait' (default: 30000)")
});
export type ComfyJobInput = z.infer<typeof ComfyJobInputSchema>;

/**
 * Media type categorization for generated artifacts
 */
export type MediaType = "image" | "video" | "audio" | "3d" | "file";

/**
 * Internal candidate artifact record supporting multi-modal outputs
 */
export interface CandidateArtifact {
  index: number;
  promptId: string;
  nodeId: string;
  filename: string;
  subfolder?: string;
  type?: string;
  mediaType: MediaType;
  url?: string;
  localPath?: string;
  seed?: number;
  imageBuffer?: Buffer;
  mimeType?: string;
  width?: number;
  height?: number;
  fileSize?: number;
  format?: string;
}

/**
 * Internal run record tracking generation session state and lineage
 */
export interface RunRecord {
  runId: string;
  parentRunId?: string;
  promptIds: string[];
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  workflow: Record<string, any>;
  workflowName?: string;
  structureHash?: string;
  appliedInputs: Record<string, any>;
  seedPolicy?: string | number;
  seeds: number[];
  candidates: CandidateArtifact[];
  error?: string;
  progress?: {
    value: number;
    max: number;
    pct: number;
    node?: string;
  };
  createdAt: number;
  completedAt?: number;
  note?: string;
}

/**
 * Workflow slot description
 */
export interface WorkflowSlotInfo {
  slot: string;
  nodeId: string;
  inputName: string;
  currentValue?: any;
  nodeClassType?: string;
}

/**
 * Discovered workflow metadata
 */
export interface WorkflowMetadata {
  name: string;
  path: string;
  structureHash?: string;
  slots: Record<string, WorkflowSlotInfo>;
  outputNodes: string[];
  rawWorkflow: Record<string, any>;
}

/**
 * Structured workflow validation result
 */
export interface WorkflowValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  detectedOutputs: string[];
  slots: Record<string, WorkflowSlotInfo>;
  repairSuggestions: string[];
}
