import { TypedEventTarget } from "../../typed-event-target.js";
export class ClientManager extends TypedEventTarget {
    clients = [];
    strategy;
    constructor(strategy) {
        super();
        this.strategy = strategy;
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
}
//# sourceMappingURL=ClientManager.js.map