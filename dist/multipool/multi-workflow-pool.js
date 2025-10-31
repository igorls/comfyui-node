import { ClientRegistry } from "src/multipool/client-registry.js";
import { PoolEventManager } from "src/multipool/pool-event-manager.js";
import { JobStateRegistry } from "src/multipool/tests/job-state-registry.js";
import { JobQueueProcessor } from "src/multipool/job-queue-processor.js";
/**
 * MultiWorkflowPool class to manage heterogeneous clusters of ComfyUI workers with different workflow capabilities.
 * Using a fully event driven architecture to handle client connections, job submissions, and failover strategies.
 * Zero polling is used; all operations are event driven. Maximizes responsiveness and scalability.
 */
export class MultiWorkflowPool {
    // Event manager for handling pool events
    events;
    // Registry for managing clients in the pool
    clientRegistry;
    // Registry for managing job state
    jobRegistry;
    // Multi queue map, one per workflow based on the workflow hash
    queues = new Map();
    constructor() {
        this.events = new PoolEventManager(this);
        this.clientRegistry = new ClientRegistry(this);
        this.jobRegistry = new JobStateRegistry(this);
    }
    // PUBLIC API
    async init() {
    }
    async shutdown() {
    }
    addClient(clientUrl) {
        this.clientRegistry.addClient(clientUrl);
    }
    removeClient(clientUrl) {
        this.clientRegistry.removeClient(clientUrl);
    }
    async submitJob(workflow) {
        let workflowHash = workflow.structureHash;
        if (!workflowHash) {
            workflow.updateHash();
            workflowHash = workflow.structureHash;
        }
        const queue = this.assertQueue(workflowHash);
        if (!queue) {
            throw new Error("Failed to create or retrieve job queue for workflow.");
        }
        const newJobId = this.jobRegistry.addJob(workflow);
        queue.enqueueJob(newJobId, workflow);
        return newJobId;
    }
    getJobStatus(jobId) {
        return this.jobRegistry.getJobStatus(jobId);
    }
    async cancelJob(jobId) {
        this.jobRegistry.cancelJob(jobId);
    }
    attachEventHook(event, listener) {
        if (event && listener) {
            this.events.attachHook(event, listener);
        }
    }
    // PRIVATE METHODS
    assertQueue(workflowHash) {
        if (!workflowHash) {
            return null;
        }
        let queue = this.queues.get(workflowHash);
        if (!queue) {
            queue = new JobQueueProcessor(this);
            this.queues.set(workflowHash, queue);
        }
        return queue;
    }
}
//# sourceMappingURL=multi-workflow-pool.js.map