import { EQueueMode } from "../pool.js";
import { ComfyApi } from "../client.js";
import { TMonitorEvent } from "../features/monitoring.js";
/**
 * Type representing the status event data structure
 */
export type TEventStatus = {
    /**
     * Execution status information
     */
    status: {
        /**
         * Execution info including queue remaining count
         */
        exec_info: {
            /**
             * Number of items remaining in the queue
             */
            queue_remaining: number;
        };
    };
    /**
     * Session ID
     */
    sid: string;
};
/**
 * Type representing execution event data structure
 */
export type TExecution = {
    /**
     * The prompt ID
     */
    prompt_id: string;
};
/**
 * Type representing executing event data structure
 */
export type TExecuting = TExecution & {
    /**
     * The node being executed (null if none)
     */
    node: string | null;
};
/**
 * Type representing progress event data structure
 */
export type TProgress = TExecuting & {
    /**
     * Current progress value
     */
    value: number;
    /**
     * Maximum progress value
     */
    max: number;
};
/**
 * Type representing executed event data structure
 */
export type TExecuted<T = unknown> = TExecution & {
    /**
     * The node that was executed
     */
    node: string;
    /**
     * The output from the execution
     */
    output: T;
};
/**
 * Type representing execution cached event data structure
 */
export type TExecutionCached = TExecution & {
    /**
     * Array of cached node IDs
     */
    nodes: string[];
};
/**
 * Type representing execution error event data structure
 */
export type TExecutionError = TExecution & {
    /**
     * The node ID where the error occurred
     */
    node_id: string;
    /**
     * The node type where the error occurred
     */
    node_type: string;
    /**
     * The exception message
     */
    exception_message: string;
    /**
     * The exception type
     */
    exception_type: string;
    /**
     * The traceback information
     */
    traceback: string[];
};
/**
 * Type representing execution interrupted event data structure
 */
export type TExecutionInterrupted = TExecution & {
    /**
     * The node ID where the execution was interrupted
     */
    node_id: string;
    /**
     * The node type where the execution was interrupted
     */
    node_type: string;
    /**
     * Array of executed node IDs
     */
    executed: string[];
};
/**
 * Union type of all ComfyUI API event keys
 */
export type ComfyApiEventKey = "all" | "auth_error" | "connection_error" | "auth_success" | "status" | "progress" | "executing" | "executed" | "disconnected" | "execution_success" | "execution_start" | "execution_error" | "execution_cached" | "queue_error" | "reconnected" | "connected" | "log" | "terminal" | "reconnecting" | "b_preview" | "b_preview_meta" | "b_text" | "b_text_meta" | "b_preview_raw" | "node_text_update";
/**
 * Type mapping ComfyUI API event keys to their respective CustomEvent types
 */
export type TComfyAPIEventMap = {
    /**
     * Catch-all event for any WebSocket message
     */
    all: CustomEvent<{
        type: string;
        data: any;
    }>;
    /**
     * Authentication error event
     */
    auth_error: CustomEvent<Response>;
    /**
     * Authentication success event
     */
    auth_success: CustomEvent<null>;
    /**
     * Connection error event
     */
    connection_error: CustomEvent<Error>;
    /**
     * Execution success event
     */
    execution_success: CustomEvent<TExecution>;
    /**
     * Status update event
     */
    status: CustomEvent<TEventStatus>;
    /**
     * Disconnected event
     */
    disconnected: CustomEvent<null>;
    /**
     * Reconnecting event
     */
    reconnecting: CustomEvent<null>;
    /**
     * Connected event
     */
    connected: CustomEvent<null>;
    /**
     * Reconnected event
     */
    reconnected: CustomEvent<null>;
    /**
     * Binary preview image event
     */
    b_preview: CustomEvent<Blob>;
    /**
     * Binary preview image event with metadata (emitted when server supports metadata previews)
     */
    b_preview_meta: CustomEvent<{
        blob: Blob;
        metadata: any;
    }>;
    /**
     * Binary text frame event (protocol 3)
     */
    b_text: CustomEvent<string>;
    /**
     * Binary text frame event with metadata (protocol 3)
     */
    b_text_meta: CustomEvent<{
        channel: number;
        text: string;
    }>;
    /**
     * Raw image bytes (protocol 2). Consumers can interpret according to their needs.
     */
    b_preview_raw: CustomEvent<Uint8Array>;
    /**
     * Normalized text update parsed from TEXT frames with optional node correlation
     */
    node_text_update: CustomEvent<{
        channel: number;
        text: string;
        kind: "progress" | "result" | "message";
        progressSeconds?: number;
        resultUrl?: string;
        nodeHint?: string;
        executingNode?: string | null;
        promptIdHint?: string | null;
        cleanText?: string;
    }>;
    /**
     * Log message event
     */
    log: CustomEvent<{
        msg: string;
        data: any;
    }>;
    /**
     * Terminal log entry event
     */
    terminal: CustomEvent<{
        m: string;
        t: string;
    }>;
    /**
     * Execution start event
     */
    execution_start: CustomEvent<TExecution>;
    /**
     * Node executing event
     */
    executing: CustomEvent<TExecuting>;
    /**
     * Progress update event
     */
    progress: CustomEvent<TProgress>;
    /**
     * Node executed event
     */
    executed: CustomEvent<TExecuted>;
    /**
     * Queue error event
     */
    queue_error: CustomEvent<Error>;
    /**
     * Execution error event
     */
    execution_error: CustomEvent<TExecutionError>;
    /**
     * Execution interrupted event
     */
    execution_interrupted: CustomEvent<TExecutionInterrupted>;
    /**
     * Execution cached event
     */
    execution_cached: CustomEvent<TExecutionCached>;
};
/**
 * Union type of all ComfyUI Pool event keys
 */
