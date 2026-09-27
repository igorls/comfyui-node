import { z } from "zod";
/**
 * Input schema for comfy_info tool
 */
export declare const ComfyInfoInputSchema: z.ZodObject<{
    includeModels: z.ZodOptional<z.ZodBoolean>;
    includeStats: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type ComfyInfoInput = z.infer<typeof ComfyInfoInputSchema>;
/**
 * Input schema for comfy_nodes tool (live node discovery & schema introspection)
 */
export declare const ComfyNodesInputSchema: z.ZodObject<{
    query: z.ZodOptional<z.ZodString>;
    classType: z.ZodOptional<z.ZodString>;
    category: z.ZodOptional<z.ZodString>;
    outputOnly: z.ZodOptional<z.ZodBoolean>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
}, z.core.$strip>;
export type ComfyNodesInput = z.infer<typeof ComfyNodesInputSchema>;
/**
 * Input schema for comfy_recipes tool (curated canonical architecture recipes & scaffolding)
 */
export declare const ComfyRecipesInputSchema: z.ZodObject<{
    action: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        list: "list";
        scaffold: "scaffold";
    }>>>;
    recipe: z.ZodOptional<z.ZodString>;
    category: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        video: "video";
        audio: "audio";
        image: "image";
        all: "all";
        "3d": "3d";
    }>>>;
    installedOnly: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    prompt: z.ZodOptional<z.ZodString>;
    negativePrompt: z.ZodOptional<z.ZodString>;
    width: z.ZodOptional<z.ZodNumber>;
    height: z.ZodOptional<z.ZodNumber>;
    saveName: z.ZodOptional<z.ZodString>;
    overwrite: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, z.core.$strip>;
export type ComfyRecipesInput = z.infer<typeof ComfyRecipesInputSchema>;
/**
 * Input schema for comfy_validate tool
 */
export declare const ComfyValidateInputSchema: z.ZodObject<{
    workflow: z.ZodUnion<readonly [z.ZodString, z.ZodRecord<z.ZodString, z.ZodAny>]>;
}, z.core.$strip>;
export type ComfyValidateInput = z.infer<typeof ComfyValidateInputSchema>;
/**
 * Input schema for comfy_workflows tool (list, inspect, save, delete)
 */
export declare const ComfyWorkflowsInputSchema: z.ZodObject<{
    action: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        list: "list";
        inspect: "inspect";
        save: "save";
        delete: "delete";
    }>>>;
    workflow: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodRecord<z.ZodString, z.ZodAny>]>>;
    name: z.ZodOptional<z.ZodString>;
    dir: z.ZodOptional<z.ZodString>;
    slots: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    overwrite: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, z.core.$strip>;
export type ComfyWorkflowsInput = z.infer<typeof ComfyWorkflowsInputSchema>;
/**
 * Input schema for comfy_generate tool
 */
export declare const ComfyGenerateInputSchema: z.ZodObject<{
    workflow: z.ZodUnion<readonly [z.ZodString, z.ZodRecord<z.ZodString, z.ZodAny>]>;
    inputs: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    count: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    seed: z.ZodOptional<z.ZodNumber>;
    seedPolicy: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        fixed: "fixed";
        random: "random";
        sequential: "sequential";
    }>>>;
    images: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    outputNodes: z.ZodOptional<z.ZodArray<z.ZodString>>;
    wait: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    timeoutMs: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
}, z.core.$strip>;
export type ComfyGenerateInput = z.infer<typeof ComfyGenerateInputSchema>;
/**
 * Crop region specification
 */
export declare const CropBoundsSchema: z.ZodObject<{
    x: z.ZodNumber;
    y: z.ZodNumber;
    width: z.ZodNumber;
    height: z.ZodNumber;
    normalized: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type CropBounds = z.infer<typeof CropBoundsSchema>;
/**
 * Input schema for comfy_inspect tool
 */
export declare const ComfyInspectInputSchema: z.ZodObject<{
    runId: z.ZodString;
    candidateIndex: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    mode: z.ZodOptional<z.ZodEnum<{
        image: "image";
        contact_sheet: "contact_sheet";
        crop: "crop";
        compare: "compare";
        original: "original";
    }>>;
    crop: z.ZodOptional<z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        width: z.ZodNumber;
        height: z.ZodNumber;
        normalized: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    compareRunId: z.ZodOptional<z.ZodString>;
    maxDimension: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    format: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        jpeg: "jpeg";
        png: "png";
        webp: "webp";
    }>>>;
}, z.core.$strip>;
export type ComfyInspectInput = z.infer<typeof ComfyInspectInputSchema>;
/**
 * Input schema for comfy_revise tool
 */
export declare const ComfyReviseInputSchema: z.ZodObject<{
    runId: z.ZodString;
    prompt: z.ZodOptional<z.ZodString>;
    negativePrompt: z.ZodOptional<z.ZodString>;
    inputs: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    seedPolicy: z.ZodDefault<z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
        keep: "keep";
        new: "new";
    }>, z.ZodNumber]>>>;
    count: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    note: z.ZodOptional<z.ZodString>;
    wait: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    timeoutMs: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
}, z.core.$strip>;
export type ComfyReviseInput = z.infer<typeof ComfyReviseInputSchema>;
/**
 * Input schema for comfy_job tool
 */
export declare const ComfyJobInputSchema: z.ZodObject<{
    runId: z.ZodString;
    action: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        status: "status";
        cancel: "cancel";
        wait: "wait";
    }>>>;
    timeoutMs: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
}, z.core.$strip>;
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
//# sourceMappingURL=schemas.d.ts.map