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
    lastDisconnectedAt?: number;
    reconnectionStableAt?: number;
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
    /**
     * Grace period after reconnection before client is considered stable (default: 10 seconds).
     * ComfyUI sometimes quickly disconnects/reconnects after job execution.
     * During this grace period, the client won't be used for new jobs.
     */
    private readonly reconnectionGracePeriodMs;
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
    /**
     * Checks if a client is truly available for work.
     * A client must be online, not busy, AND past the reconnection grace period.
     */
    isClientStable(client: ManagedClient): boolean;
    canClientRunJob(client: ManagedClient, job: JobRecord): boolean;
    claim(job: JobRecord, specificClientId?: string): ClientLease | null;
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
     * Cleanup resources when destroying the manager.
     */
    destroy(): void;
}
export {};
//# sourceMappingURL=ClientManager.d.ts.map