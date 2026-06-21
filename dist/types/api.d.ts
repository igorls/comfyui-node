export declare enum OSType {
    /**
     * Unix-like operating systems
     */
    POSIX = "posix",
    /**
     * Windows operating systems
     */
    NT = "nt",
    /**
     * Java virtual machine
     */
    JAVA = "java"
}
export interface BasicCredentials {
    type: "basic";
    username: string;
    password: string;
}
export interface BearerTokenCredentials {
    type: "bearer_token";
    token: string;
}
export interface CustomCredentials {
    type: "custom";
    headers: Record<string, string>;
}
export interface HistoryResponse {
    [key: string]: HistoryEntry;
}
export interface HistoryEntry {
    prompt: PromptData;
    outputs: OutputData;
    status: StatusData;
}
export interface PromptData {
    [index: number]: number | string | NodeData | MetadataData;
}
export interface NodeData {
    [key: string]: {
        inputs: {
            [key: string]: any;
        };
        class_type: string;
        _meta: {
            title: string;
        };
    };
}
export interface MetadataData {
    [key: string]: any;
}
export interface ImageInfo {
    name?: string;
    filename: string;
    subfolder?: string;
    type: string;
    width?: number;
    height?: number;
    format?: string;
    mime_type?: string;
    asset_id?: string;
    asset?: AssetReference;
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
}
export interface OutputData {
    [key: string]: {
        width?: number[];
        height?: number[];
        ratio?: number[];
        images?: ImageInfo[];
        video?: ImageInfo[];
        audio?: ImageInfo[];
        files?: ImageInfo[];
        [key: string]: unknown;
    };
}
export interface StatusData {
    status_str: string;
    completed: boolean;
    messages: [string, {
        [key: string]: any;
    }][];
}
export interface QueueResponse {
    queue_running: QueueItem[];
    queue_pending: QueueItem[];
}
export interface QueueItem {
    [index: number]: number | string | NodeData | MetadataData;
}
export interface QueuePromptResponse {
    prompt_id: string;
    number: number;
    node_errors: {
        [key: string]: any;
    };
}
export interface SystemStatsResponse {
    system: {
        os: OSType;
        ram_total: number;
        ram_free: number;
        comfyui_version: string;
        required_frontend_version: string;
        installed_templates_version: string;
        required_templates_version: string;
        python_version: string;
        pytorch_version: string;
        embedded_python: boolean;
        argv: string[];
    };
    devices: DeviceStats[];
}
export interface DeviceStats {
    name: string;
    type: string;
    index: number;
    vram_total: number;
    vram_free: number;
    torch_vram_total: number;
    torch_vram_free: number;
}
export interface QueueStatus {
    exec_info: {
        queue_remaining: number;
    };
}
export interface NodeDefsResponse {
    [key: string]: NodeDef;
}
export interface NodeInputConfig {
    default?: unknown;
    min?: number;
    max?: number;
    step?: number;
    round?: number;
    tooltip?: string;
    multiline?: boolean;
    dynamicPrompts?: boolean;
    control_after_generate?: boolean | string;
    image_upload?: boolean;
    forceInput?: boolean;
    rawLink?: boolean;
    lazy?: boolean;
    [key: string]: unknown;
}
export type NodeInputType = string | string[];
export type NodeInputSpec = NodeInputType | [NodeInputType, NodeInputConfig];
export interface NodeDef {
    input: {
        required: {
            [key: string]: NodeInputSpec;
        };
        optional?: {
            [key: string]: NodeInputSpec;
        };
        hidden?: {
            [key: string]: string;
        };
    };
    input_order: {
        required: string[];
        optional?: string[];
        hidden?: string[];
    };
    output: string[];
    output_is_list: boolean[];
    output_name: string[];
    name: string;
    display_name: string;
    description: string;
    category: string;
    python_module: string;
    output_node: boolean;
    output_tooltips: string[];
    deprecated?: boolean;
    experimental?: boolean;
    api_node?: boolean;
    [key: string]: unknown;
}
export interface NodeProgress {
    value: number;
    max: number;
    prompt_id: string;
    node: string;
}
export interface IInputNumberConfig {
    default: number;
    min: number;
    max: number;
    step?: number;
    round?: number;
    tooltip?: string;
}
export interface IInputStringConfig {
    default?: string;
    multiline?: boolean;
    dynamicPrompts?: boolean;
    tooltip?: string;
}
export type TStringInput = ["STRING", IInputStringConfig];
export type TBoolInput = ["BOOLEAN", {
    default: boolean;
    tooltip?: string;
}];
export type TNumberInput = ["INT" | "FLOAT", IInputNumberConfig];
/**
 * Represents a model folder in the ComfyUI system
 * @experimental API that may change in future versions
 */
