import { ComfyApi } from "../client.js";
import { ComfyGenerateInput, ComfyInfoInput, ComfyInspectInput, ComfyJobInput, ComfyNodesInput, ComfyRecipesInput, ComfyReviseInput, ComfyValidateInput, ComfyWorkflowsInput, RunRecord, WorkflowValidationResult } from "./schemas.js";
import { WorkflowCatalog } from "./workflow-catalog.js";
import { AvailableModels, RecipeCatalog } from "./recipe-catalog.js";
export type ComfyInspectOptions = Partial<ComfyInspectInput> & {
    runId: string;
};
export declare class McpGenerationSession {
    private client;
    private catalog;
    private recipeCatalog;
    private runs;
    private promptToRunId;
    private cachedNodeDefs;
    private cachedNodeDefsTime;
    constructor(client: ComfyApi, catalog: WorkflowCatalog, recipeCatalog?: RecipeCatalog);
    getClient(): ComfyApi;
    getCatalog(): WorkflowCatalog;
    getRecipeCatalog(): RecipeCatalog;
    getRun(runOrPromptId: string): RunRecord | undefined;
    getAllRuns(): RunRecord[];
    /**
     * Ensure WebSocket connection is initialized
     */
    private ensureConnected;
    /**
     * Retrieve cached or fresh /object_info node definitions
     *
     * The 1.5s timeout previously raced a ~30s /object_info response on real servers,
     * making live validation silently degrade to schema-less mode on every cold call.
     * 45s tolerates slow servers (measured: ~30s for 3113 nodes over Docker); results
     * are cached for 60s either way, so the cost is paid once per minute at most.
     */
    getNodeDefs(forceRefresh?: boolean): Promise<Record<string, any> | null>;
    /**
     * Helper to retrieve installed model names across checkpoints, unets, clips, and vaes
     */
    getAvailableModels(): Promise<AvailableModels>;
    /**
     * comfy_info: Retrieve server state, queue, models, workflows, and runnable recipes
     */
    getInfo(input?: ComfyInfoInput): Promise<Record<string, any>>;
    /**
     * comfy_recipes: Canonical recipe discovery & dynamic scaffolding
     */
    manageRecipes(input: ComfyRecipesInput): Promise<Record<string, any>>;
    /**
     * comfy_nodes: Live node search and pin schema query for building workflows
     */
    searchNodes(input: ComfyNodesInput): Promise<Record<string, any>>;
    /**
     * comfy_validate: Deep validation of arbitrary workflow graph JSON
     */
    validateWorkflow(input: ComfyValidateInput): Promise<WorkflowValidationResult>;
    /**
     * comfy_workflows: Manage workflows (list, inspect, save, delete)
     */
    manageWorkflows(input: ComfyWorkflowsInput): Promise<Record<string, any>>;
    /**
     * comfy_generate: Prepare, validate, and execute a workflow
     */
    generate(input: ComfyGenerateInput, onProgress?: (progress: number, total: number, message?: string) => void): Promise<RunRecord>;
    /**
     * Extract multi-modal output artifacts (images, video, audio, 3D, text) and buffer data
     */
    private extractAndStoreCandidates;
    /**
     * comfy_revise: Create a child run branched from a parent run with targeted revisions
     */
    revise(input: ComfyReviseInput, onProgress?: (progress: number, total: number, message?: string) => void): Promise<RunRecord>;
    /**
     * comfy_job: Query, wait, or cancel a run
     */
    job(input: ComfyJobInput): Promise<RunRecord>;
    /**
     * comfy_inspect: Generate review images (contact sheet, single image, crop, comparison)
     */
    inspect(input: ComfyInspectOptions): Promise<{
        imageContent?: {
            type: "image";
            data: string;
            mimeType: string;
        };
        metadata: Record<string, any>;
    }>;
    /**
     * Helper: Ensure candidate image buffers are loaded from ComfyUI history/file APIs
     */
    private ensureCandidateBuffers;
}
//# sourceMappingURL=generation-session.d.ts.map