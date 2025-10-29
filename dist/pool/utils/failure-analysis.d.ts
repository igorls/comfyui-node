export type ClientBlockMode = "none" | "temporary" | "permanent";
export type WorkflowFailureType = "workflow_invalid" | "client_incompatible" | "transient" | "unknown";
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
export declare function analyzeWorkflowFailure(error: unknown): WorkflowFailureAnalysis;
//# sourceMappingURL=failure-analysis.d.ts.map