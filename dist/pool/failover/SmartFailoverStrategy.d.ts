import type { ManagedClient } from "../client/ClientManager.js";
import type { JobRecord } from "../types/job.js";
import type { FailoverStrategy } from "./Strategy.js";
export declare class SmartFailoverStrategy implements FailoverStrategy {
    private workflowFailures;
    private cooldownMs;
    private maxFailuresBeforeBlock;
    constructor(opts?: {
        cooldownMs?: number;
        maxFailuresBeforeBlock?: number;
    });
    shouldSkipClient(client: ManagedClient, job: JobRecord): boolean;
    recordFailure(client: ManagedClient, job: JobRecord, error: unknown): void;
    recordSuccess(client: ManagedClient, job: JobRecord): void;
    resetForWorkflow(workflowHash: string): void;
    isWorkflowBlocked(client: ManagedClient, workflowHash: string): boolean;
}
//# sourceMappingURL=SmartFailoverStrategy.d.ts.map