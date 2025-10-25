import { TypedEventTarget } from "../../typed-event-target.js";
export class ClientManager extends TypedEventTarget {
    clients = [];
    strategy;
    healthCheckInterval = null;
    healthCheckIntervalMs;
    checkpointCacheTTL = 5 * 60 * 1000; // 5 minutes
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
            this.dispatchEvent(new CustomEvent("client:state", {
                detail: { clientId: managed.id, online: false, busy: false, lastError: managed.lastError }
            }));
        });
        client.on("reconnected", () => {
            managed.online = true;
            managed.lastSeenAt = Date.now();
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
    claim(job) {
        const candidates = this.clients.filter((c) => c.online && !c.busy);
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
    async claimAsync(job) {
        const candidates = this.clients.filter((c) => c.online && !c.busy);
        const preferred = job.options.preferredClientIds?.length
            ? candidates.filter((c) => job.options.preferredClientIds?.includes(c.id))
            : candidates;
        let filtered = preferred
            .filter((client) => !job.options.excludeClientIds?.includes(client.id))
            .filter((client) => !this.strategy.shouldSkipClient(client, job));
        // Filter by required checkpoints if specified
        if (job.options.requiredCheckpoints && job.options.requiredCheckpoints.length > 0) {
            const checkpointFilteredClients = [];
            for (const client of filtered) {
                const clientCheckpoints = await this.getClientCheckpoints(client.id);
                const hasAllCheckpoints = job.options.requiredCheckpoints.every(ckpt => clientCheckpoints.includes(ckpt));
                if (hasAllCheckpoints) {
                    checkpointFilteredClients.push(client);
                }
            }
            filtered = checkpointFilteredClients;
        }
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
     * Gets available checkpoints for a specific client, with caching.
     * @public Exposed para uso pelo WorkflowPool
     */
    async getClientCheckpoints(clientId) {
        const managed = this.clients.find(c => c.id === clientId);
        if (!managed) {
            return [];
        }
        const now = Date.now();
        const cachedTime = managed.checkpointsCachedAt || 0;
        const isCacheValid = (now - cachedTime) < this.checkpointCacheTTL;
        if (isCacheValid && managed.availableCheckpoints) {
            return Array.from(managed.availableCheckpoints);
        }
        try {
            const checkpoints = await managed.client.getCheckpoints();
            managed.availableCheckpoints = new Set(checkpoints);
            managed.checkpointsCachedAt = now;
            return checkpoints;
        }
        catch (error) {
            console.error(`[ClientManager] Failed to fetch checkpoints for client ${clientId}:`, error);
            return [];
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