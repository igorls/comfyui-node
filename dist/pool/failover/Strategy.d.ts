import type { JobRecord } from "../types/job.js";
import type { ManagedClient } from "../client/ClientManager.js";
export interface FailoverStrategy {
    shouldSkipClient(client: ManagedClient, job: JobRecord): boolean;
    recordFailure(client: ManagedClient, job: JobRecord, error: unknown): void;
    recordSuccess(client: ManagedClient, job: JobRecord): void;
    resetForWorkflow?(workflowHash: string): void;
    isWorkflowBlocked?(client: ManagedClient, workflowHash: string): boolean;
}
//# sourceMappingURL=Strategy.d.ts.map