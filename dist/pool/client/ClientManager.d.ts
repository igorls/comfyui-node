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
    availableCheckpoints?: Set<string>;
    checkpointsCachedAt?: number;
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
    private healthCheckInterval;
    private readonly healthCheckIntervalMs;
    private readonly checkpointCacheTTL;
    /**
     * Create a new ClientManager for managing ComfyUI client connections.
     *
     * @param strategy - Failover strategy for handling client failures
     * @param opts - Configuration options
     * @param opts.healthCheckIntervalMs - Interval (ms) for health check pings to keep connections alive.
     *   Set to 0 to disable. Default: 30000 (30 seconds).
     */
    constructor(strategy: FailoverStrategy, opts?: {
        /**
         * Interval in milliseconds for health check pings.
         * Health checks keep idle connections alive by periodically polling client status.
         * @default 30000 (30 seconds)
         */
        healthCheckIntervalMs?: number;
    });
    private emitBlocked;
    private emitUnblocked;
    initialize(clients: ComfyApi[]): Promise<void>;
    addClient(client: ComfyApi): Promise<void>;
    list(): ManagedClient[];
    getClient(clientId: string): ManagedClient | undefined;
    claim(job: JobRecord): ClientLease | null;
    claimAsync(job: JobRecord): Promise<ClientLease | null>;
    recordFailure(clientId: string, job: JobRecord, error: unknown): void;
    /**
     * Start periodic health check to keep connections alive and detect issues early.
     * Pings idle clients by polling their queue status.
     */
    private startHealthCheck;
    /**
     * Perform health check on all clients.
     * Polls queue status to keep WebSocket alive and detect connection issues.
     * IMPORTANT: Pings ALL online clients (including busy ones) to prevent WebSocket timeout during heavy load.
     */
    private performHealthCheck;
    /**
     * Stop health check interval (called during shutdown).
     */
    stopHealthCheck(): void;
    /**
     * Gets available checkpoints for a specific client, with caching.
     * @public Exposed para uso pelo WorkflowPool
     */
    getClientCheckpoints(clientId: string): Promise<string[]>;
    /**
     * Cleanup resources when destroying the manager.
     */
    destroy(): void;
}
export {};
//# sourceMappingURL=ClientManager.d.ts.map