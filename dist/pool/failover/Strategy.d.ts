import { ManagedClient } from "../client/ClientManager.js";
import type { JobRecord } from "../types/job.js";
export interface FailoverStrategy {
    shouldSkipClient(client: ManagedClient, job: JobRecord): boolean;
    recordFailure(client: ManagedClient, job: JobRecord, error: unknown): void;
    recordSuccess(client: ManagedClient, job: JobRecord): void;
    resetForWorkflow?(workflowHash: string): void;
    isWorkflowBlocked?(client: ManagedClient, workflowHash: string): boolean;
}
//# sourceMappingURL=Strategy.d.ts.map