export interface ModelFolder {
    name: string;
    folders: string[];
}
/**
 * Represents a model file in the ComfyUI system
 * @experimental API that may change in future versions
 */
export interface ModelFile {
    name: string;
    pathIndex: number;
}
/**
 * Response format for model preview images
 * @experimental API that may change in future versions
 */
export interface ModelPreviewResponse {
    body: ArrayBuffer;
    contentType: string;
}
/**
 * Response format for a list of model files
 * @experimental API that may change in future versions
 */
export interface ModelFileListResponse {
    files: ModelFile[];
}
/**
 * Response format for a list of model folders
 * @experimental API that may change in future versions
 */
export interface ModelFoldersResponse {
    folders: ModelFolder[];
}
export interface AssetReference {
    id?: string;
    asset_id?: string;
    name?: string;
    asset_hash?: string;
    mime_type?: string;
    width?: number;
    height?: number;
    preview_url?: string;
    preview_id?: string | null;
    [key: string]: unknown;
}
export interface Asset {
    id: string;
    name: string;
    size: number;
    created_at: string;
    updated_at: string;
    asset_hash?: string;
    mime_type?: string;
    tags?: string[];
    user_metadata?: Record<string, unknown>;
    preview_url?: string;
    preview_id?: string | null;
    prompt_id?: string | null;
    last_access_time?: string;
    is_immutable?: boolean;
    width?: number;
    height?: number;
    [key: string]: unknown;
}
export interface AssetCreated extends Asset {
    created_new: boolean;
}
export interface ListAssetsOptions {
    include_tags?: string[];
    exclude_tags?: string[];
    name_contains?: string;
    metadata_filter?: Record<string, unknown> | string;
    limit?: number;
    offset?: number;
    cursor?: string;
    sort?: "name" | "created_at" | "updated_at" | "size" | "last_access_time" | string;
    order?: "asc" | "desc";
    include_public?: boolean;
}
export interface ListAssetsResponse {
    assets: Asset[];
    total?: number;
    has_more: boolean;
    next_cursor?: string | null;
    cursor?: string | null;
}
export interface UploadAssetOptions {
    tags?: string[];
    id?: string;
    preview_id?: string;
    name?: string;
    mime_type?: string;
    user_metadata?: Record<string, unknown> | string;
}
export interface CreateAssetFromHashOptions {
    hash: string;
    tags: string[];
    name?: string;
    mime_type?: string;
    user_metadata?: Record<string, unknown>;
    preview_id?: string;
}
export interface AssetUpdate {
    name?: string;
    tags?: string[];
    mime_type?: string;
    preview_id?: string;
    user_metadata?: Record<string, unknown>;
}
export interface AssetUpdated {
    id: string;
    updated_at: string;
    name?: string;
    asset_hash?: string;
    tags?: string[];
    mime_type?: string;
    user_metadata?: Record<string, unknown>;
}
export interface TagsModificationResponse {
    added?: string[];
    removed?: string[];
    already_present?: string[];
    not_present?: string[];
    total_tags: string[];
}
export interface TagInfo {
    name: string;
    count: number;
}
export interface ListTagsResponse {
    tags: TagInfo[];
    total: number;
    has_more: boolean;
}
/**
 * Job status constants matching ComfyUI's JobStatus
 * @since ComfyUI v0.6.0
 */
