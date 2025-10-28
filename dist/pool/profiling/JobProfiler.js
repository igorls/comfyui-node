/**
 * Job Profiler - Automatic per-node execution profiling for WorkflowPool
 * =======================================================================
 *
 * Captures detailed execution metrics for workflow jobs automatically:
 * - Per-node execution timing
 * - Progress tracking for nodes that emit progress events
 * - Execution order and dependencies
 * - Node types and metadata
 *
 * Usage:
 * ```ts
 * const pool = new WorkflowPool(clients, { enableProfiling: true });
 * const jobId = await pool.enqueue(workflow);
 *
 * pool.on('job:completed', (event) => {
 *   console.log(event.detail.job.profileStats);
 * });
 * ```
 */
/**
 * JobProfiler tracks execution metrics for a single workflow job.
 */
export class JobProfiler {
    queuedAt;
    startedAt;
    completedAt;
    promptId;
    nodeProfiles = new Map();
    lastExecutingNode = null;
    constructor(queuedAt, workflowJson) {
        this.queuedAt = queuedAt;
        // Initialize node profiles from workflow structure
        if (workflowJson) {
            for (const [nodeId, nodeData] of Object.entries(workflowJson)) {
                const node = nodeData;
                if (node && typeof node === 'object' && node.class_type) {
                    this.nodeProfiles.set(nodeId, {
                        nodeId,
                        type: node.class_type,
                        title: node._meta?.title,
                        cached: false,
                        status: 'pending'
                    });
                }
            }
        }
    }
    /**
     * Record execution start event
     */
    onExecutionStart(promptId) {
        this.promptId = promptId;
        if (!this.startedAt) {
            this.startedAt = Date.now();
        }
    }
    /**
     * Record cached nodes
     */
    onCachedNodes(nodeIds) {
        const now = Date.now();
        for (const nodeId of nodeIds) {
            let profile = this.nodeProfiles.get(nodeId);
            if (!profile) {
                profile = {
                    nodeId,
                    cached: true,
                    status: 'cached'
                };
                this.nodeProfiles.set(nodeId, profile);
            }
            profile.cached = true;
            profile.status = 'cached';
            profile.startedAt = now;
            profile.completedAt = now;
            profile.duration = 0;
        }
    }
    /**
     * Record node execution start
     */
    onNodeExecuting(nodeId) {
        // Complete previous node if any
        if (this.lastExecutingNode && this.lastExecutingNode !== nodeId) {
            this.completeNode(this.lastExecutingNode);
        }
        // Start tracking new node
        let profile = this.nodeProfiles.get(nodeId);
        if (!profile) {
            profile = {
                nodeId,
                cached: false,
                status: 'executing'
            };
            this.nodeProfiles.set(nodeId, profile);
        }
        if (!profile.startedAt) {
            profile.startedAt = Date.now();
            profile.status = 'executing';
        }
        this.lastExecutingNode = nodeId;
    }
    /**
     * Record node completion (when next node starts or execution ends)
     */
    completeNode(nodeId) {
        const profile = this.nodeProfiles.get(nodeId);
        if (profile && !profile.completedAt && profile.startedAt) {
            profile.completedAt = Date.now();
            profile.duration = profile.completedAt - profile.startedAt;
            profile.status = 'completed';
        }
    }
    /**
     * Record execution end (node: null event)
     */
    onExecutionComplete() {
        // Complete last executing node
        if (this.lastExecutingNode) {
            this.completeNode(this.lastExecutingNode);
            this.lastExecutingNode = null;
        }
        // Mark any nodes still in "executing" state as completed
        for (const profile of Array.from(this.nodeProfiles.values())) {
            if (profile.status === 'executing' && !profile.completedAt && profile.startedAt) {
                profile.completedAt = Date.now();
                profile.duration = profile.completedAt - profile.startedAt;
                profile.status = 'completed';
            }
        }
        this.completedAt = Date.now();
    }
    /**
     * Record progress event for a node
     */
    onProgress(progress) {
        if (!progress.node)
            return;
        const nodeId = String(progress.node);
        let profile = this.nodeProfiles.get(nodeId);
        if (!profile) {
            profile = {
                nodeId,
                cached: false,
                status: 'executing',
                progressEvents: []
            };
            this.nodeProfiles.set(nodeId, profile);
        }
        if (!profile.progressEvents) {
            profile.progressEvents = [];
        }
        profile.progressEvents.push({
            timestamp: Date.now(),
            value: progress.value,
            max: progress.max
        });
    }
    /**
     * Record node execution error
     */
    onNodeError(nodeId, error) {
        let profile = this.nodeProfiles.get(nodeId);
        if (!profile) {
            profile = {
                nodeId,
                cached: false,
                status: 'failed'
            };
            this.nodeProfiles.set(nodeId, profile);
        }
        profile.status = 'failed';
        profile.error = error;
        profile.completedAt = Date.now();
        if (profile.startedAt) {
            profile.duration = profile.completedAt - profile.startedAt;
        }
    }
    /**
     * Generate final profile statistics
     */
    getStats() {
        const now = Date.now();
        const completedAt = this.completedAt || now;
        const startedAt = this.startedAt || this.queuedAt;
        const nodes = Array.from(this.nodeProfiles.values());
        // Calculate summary statistics
        const executedNodes = nodes.filter(n => n.status === 'completed').length;
        const cachedNodes = nodes.filter(n => n.cached).length;
        const failedNodes = nodes.filter(n => n.status === 'failed').length;
        const slowestNodes = nodes
            .filter(n => n.duration && n.duration > 0)
            .sort((a, b) => (b.duration || 0) - (a.duration || 0))
            .slice(0, 5)
            .map(n => ({
            nodeId: n.nodeId,
            type: n.type,
            title: n.title,
            duration: n.duration
        }));
        const progressNodes = nodes
            .filter(n => n.progressEvents && n.progressEvents.length > 0)
            .map(n => n.nodeId);
        return {
            promptId: this.promptId,
            totalDuration: completedAt - this.queuedAt,
            queueTime: startedAt - this.queuedAt,
            executionTime: completedAt - startedAt,
            queuedAt: this.queuedAt,
            startedAt: this.startedAt,
            completedAt,
            nodes,
            summary: {
                totalNodes: nodes.length,
                executedNodes,
                cachedNodes,
                failedNodes,
                slowestNodes,
                progressNodes
            }
        };
    }
}
//# sourceMappingURL=JobProfiler.js.map