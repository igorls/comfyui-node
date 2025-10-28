export class SmartFailoverStrategy {
    workflowFailures = new Map();
    cooldownMs;
    maxFailuresBeforeBlock;
    constructor(opts) {
        this.cooldownMs = opts?.cooldownMs ?? 60_000;
        this.maxFailuresBeforeBlock = opts?.maxFailuresBeforeBlock ?? 1;
    }
    shouldSkipClient(client, job) {
        const workflowMap = this.workflowFailures.get(client.id);
        if (!workflowMap) {
            return false;
        }
        const entry = workflowMap.get(job.workflowHash);
        if (!entry) {
            return false;
        }
        if (entry.blockedUntil > Date.now()) {
            return true;
        }
        workflowMap.delete(job.workflowHash);
        return false;
    }
    recordFailure(client, job, error) {
        let workflowMap = this.workflowFailures.get(client.id);
        if (!workflowMap) {
            workflowMap = new Map();
            this.workflowFailures.set(client.id, workflowMap);
        }
        const existing = workflowMap.get(job.workflowHash);
        const failureCount = (existing?.failureCount ?? 0) + 1;
        const blocked = failureCount >= this.maxFailuresBeforeBlock;
        workflowMap.set(job.workflowHash, {
            failureCount,
            blockedUntil: blocked ? Date.now() + this.cooldownMs : Date.now()
        });
    }
    recordSuccess(client, job) {
        const workflowMap = this.workflowFailures.get(client.id);
        if (!workflowMap) {
            return;
        }
        workflowMap.delete(job.workflowHash);
        if (workflowMap.size === 0) {
            this.workflowFailures.delete(client.id);
        }
    }
    resetForWorkflow(workflowHash) {
        for (const [, map] of Array.from(this.workflowFailures)) {
            map.delete(workflowHash);
        }
    }
    isWorkflowBlocked(client, workflowHash) {
        const workflowMap = this.workflowFailures.get(client.id);
        if (!workflowMap) {
            return false;
        }
        const entry = workflowMap.get(workflowHash);
        if (!entry) {
            return false;
        }
        return entry.blockedUntil > Date.now();
    }
}
//# sourceMappingURL=SmartFailoverStrategy.js.map