export type ComfyPoolEventKey = "init" | "init_client" | "auth_error" | "connection_error" | "auth_success" | "added" | "removed" | "add_job" | "have_job" | "idle" | "terminal" | "ready" | "change_mode" | "connected" | "disconnected" | "reconnected" | "executing" | "executed" | "execution_interrupted" | "execution_error" | "system_monitor";
/**
 * Type mapping ComfyUI Pool event keys to their respective CustomEvent types
 */
export type TComfyPoolEventMap = {
    /**
     * Pool initialization event
     */
    init: CustomEvent<null>;
    /**
     * Authentication error event
     */
    auth_error: CustomEvent<{
        client: ComfyApi;
        clientIdx: number;
        res: Response;
    }>;
    /**
     * Connection error event
     */
    connection_error: CustomEvent<{
        client: ComfyApi;
        clientIdx: number;
        error: Error;
    }>;
    /**
     * Terminal log entry event
     */
    terminal: CustomEvent<{
        clientIdx: number;
        m: string;
        t: string;
    }>;
    /**
     * Client ready event
     */
    ready: CustomEvent<{
        client: ComfyApi;
        clientIdx: number;
    }>;
    /**
     * Authentication success event
     */
    auth_success: CustomEvent<{
        client: ComfyApi;
        clientIdx: number;
    }>;
    /**
     * Loading client event
     */
    loading_client: CustomEvent<{
        client: ComfyApi;
        clientIdx: number;
    }>;
    /**
     * Change mode event
     */
    change_mode: CustomEvent<{
        mode: EQueueMode;
    }>;
    /**
     * Client added event
     */
    added: CustomEvent<{
        client: ComfyApi;
        clientIdx: number;
    }>;
    /**
     * Client removed event
     */
    removed: CustomEvent<{
        client: ComfyApi;
        clientIdx: number;
    }>;
    /**
     * Client connected event
     */
    connected: CustomEvent<{
        client: ComfyApi;
        clientIdx: number;
    }>;
    /**
     * Client disconnected event
     */
    disconnected: CustomEvent<{
        client: ComfyApi;
        clientIdx: number;
    }>;
    /**
     * Client reconnected event
     */
    reconnected: CustomEvent<{
        client: ComfyApi;
        clientIdx: number;
    }>;
    /**
     * Job added event
     */
    add_job: CustomEvent<{
        jobIdx: number;
        weight: number;
    }>;
    /**
     * Have job event
     */
    have_job: CustomEvent<{
        client: ComfyApi;
        remain: number;
    }>;
    /**
     * Client idle event
     */
    idle: CustomEvent<{
        client: ComfyApi;
    }>;
    /**
     * Execution interrupted event
     */
    execution_interrupted: CustomEvent<{
        client: ComfyApi;
        clientIdx: number;
    }>;
    /**
     * Executing event
     */
    executing: CustomEvent<{
        client: ComfyApi;
        clientIdx: number;
    }>;
    /**
     * Executed event
     */
    executed: CustomEvent<{
        client: ComfyApi;
        clientIdx: number;
    }>;
    /**
     * Execution error event
     */
    execution_error: CustomEvent<{
        client: ComfyApi;
        clientIdx: number;
        error: Error;
        willRetry?: boolean;
        attempt?: number;
        maxRetries?: number;
    }>;
    /**
     * System monitor event
     */
    system_monitor: CustomEvent<{
        client: ComfyApi;
        clientIdx: number;
        data: TMonitorEvent;
    }>;
};
//# sourceMappingURL=event.d.ts.map