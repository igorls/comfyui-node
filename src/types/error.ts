export enum ErrorCode {
  WENT_MISSING = "E_WENT_MISSING",
  FAILED_CACHE = "E_FAILED_CACHE",
  ENQUEUE_FAILED = "E_ENQUEUE_FAILED",
  DISCONNECTED = "E_DISCONNECTED",
  EXECUTION_FAILED = "E_EXECUTION_FAILED",
  CUSTOM_EVENT = "E_CUSTOM_EVENT",
  EXECUTION_INTERRUPTED = "E_EXECUTION_INTERRUPTED",
  MISSING_NODE = "E_MISSING_NODE"
}

export class CallWrapperError extends Error {
  name = "CallWrapperError";
  /** Stable machine-readable error code */
  code: ErrorCode | string = "";
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
  }) {
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
