export declare enum ErrorCode {
    WENT_MISSING = "E_WENT_MISSING",
    FAILED_CACHE = "E_FAILED_CACHE",
    ENQUEUE_FAILED = "E_ENQUEUE_FAILED",
    DISCONNECTED = "E_DISCONNECTED",
    EXECUTION_FAILED = "E_EXECUTION_FAILED",
    CUSTOM_EVENT = "E_CUSTOM_EVENT",
    EXECUTION_INTERRUPTED = "E_EXECUTION_INTERRUPTED",
    MISSING_NODE = "E_MISSING_NODE"
}
export declare class CallWrapperError extends Error {
    name: string;
    /** Stable machine-readable error code */
    code: ErrorCode | string;
}
export declare class WentMissingError extends CallWrapperError {
    name: string;
    code: ErrorCode;
}
export declare class FailedCacheError extends CallWrapperError {
    name: string;
    code: ErrorCode;
}
export declare class EnqueueFailedError extends CallWrapperError {
    name: string;
    code: ErrorCode;
    /** HTTP status code when available */
    status?: number;
    /** HTTP status text */
    statusText?: string;
    /** Request URL (if known) */
    url?: string;
    /** HTTP method (if known) */
    method?: string;
    /** Parsed JSON body (if any) */
    bodyJSON?: any;
    /** Raw body text snippet (truncated) */
    bodyTextSnippet?: string;
    /** Extracted concise reason message */
    reason?: string;
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
export declare class DisconnectedError extends CallWrapperError {
    name: string;
    code: ErrorCode;
}
export declare class ExecutionFailedError extends CallWrapperError {
    name: string;
    code: ErrorCode;
}
export declare class CustomEventError extends CallWrapperError {
    name: string;
    code: ErrorCode;
}
export declare class ExecutionInterruptedError extends CallWrapperError {
    name: string;
    code: ErrorCode;
}
export declare class MissingNodeError extends CallWrapperError {
    name: string;
    code: ErrorCode;
}
//# sourceMappingURL=error.d.ts.map