import { TypedEventTarget } from "../../typed-event-target.js";
export class ClientManager extends TypedEventTarget {
    clients = [];
    strategy;
    healthCheckInterval = null;
    healthCheckIntervalMs;
    /**
     * Grace period after reconnection before client is considered stable (default: 10 seconds).
     * ComfyUI sometimes quickly disconnects/reconnects after job execution.
     * During this grace period, the client won't be used for new jobs.
     */
    reconnectionGracePeriodMs = 10000;
    /**
     * Create a new ClientManager for managing ComfyUI client connections.
     *
     * @param strategy - Failover strategy for handling client failures
     * @param opts - Configuration options
     * @param opts.healthCheckIntervalMs - Interval (ms) for health check pings to keep connections alive.
     *   Set to 0 to disable. Default: 30000 (30 seconds).
     */
    constructor(strategy, opts) {
        super();
        this.strategy = strategy;
        this.healthCheckIntervalMs = opts?.healthCheckIntervalMs ?? 30000; // Default: 30 seconds
    }
    emitBlocked(clientId, workflowHash) {
        this.dispatchEvent(new CustomEvent("client:blocked_workflow", { detail: { clientId, workflowHash } }));
    }
    emitUnblocked(clientId, workflowHash) {
        this.dispatchEvent(new CustomEvent("client:unblocked_workflow", { detail: { clientId, workflowHash } }));
    }
    async initialize(clients) {
        for (const client of clients) {
            await this.addClient(client);
        }
        this.startHealthCheck();
    }
    async addClient(client) {
        await client.init();
        const managed = {
            client,
            id: client.id,
            online: true,
            busy: false,
            lastSeenAt: Date.now(),
            supportedWorkflows: new Set()
        };
        this.clients.push(managed);
        client.on("disconnected", () => {
            managed.online = false;
            managed.busy = false;
            managed.lastSeenAt = Date.now();
            managed.lastDisconnectedAt = Date.now();
            this.dispatchEvent(new CustomEvent("client:state", {
                detail: { clientId: managed.id, online: false, busy: false, lastError: managed.lastError }
            }));
        });
        client.on("reconnected", () => {
            const now = Date.now();
            managed.online = true;
            managed.lastSeenAt = now;
            managed.reconnectionStableAt = now + this.reconnectionGracePeriodMs;
            // Log if this is a quick reconnect (within 30 seconds of disconnect)
            if (managed.lastDisconnectedAt && (now - managed.lastDisconnectedAt) < 30000) {
                console.warn(`[ClientManager] Client ${managed.id} reconnected ${((now - managed.lastDisconnectedAt) / 1000).toFixed(1)}s after disconnect. ` +
                    `Grace period active until ${new Date(managed.reconnectionStableAt).toISOString()}`);
            }
            this.dispatchEvent(new CustomEvent("client:state", {
                detail: { clientId: managed.id, online: true, busy: managed.busy }
            }));
        });
    }
    list() {
        return [...this.clients];
    }
    getClient(clientId) {
        return this.clients.find((c) => c.id === clientId);
    }
    /**
     * Checks if a client is truly available for work.
     * A client must be online, not busy, AND past the reconnection grace period.
     */
    isClientStable(client) {
        if (!client.online || client.busy) {
            return false;
        }
        // If client recently reconnected, wait for grace period
        if (client.reconnectionStableAt && Date.now() < client.reconnectionStableAt) {
            return false;
        }
        return true;
    }
    claim(job) {
        const candidates = this.clients.filter((c) => this.isClientStable(c));
        const preferred = job.options.preferredClientIds?.length
            ? candidates.filter((c) => job.options.preferredClientIds?.includes(c.id))
            : candidates;
        const filtered = preferred
            .filter((client) => !job.options.excludeClientIds?.includes(client.id))
            .filter((client) => !this.strategy.shouldSkipClient(client, job));
        const chosen = filtered[0];
        if (!chosen) {
            return null;
        }
        chosen.busy = true;
        chosen.lastSeenAt = Date.now();
        return {
            client: chosen.client,
            clientId: chosen.id,
            release: (opts) => {
                chosen.busy = false;
                if (opts?.success) {
                    const wasBlocked = this.strategy.isWorkflowBlocked?.(chosen, job.workflowHash) ?? false;
                    this.strategy.recordSuccess(chosen, job);
                    const stillBlocked = this.strategy.isWorkflowBlocked?.(chosen, job.workflowHash) ?? false;
                    if (wasBlocked && !stillBlocked) {
                        this.emitUnblocked(chosen.id, job.workflowHash);
                    }
                }
                this.dispatchEvent(new CustomEvent("client:state", {
                    detail: { clientId: chosen.id, online: chosen.online, busy: chosen.busy }
                }));
            }
        };
    }
    recordFailure(clientId, job, error) {
        const client = this.clients.find((c) => c.id === clientId);
        if (!client) {
            return;
        }
        client.lastError = error;
        client.busy = false;
        const wasBlocked = this.strategy.isWorkflowBlocked?.(client, job.workflowHash) ?? false;
        this.strategy.recordFailure(client, job, error);
        const isBlocked = this.strategy.isWorkflowBlocked?.(client, job.workflowHash) ?? false;
        if (!wasBlocked && isBlocked) {
            this.emitBlocked(client.id, job.workflowHash);
        }
        this.dispatchEvent(new CustomEvent("client:state", {
            detail: { clientId: client.id, online: client.online, busy: client.busy, lastError: error }
        }));
    }
    /**
     * Start periodic health check to keep connections alive and detect issues early.
     * Pings idle clients by polling their queue status.
     */
    startHealthCheck() {
        if (this.healthCheckInterval) {
            return; // Already running
        }
        this.healthCheckInterval = setInterval(() => {
            this.performHealthCheck().catch((error) => {
                console.error("[ClientManager] Health check error:", error);
            });
        }, this.healthCheckIntervalMs);
    }
    /**
     * Perform health check on all clients.
     * Polls queue status to keep WebSocket alive and detect connection issues.
     * IMPORTANT: Pings ALL online clients (including busy ones) to prevent WebSocket timeout during heavy load.
     */
    async performHealthCheck() {
        for (const managed of this.clients) {
            // Ping ALL online clients (not just idle ones) to keep WebSocket alive during heavy load
            if (managed.online) {
                try {
                    // Lightweight ping: poll queue status (triggers WebSocket activity via fetchApi)
                    await managed.client.getQueue();
                    managed.lastSeenAt = Date.now();
                }
                catch (error) {
                    // Health check failed - client may have connection issues
                    console.warn(`[ClientManager] Health check failed for client ${managed.id}:`, error);
                    // Don't mark as offline here - let the WebSocket disconnect event handle that
                    // This prevents false positives from temporary network hiccups
                }
            }
        }
    }
    /**
     * Stop health check interval (called during shutdown).
     */
    stopHealthCheck() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    }
    /**
     * Cleanup resources when destroying the manager.
     */
    destroy() {
        this.stopHealthCheck();
    }
}
//# sourceMappingURL=ClientManager.js.map