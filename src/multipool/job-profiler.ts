/**
 * Job Profiler for MultiWorkflowPool - Automatic per-node execution profiling
 * ===========================================================================
 * 
 * Captures detailed execution metrics for workflow jobs automatically:
 * - Per-node execution timing
 * - Progress tracking for nodes that emit progress events
 * - Execution order and dependencies
 * - Node types and metadata
 * 
 * Usage:
 * ```ts
 * const pool = new MultiWorkflowPool({ enableProfiling: true });
 * const jobId = await pool.submitJob(workflow);
 * 
 * const results = await pool.waitForJobCompletion(jobId);
 * console.log(results.profileStats);
 * ```
 */

export interface NodeExecutionProfile {
  /** Node ID */
  nodeId: string;
  /** Node class type (e.g., KSampler, VAELoader) */
  type?: string;
  /** Node title/label */
  title?: string;
  /** Timestamp when node started executing (ms since epoch) */
  startedAt?: number;
  /** Timestamp when node completed (ms since epoch) */
  completedAt?: number;
  /** Execution duration in milliseconds */
  duration?: number;
  /** Progress events captured for this node */
  progressEvents?: Array<{
    timestamp: number;
    value: number;
    max: number;
  }>;
  /** Whether this node was cached (instant execution) */
  cached: boolean;
  /** Execution status */
  status: 'pending' | 'executing' | 'completed' | 'cached' | 'failed';
  /** Error message if failed */
  error?: string;
}

export interface JobProfileStats {
  /** Prompt ID from ComfyUI */
  promptId?: string;
  /** Total execution time from queue to completion (ms) */
  totalDuration: number;
  /** Time spent in queue before execution started (ms) */
  queueTime: number;
  /** Actual execution time (ms) */
  executionTime: number;
  /** Timestamp when job was queued */
  queuedAt: number;
  /** Timestamp when execution started */
  startedAt?: number;
  /** Timestamp when execution completed */
  completedAt: number;
  /** Per-node execution profiles */
  nodes: NodeExecutionProfile[];
  /** Execution timeline summary */
  summary: {
    /** Total number of nodes in workflow */
    totalNodes: number;
    /** Number of nodes actually executed */
    executedNodes: number;
    /** Number of cached nodes */
    cachedNodes: number;
    /** Number of failed nodes */
    failedNodes: number;
    /** Slowest nodes (top 5) */
    slowestNodes: Array<{
      nodeId: string;
      type?: string;
      title?: string;
      duration: number;
    }>;
    /** Nodes that emitted progress events */
    progressNodes: string[];
  };
}

/**
 * JobProfiler tracks execution metrics for a single workflow job.
 */
export class JobProfiler {
  private queuedAt: number;
  private startedAt?: number;
  private completedAt?: number;
  private promptId?: string;
  private nodeProfiles: Map<string, NodeExecutionProfile> = new Map();
  private lastExecutingNode: string | null = null;

  constructor(queuedAt: number, workflowJson?: Record<string, any>) {
    this.queuedAt = queuedAt;
    
    // Initialize node profiles from workflow structure
    if (workflowJson) {
      for (const [nodeId, nodeData] of Object.entries(workflowJson)) {
        const node = nodeData as any;
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
  onExecutionStart(promptId: string): void {
    this.promptId = promptId;
    if (!this.startedAt) {
      this.startedAt = Date.now();
    }
  }

  /**
   * Record cached nodes
   */
  onCachedNodes(nodeIds: string[]): void {
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
  onNodeExecuting(nodeId: string): void {
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
  private completeNode(nodeId: string): void {
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
  onExecutionComplete(): void {
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
  onProgress(nodeId: string | number, value: number, max: number): void {
    const nodeIdStr = String(nodeId);
    let profile = this.nodeProfiles.get(nodeIdStr);
    
    if (!profile) {
      profile = {
        nodeId: nodeIdStr,
        cached: false,
        status: 'executing',
        progressEvents: []
      };
      this.nodeProfiles.set(nodeIdStr, profile);
    }

    if (!profile.progressEvents) {
      profile.progressEvents = [];
    }

    profile.progressEvents.push({
      timestamp: Date.now(),
      value,
      max
    });
  }

  /**
   * Record node execution error
   */
  onNodeError(nodeId: string, error: string): void {
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
  getStats(): JobProfileStats {
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
        duration: n.duration!
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