export declare enum JobStatus {
    PENDING = "pending",
    IN_PROGRESS = "in_progress",
    COMPLETED = "completed",
    FAILED = "failed",
    CANCELLED = "cancelled"
}
/**
 * Preview output from a job, enriched with node metadata
 * @since ComfyUI v0.6.0
 */
export interface JobOutputPreview {
    filename: string;
    subfolder?: string;
    type?: string;
    format?: string;
    /** Node ID that produced this output */
    nodeId: string;
    /** Media type: 'images', 'video', 'audio', 'files', etc. */
    mediaType: string;
}
/**
 * Error information for failed jobs
 * @since ComfyUI v0.6.0
 */
export interface JobExecutionError {
    node_id?: string;
    node_type?: string;
    exception_message?: string;
    exception_type?: string;
    traceback?: string[];
    executed?: string[];
    current_inputs?: Record<string, unknown>;
    current_outputs?: Record<string, unknown>;
    timestamp?: number;
}
/**
 * Workflow data included in detailed job responses
 * @since ComfyUI v0.6.0
 */
export interface JobWorkflow {
    prompt: object;
    extra_data: object;
}
/**
 * Unified job representation from the Jobs API
 * @since ComfyUI v0.6.0
 */
export interface Job {
    /** Unique job/prompt ID */
    id: string;
    /** Current job status */
    status: JobStatus | string;
    /** Queue priority (lower = higher priority) */
    priority?: number;
    /** Job creation timestamp (milliseconds) */
    create_time?: number;
    /** Execution start timestamp (milliseconds) */
    execution_start_time?: number;
    /** Execution end timestamp (milliseconds) */
    execution_end_time?: number;
    /** Error details if status is 'failed' */
    execution_error?: JobExecutionError;
    /** Number of output items */
    outputs_count?: number;
    /** Preview output for list views */
    preview_output?: JobOutputPreview;
    /** Workflow ID if available */
    workflow_id?: string;
    /** Full outputs (only in single job response with include_outputs) */
    outputs?: OutputData;
    /** Full execution status (only in single job response) */
    execution_status?: StatusData;
    /** Full workflow data (only in single job response) */
    workflow?: JobWorkflow;
}
/**
 * Pagination info in jobs list response
 * @since ComfyUI v0.6.0
 */
export interface JobsPagination {
    offset: number;
    limit: number | null;
    total: number;
    has_more: boolean;
}
/**
 * Response from GET /api/jobs
 * @since ComfyUI v0.6.0
 */
export interface JobsListResponse {
    jobs: Job[];
    pagination: JobsPagination;
}
/**
 * Query options for listing jobs
 * @since ComfyUI v0.6.0
 */
export interface JobsListOptions {
    /** Filter by status (can be multiple) */
    status?: JobStatus | JobStatus[];
    /** Filter by workflow ID */
    workflow_id?: string;
    /** Filter by output media type when supported by the server */
    output_type?: "image" | "video" | "audio" | string;
    /** Sort field. Newer APIs use create_time/execution_time; older docs used created_at/execution_duration. */
    sort_by?: "create_time" | "execution_time" | "created_at" | "execution_duration";
    /** Sort order: 'asc' or 'desc' (default) */
    sort_order?: "asc" | "desc";
    /** Maximum number of items to return */
    limit?: number;
    /** Number of items to skip */
    offset?: number;
}
export type DetailedJobStatus = "waiting_to_dispatch" | "pending" | "in_progress" | "completed" | "error" | "failed" | "cancelled";
export interface JobStatusResponse {
    id: string;
    status: DetailedJobStatus | string;
    created_at?: string;
    updated_at?: string;
    last_state_update?: string;
    assigned_inference?: string | null;
    error_message?: string | null;
    [key: string]: unknown;
}
export interface QueueManageResponse {
    deleted?: string[];
    cleared?: boolean;
    [key: string]: unknown;
}
//# sourceMappingURL=api.d.ts.map