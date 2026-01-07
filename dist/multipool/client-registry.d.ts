import { MultiWorkflowPool } from "./multi-workflow-pool.js";
import { Workflow } from "./workflow.js";
import { EnhancedClient } from "./interfaces.js";
import { PoolEventManager } from "./pool-event-manager.js";
export declare class ClientRegistry {
    pool: MultiWorkflowPool;
    private events;
    clients: Map<string, EnhancedClient>;
    workflowAffinityMap: Map<string, Set<string>>;
    constructor(pool: MultiWorkflowPool, events: PoolEventManager);
    addClient(clientUrl: string, options?: {
        workflowAffinity: Workflow[];
        priority?: number;
        clientId?: string;
    }): void;
    removeClient(clientUrl: string): void;
    getQueueStatus(clientUrl: string): Promise<import("../types/api.js").QueueResponse>;
    getOptimalClient(workflow: Workflow, priorityOverrides?: Map<string, number>): EnhancedClient | null;
    hasClientsForWorkflow(workflowHash: string): boolean;
    getOptimalIdleClient(workflow: Workflow, priorityOverrides?: Map<string, number>): Promise<EnhancedClient | null>;
    private checkClientQueueState;
    markClientIncompatibleWithWorkflow(url: string, structureHash: string | undefined): void;
    getAllEligibleClientsForWorkflow(workflow: Workflow): EnhancedClient[];
}
//# sourceMappingURL=client-registry.d.ts.map