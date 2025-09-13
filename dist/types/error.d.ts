/**
 * Enum representing error codes for ComfyUI operations
 */
export declare enum ErrorCode {
    /**
     * The job went missing
     */
    WENT_MISSING = "E_WENT_MISSING",
    /**
     * Failed to get cached output
     */
    FAILED_CACHE = "E_FAILED_CACHE",
    /**
     * Failed to enqueue prompt
     */
    ENQUEUE_FAILED = "E_ENQUEUE_FAILED",
    /**
     * Disconnected from server
     */
    DISCONNECTED = "E_DISCONNECTED",
    /**
     * Execution failed
     */
    EXECUTION_FAILED = "E_EXECUTION_FAILED",
    /**
     * Custom event error
     */
    CUSTOM_EVENT = "E_CUSTOM_EVENT",
    /**
     * Execution was interrupted
     */
    EXECUTION_INTERRUPTED = "E_EXECUTION_INTERRUPTED",
    /**
     * Missing node in workflow
     */
    MISSING_NODE = "E_MISSING_NODE"
}
/**
 * Base error class for ComfyUI call wrapper operations
 */
export declare class CallWrapperError extends Error {
    /**
     * The name of the error class
     */
    name: string;
    /**
     * Stable machine-readable error code
     */
    code: ErrorCode | string;
}
/**
 * Error thrown when a job goes missing
 */
export declare class WentMissingError extends CallWrapperError {
    /**
     * The name of the error class
     */
    name: string;
    /**
     * The error code for this error type
     */
    code: ErrorCode;
}
/**
 * Error thrown when failed to get cached output
 */
export declare class FailedCacheError extends CallWrapperError {
    /**
     * The name of the error class
     */
    name: string;
    /**
     * The error code for this error type
     */
    code: ErrorCode;
}
/**
 * Error thrown when failed to enqueue a prompt
 */
export declare class EnqueueFailedError extends CallWrapperError {
    /**
     * The name of the error class
     */
    name: string;
    /**
     * The error code for this error type
     */
    code: ErrorCode;
    /**
     * HTTP status code when available
     */
    status?: number;
    /**
     * HTTP status text
     */
    statusText?: string;
    /**
     * Request URL (if known)
     */
    url?: string;
    /**
     * HTTP method (if known)
     */
    method?: string;
    /**
     * Parsed JSON body (if any)
     */
    bodyJSON?: any;
    /**
     * Raw body text snippet (truncated)
     */
    bodyTextSnippet?: string;
    /**
     * Extracted concise reason message
     */
    reason?: string;
    /**
     * Creates a new EnqueueFailedError instance
     * @param message - The error message
     * @param init - Initialization options for the error
     */
    constructor(message: string, init?: {
        cause?: any;
        status?: number;
        statusText?: string;
        url?: string;
        method?: string;
        bodyJSON?: any;
        bodyTextSnippet?: string;
        reason?: string;
    });
}
/**
 * Error thrown when disconnected from server
 */
export declare class DisconnectedError extends CallWrapperError {
    /**
     * The name of the error class
     */
    name: string;
    /**
     * The error code for this error type
     */
    code: ErrorCode;
}
/**
 * Error thrown when execution fails
 */
export declare class ExecutionFailedError extends CallWrapperError {
    /**
     * The name of the error class
     */
    name: string;
    /**
     * The error code for this error type
     */
    code: ErrorCode;
}
/**
 * Error thrown for custom events
 */
export declare class CustomEventError extends CallWrapperError {
    /**
     * The name of the error class
     */
    name: string;
    /**
     * The error code for this error type
     */
    code: ErrorCode;
}
/**
 * Error thrown when execution is interrupted
 */
export declare class ExecutionInterruptedError extends CallWrapperError {
    /**
     * The name of the error class
     */
    name: string;
    /**
     * The error code for this error type
     */
    code: ErrorCode;
}
/**
 * Error thrown when a node is missing from the workflow
 */
export declare class MissingNodeError extends CallWrapperError {
    /**
     * The name of the error class
     */
    name: string;
    /**
     * The error code for this error type
     */
    code: ErrorCode;
}
//# sourceMappingURL=error.d.ts.map