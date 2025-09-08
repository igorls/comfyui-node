export var ErrorCode;
(function (ErrorCode) {
    ErrorCode["WENT_MISSING"] = "E_WENT_MISSING";
    ErrorCode["FAILED_CACHE"] = "E_FAILED_CACHE";
    ErrorCode["ENQUEUE_FAILED"] = "E_ENQUEUE_FAILED";
    ErrorCode["DISCONNECTED"] = "E_DISCONNECTED";
    ErrorCode["EXECUTION_FAILED"] = "E_EXECUTION_FAILED";
    ErrorCode["CUSTOM_EVENT"] = "E_CUSTOM_EVENT";
    ErrorCode["EXECUTION_INTERRUPTED"] = "E_EXECUTION_INTERRUPTED";
    ErrorCode["MISSING_NODE"] = "E_MISSING_NODE";
})(ErrorCode || (ErrorCode = {}));
export class CallWrapperError extends Error {
    name = "CallWrapperError";
    /** Stable machine-readable error code */
    code = "";
}
export class WentMissingError extends CallWrapperError {
    name = "WentMissingError";
    code = ErrorCode.WENT_MISSING;
}
export class FailedCacheError extends CallWrapperError {
    name = "FailedCacheError";
    code = ErrorCode.FAILED_CACHE;
}
export class EnqueueFailedError extends CallWrapperError {
    name = "EnqueueFailedError";
    code = ErrorCode.ENQUEUE_FAILED;
    /** HTTP status code when available */
    status;
    /** HTTP status text */
    statusText;
    /** Request URL (if known) */
    url;
    /** HTTP method (if known) */
    method;
    /** Parsed JSON body (if any) */
    bodyJSON;
    /** Raw body text snippet (truncated) */
    bodyTextSnippet;
    /** Extracted concise reason message */
    reason;
    constructor(message, init) {
        super(message, init ? { cause: init.cause } : undefined);
        if (init) {
            this.status = init.status;
            this.statusText = init.statusText;
            this.url = init.url;
            this.method = init.method;
            this.bodyJSON = init.bodyJSON;
            this.bodyTextSnippet = init.bodyTextSnippet;
            this.reason = init.reason || init.bodyJSON?.error || init.bodyJSON?.message;
        }
    }
}
export class DisconnectedError extends CallWrapperError {
    name = "DisconnectedError";
    code = ErrorCode.DISCONNECTED;
}
export class ExecutionFailedError extends CallWrapperError {
    name = "ExecutionFailedError";
    code = ErrorCode.EXECUTION_FAILED;
}
export class CustomEventError extends CallWrapperError {
    name = "CustomEventError";
    code = ErrorCode.CUSTOM_EVENT;
}
export class ExecutionInterruptedError extends CallWrapperError {
    name = "ExecutionInterruptedError";
    code = ErrorCode.EXECUTION_INTERRUPTED;
}
export class MissingNodeError extends CallWrapperError {
    name = "MissingNodeError";
    code = ErrorCode.MISSING_NODE;
}
//# sourceMappingURL=error.js.map