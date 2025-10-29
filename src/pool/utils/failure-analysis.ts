import { CustomEventError, EnqueueFailedError, MissingNodeError } from "../../types/error.js";

export type ClientBlockMode = "none" | "temporary" | "permanent";

export type WorkflowFailureType =
  | "workflow_invalid"
  | "client_incompatible"
  | "transient"
  | "unknown";

export interface WorkflowFailureAnalysis {
  /** Indicates whether the workflow should be retried on other clients. */
  retryable: boolean;
  /** Indicates how the failing client should be treated for this workflow. */
  blockClient: ClientBlockMode;
  /** High level classification of the failure. */
  type: WorkflowFailureType;
  /** Concise diagnostic reason extracted from the error payload when available. */
  reason?: string;
}

function coerceString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return String(value);
  } catch {
    return "";
  }
}

function collectCandidateStrings(err: EnqueueFailedError | CustomEventError | Error): string {
  const chunks: string[] = [];
  const maybePush = (value: unknown) => {
    const text = coerceString(value).trim();
    if (text) {
      chunks.push(text);
    }
  };

  if (err instanceof EnqueueFailedError) {
    maybePush(err.reason);
    maybePush(err.bodyTextSnippet);
    if (err.bodyJSON && typeof err.bodyJSON === "object") {
      const json = err.bodyJSON as Record<string, unknown>;
      maybePush(json.error);
      maybePush(json.message);
      maybePush(json.detail);
      maybePush(json.reason);
      if (typeof json.errors === "string") {
        maybePush(json.errors);
      } else if (Array.isArray(json.errors) && json.errors.length) {
        for (const entry of json.errors) {
          if (typeof entry === "string") {
            maybePush(entry);
            break;
          }
          if (entry && typeof entry === "object") {
            maybePush((entry as any).message);
            maybePush((entry as any).error);
            if (chunks.length) break;
          }
        }
      }
    }
  } else if (err instanceof CustomEventError) {
    maybePush(err.message);
    const cause = err.cause as any;
    maybePush(cause?.exception_type);
    maybePush(cause?.exception_message);
    maybePush(cause?.message);
  } else if (err instanceof Error) {
    maybePush(err.message);
  }

  if (!chunks.length) {
    maybePush(err instanceof Error ? err.message : undefined);
  }

  return chunks.join("; ");
}

function getErrorCode(err: EnqueueFailedError): string | undefined {
  const data = err.bodyJSON;
  if (data && typeof data === "object") {
    const code = (data as any).error ?? (data as any).code;
    if (typeof code === "string" && code) {
      return code;
    }
  }
  return undefined;
}

const CLIENT_INCOMPATIBLE_CODES = new Set([
  "value_not_in_list",
  "missing_choice",
  "missing_checkpoint",
  "node_missing",
  "lora_missing",
  "missing_model",
  "missing_file",
  "unknown_model",
  "unknown_checkpoint"
]);

const WORKFLOW_INVALID_CODES = new Set([
  "workflow_invalid",
  "invalid_node_reference",
  "invalid_workflow",
  "missing_input",
  "invalid_prompt" 
]);

const CLIENT_INCOMPATIBLE_PATTERNS = [
  /value_not_in_list/i,
  /ckpt_name/i,
  /checkpoint.+not found/i,
  /model.+not found/i,
  /missing checkpoint/i,
  /missing model/i,
  /missing file/i,
  /lora.+not found/i,
  /no module named/i,
  /no such file or directory/i,
  /failed to load model/i,
  /failed to load checkpoint/i
];

const WORKFLOW_INVALID_PATTERNS = [
  /workflow.+invalid/i,
  /graph.+invalid/i,
  /node.+missing/i,
  /invalid node/i,
  /missing required input/i,
  /duplicate node/i,
  /unknown output/i,
  /prompt.+invalid/i,
  /bad input/i
];

export function analyzeWorkflowFailure(error: unknown): WorkflowFailureAnalysis {
  if (error instanceof MissingNodeError) {
    return {
      retryable: false,
      blockClient: "none",
      type: "workflow_invalid",
      reason: error.message
    };
  }

  if (error instanceof EnqueueFailedError) {
    const reason = collectCandidateStrings(error);
    const code = getErrorCode(error);

    if (code && CLIENT_INCOMPATIBLE_CODES.has(code)) {
      return {
        retryable: true,
        blockClient: "permanent",
        type: "client_incompatible",
        reason: reason || code
      };
    }

    if (code && WORKFLOW_INVALID_CODES.has(code)) {
      return {
        retryable: false,
        blockClient: "none",
        type: "workflow_invalid",
        reason: reason || code
      };
    }

    if (CLIENT_INCOMPATIBLE_PATTERNS.some((pattern) => pattern.test(reason))) {
      return {
        retryable: true,
        blockClient: "permanent",
        type: "client_incompatible",
        reason: reason || code
      };
    }

    if (WORKFLOW_INVALID_PATTERNS.some((pattern) => pattern.test(reason))) {
      return {
        retryable: false,
        blockClient: "none",
        type: "workflow_invalid",
        reason: reason || code
      };
    }

    if (typeof error.status === "number" && error.status >= 500) {
      return {
        retryable: true,
        blockClient: "temporary",
        type: "transient",
        reason: reason || "Server error"
      };
    }

    if (typeof error.status === "number" && error.status === 429) {
      return {
        retryable: true,
        blockClient: "temporary",
        type: "transient",
        reason: reason || "Rate limited"
      };
    }

    return {
      retryable: false,
      blockClient: "none",
      type: "workflow_invalid",
      reason: reason || "Workflow rejected"
    };
  }

  if (error instanceof CustomEventError) {
    const reason = collectCandidateStrings(error);
    if (CLIENT_INCOMPATIBLE_PATTERNS.some((pattern) => pattern.test(reason))) {
      return {
        retryable: true,
        blockClient: "permanent",
        type: "client_incompatible",
        reason
      };
    }
    if (WORKFLOW_INVALID_PATTERNS.some((pattern) => pattern.test(reason))) {
      return {
        retryable: false,
        blockClient: "none",
        type: "workflow_invalid",
        reason
      };
    }
    return {
      retryable: true,
      blockClient: "temporary",
      type: "transient",
      reason
    };
  }

  if (error instanceof Error) {
    return {
      retryable: true,
      blockClient: "temporary",
      type: "unknown",
      reason: error.message
    };
  }

  return {
    retryable: true,
    blockClient: "temporary",
    type: "unknown"
  };
}
