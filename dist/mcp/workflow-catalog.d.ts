import { WorkflowMetadata, WorkflowSlotInfo, WorkflowValidationResult } from "./schemas.js";
export interface SidecarConfig {
    workflow?: string;
    slots?: Record<string, string>;
    outputs?: Record<string, string> | string[];
}
export declare class WorkflowCatalog {
    private directories;
    private cachedWorkflows;
    constructor(directories?: string[]);
    /**
     * Get all configured search directories
     */
    getDirectories(): string[];
    /**
     * Add a directory to the workflow search path
     */
    addDirectory(dir: string): void;
    /**
     * Scan all configured directories for JSON workflow files
     */
    scan(): Promise<WorkflowMetadata[]>;
    /**
     * Find a workflow by name (e.g. "sdxl", "sdxl.json") or direct filepath
     */
    getWorkflow(nameOrPath: string): Promise<WorkflowMetadata | null>;
    /**
     * Save a newly authored or modified workflow to the workflow storage directory
     */
    saveWorkflow(name: string, workflowJson: Record<string, any>, sidecarSlots?: Record<string, string>, overwrite?: boolean, targetDir?: string): Promise<WorkflowMetadata>;
    /**
     * Delete a workflow and its companion sidecar from storage
     */
    deleteWorkflow(name: string, targetDir?: string): Promise<boolean>;
    /**
     * Resolve a workflow input (string name/path or inline API JSON object)
     */
    resolveWorkflowJson(workflowInput: string | Record<string, any>): Promise<{
        name?: string;
        path?: string;
        workflowJson: Record<string, any>;
        slots: Record<string, WorkflowSlotInfo>;
        outputNodes: string[];
        structureHash?: string;
    }>;
    /**
     * Load and parse a workflow JSON file and its optional sidecar
     */
    private loadWorkflowFile;
    /**
     * Automatically detect common slots from API workflow JSON
     */
    detectSlots(workflow: Record<string, any>): Record<string, WorkflowSlotInfo>;
    /**
     * Detect terminal output nodes (images, videos, audio, 3D, files)
     */
    detectOutputNodes(workflow: Record<string, any>): string[];
    /**
     * Apply user input overrides to workflow JSON using slot names, node paths, or nested objects
     */
    applyOverrides(workflowJson: Record<string, any>, slots: Record<string, WorkflowSlotInfo>, inputs?: Record<string, any>): Record<string, any>;
    /**
     * Deep validation of workflow against live node definitions (/object_info)
     */
    validateWorkflow(workflowJson: Record<string, any>, nodeDefs: Record<string, any> | null): WorkflowValidationResult;
}
//# sourceMappingURL=workflow-catalog.d.ts.map