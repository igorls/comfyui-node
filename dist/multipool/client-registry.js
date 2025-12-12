import { ComfyApi } from "../client.js";
export class ClientRegistry {
    pool;
    events;
    clients = new Map();
    // Maps a workflow structure hash to a set of client URLs that have affinity for that workflow
    workflowAffinityMap = new Map();
    constructor(pool, events) {
        this.pool = pool;
        this.events = events;
    }
    addClient(clientUrl, options) {
        const comfyApi = new ComfyApi(clientUrl);
        const enhancedClient = {
            url: clientUrl,
            state: "idle",
            nodeName: new URL(clientUrl).hostname,
            priority: options?.priority,
            api: comfyApi
        };
        if (options?.workflowAffinity) {
            enhancedClient.workflowAffinity = new Set();
            for (const workflow of options.workflowAffinity) {
                let hash = workflow.structureHash;
                if (!hash) {
                    workflow.updateHash();
                    hash = workflow.structureHash;
                }
                if (!hash) {
                    throw new Error("Workflow must have a valid structure hash for affinity.");
                }
                if (!this.workflowAffinityMap.has(hash)) {
                    this.workflowAffinityMap.set(hash, new Set());
                }
                this.workflowAffinityMap.get(hash).add(clientUrl);
                enhancedClient.workflowAffinity.add(hash);
            }
        }
        this.clients.set(clientUrl, enhancedClient);
    }
    removeClient(clientUrl) {
        this.clients.delete(clientUrl);
    }
    async getQueueStatus(clientUrl) {
        const comfyApi = this.clients.get(clientUrl)?.api;
        if (!comfyApi) {
            throw new Error(`Client ${clientUrl} not found`);
        }
        return comfyApi.getQueue();
    }
    getOptimalClient(workflow, priorityOverrides) {
        let workflowHash = workflow.structureHash;
        if (!workflowHash) {
            workflow.updateHash();
            workflowHash = workflow.structureHash;
        }
        if (!workflowHash) {
            throw new Error("Workflow must have a valid structure hash.");
        }
        // Filter clients based on workflow affinity
        const suitableClients = [];
        for (const client of this.clients.values()) {
            if (client.state !== "idle") {
                continue;
            }
            if (client.workflowAffinity && client.workflowAffinity.has(workflowHash)) {
                suitableClients.push(client);
            }
        }
        if (suitableClients.length === 0) {
            this.events.emitEvent({ type: "debug", payload: `No suitable clients found for workflow ${workflowHash}.` });
            return null;
        }
        this.events.emitEvent({ type: "debug", payload: `Suitable clients for workflow ${workflowHash}: ${suitableClients.map(value => value.nodeName).join(",")}` });
        // sort suitable clients by priority (use override if provided, otherwise static priority)
        suitableClients.sort((a, b) => {
            const priorityA = priorityOverrides?.get(a.url) ?? a.priority ?? 0;
            const priorityB = priorityOverrides?.get(b.url) ?? b.priority ?? 0;
            return priorityB - priorityA; // higher priority first
        });
        return suitableClients.length > 0 ? suitableClients[0] : null;
    }
    hasClientsForWorkflow(workflowHash) {
        const clientSet = this.workflowAffinityMap.get(workflowHash);
        return clientSet !== undefined && clientSet.size > 0;
    }
    // Get an optimal idle client for a given workflow (used for general queue)
    async getOptimalIdleClient(workflow, priorityOverrides) {
        this.events.emitEvent({ type: "debug", payload: `Searching for idle clients for workflow ${workflow.structureHash}...` });
        // We can infer model capabilities from workflow and try to get the best idle client, based on other workflow affinities, for now lets pick any idle client
        const idleClients = [];
        for (const client of this.clients.values()) {
            if (client.state === "idle") {
                // For the general queue, we need to check the actual queue state
                await this.checkClientQueueState(client);
                if (client.state === "idle") {
                    this.events.emitEvent({ type: "debug", payload: `Client ${client.nodeName} is idle.` });
                    idleClients.push(client);
                }
            }
        }
        this.events.emitEvent({ type: "debug", payload: `Idle clients available: ${idleClients.map(value => value.nodeName).join(",")}` });
        // sort idle clients by priority (use override if provided, otherwise static priority)
        idleClients.sort((a, b) => {
            const priorityA = priorityOverrides?.get(a.url) ?? a.priority ?? 0;
            const priorityB = priorityOverrides?.get(b.url) ?? b.priority ?? 0;
            return priorityB - priorityA; // higher priority first
        });
        return idleClients.length > 0 ? idleClients[0] : null;
    }
    async checkClientQueueState(client) {
        try {
            const queue = await this.getQueueStatus(client.url);
            if (queue.queue_running.length > 0 || queue.queue_pending.length > 0) {
                client.state = "busy";
            }
            else {
                client.state = "idle";
            }
        }
        catch (error) {
            this.events.emitEvent({ type: "error", payload: { message: `Error checking queue state for client ${client.nodeName}`, error } });
            client.state = "offline";
        }
    }
    markClientIncompatibleWithWorkflow(url, structureHash) {
        const client = this.clients.get(url);
        if (client && structureHash && client.workflowAffinity) {
            client.workflowAffinity.delete(structureHash);
            const affinitySet = this.workflowAffinityMap.get(structureHash);
            if (affinitySet) {
                affinitySet.delete(url);
                if (affinitySet.size === 0) {
                    this.workflowAffinityMap.delete(structureHash);
                }
            }
        }
    }
    getAllEligibleClientsForWorkflow(workflow) {
        const eligibleClients = [];
        const workflowHash = workflow.structureHash;
        if (!workflowHash) {
            throw new Error("Workflow must have a valid structure hash.");
        }
        for (const client of this.clients.values()) {
            if (client.workflowAffinity && client.workflowAffinity.has(workflowHash)) {
                eligibleClients.push(client);
            }
        }
        return eligibleClients;
    }
}
//# sourceMappingURL=client-registry.js.map