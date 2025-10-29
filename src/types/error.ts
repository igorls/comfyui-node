/**
 * Enum representing error codes for ComfyUI operations
 */
export enum ErrorCode {
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
  MISSING_NODE = "E_MISSING_NODE",
  /**
   * No connected clients support this workflow
   */
  WORKFLOW_NOT_SUPPORTED = "E_WORKFLOW_NOT_SUPPORTED"
}

/**
 * Base error class for ComfyUI call wrapper operations
 */
export class CallWrapperError extends Error {
  /**
   * The name of the error class
   */
  name = "CallWrapperError";
  
  /**
   * Stable machine-readable error code
   */
  code: ErrorCode | string = "";
}

/**
 * Error thrown when a job goes missing
 */
export class WentMissingError extends CallWrapperError {
  /**
   * The name of the error class
   */
  name = "WentMissingError";
  
  /**
   * The error code for this error type
   */
  code = ErrorCode.WENT_MISSING;
}

/**
 * Error thrown when failed to get cached output
 */
export class FailedCacheError extends CallWrapperError {
  /**
   * The name of the error class
   */
  name = "FailedCacheError";
  
  /**
   * The error code for this error type
   */
  code = ErrorCode.FAILED_CACHE;
}

/**
 * Error thrown when failed to enqueue a prompt
 */
export class EnqueueFailedError extends CallWrapperError {
  /**
   * The name of the error class
   */
  name = "EnqueueFailedError";
  
  /**
   * The error code for this error type
   */
  code = ErrorCode.ENQUEUE_FAILED;
  
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

/**
 * Error thrown when disconnected from server
 */
export class DisconnectedError extends CallWrapperError {
  /**
   * The name of the error class
   */
  name = "DisconnectedError";
  
  /**
   * The error code for this error type
   */
  code = ErrorCode.DISCONNECTED;
}

/**
 * Error thrown when execution fails
 */
export class ExecutionFailedError extends CallWrapperError {
  /**
   * The name of the error class
   */
  name = "ExecutionFailedError";
  
  /**
   * The error code for this error type
   */
  code = ErrorCode.EXECUTION_FAILED;
}

/**
 * Error thrown for custom events
 */
export class CustomEventError extends CallWrapperError {
  /**
   * The name of the error class
   */
  name = "CustomEventError";
  
  /**
   * The error code for this error type
   */
  code = ErrorCode.CUSTOM_EVENT;
}

/**
 * Error thrown when execution is interrupted
 */
export class ExecutionInterruptedError extends CallWrapperError {
  /**
   * The name of the error class
   */
  name = "ExecutionInterruptedError";
  
  /**
   * The error code for this error type
   */
  code = ErrorCode.EXECUTION_INTERRUPTED;
}

/**
 * Error thrown when a node is missing from the workflow
 */
export class MissingNodeError extends CallWrapperError {
  /**
   * The name of the error class
   */
  name = "MissingNodeError";
  
  /**
   * The error code for this error type
   */
  code = ErrorCode.MISSING_NODE;
}

/**
 * Error thrown when no connected clients can execute the workflow
 */
export class WorkflowNotSupportedError extends CallWrapperError {
  /**
   * The name of the error class
   */
  name = "WorkflowNotSupportedError";

  /**
   * The error code for this error type
   */
  code = ErrorCode.WORKFLOW_NOT_SUPPORTED;

  /**
   * Workflow hash associated with the failure
   */
  workflowHash: string;

  /**
   * Diagnostic reasons keyed by client id when available
   */
  reasons: Record<string, string | undefined>;

  constructor(message: string, init: { workflowHash: string; reasons?: Record<string, string | undefined>; cause?: unknown }) {
    super(message, init.cause ? { cause: init.cause } : undefined);
    this.workflowHash = init.workflowHash;
    this.reasons = init.reasons ?? {};
  }
}
