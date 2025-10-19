import type { ComfyApi } from "../../client.js";
import { TypedEventTarget } from "../../typed-event-target.js";
import type { JobRecord } from "../types/job.js";
import type { FailoverStrategy } from "../failover/Strategy.js";
import type { WorkflowPoolEventMap } from "../types/events.js";
export interface ManagedClient {
    client: ComfyApi;
    id: string;
    online: boolean;
    busy: boolean;
    lastError?: unknown;
    lastSeenAt: number;
    supportedWorkflows: Set<string>;
}
interface ClientLease {
    client: ComfyApi;
    clientId: string;
    release: (opts?: {
        success?: boolean;
    }) => void;
}
export declare class ClientManager extends TypedEventTarget<WorkflowPoolEventMap> {
    private clients;
    private strategy;
    constructor(strategy: FailoverStrategy);
    private emitBlocked;
    private emitUnblocked;
    initialize(clients: ComfyApi[]): Promise<void>;
    addClient(client: ComfyApi): Promise<void>;
    list(): ManagedClient[];
    getClient(clientId: string): ManagedClient | undefined;
    claim(job: JobRecord): ClientLease | null;
    recordFailure(clientId: string, job: JobRecord, error: unknown): void;
}
export {};
//# sourceMappingURL=ClientManager.d.ts.map