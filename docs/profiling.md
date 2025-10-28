# WorkflowPool Automatic Profiling

## Overview

**Version**: 1.5.0  
**Status**: ✅ Complete and Tested

WorkflowPool now includes built-in execution profiling that automatically captures detailed per-node metrics without requiring any extra developer effort. Simply enable `enableProfiling: true` in the WorkflowPoolOpts and access profiling stats via `job.profileStats` when jobs complete.

## Features

### Automatic Metrics Collection

The profiler automatically tracks:

- **Per-node execution timing** - Start time, end time, and duration for each node
- **Progress events** - Captures progress steps for long-running nodes (e.g., KSampler: 1/20, 2/20, ...)
- **Execution order** - Chronological sequence of node execution
- **Cached vs Executed nodes** - Identifies which nodes were cached (instant) vs actually executed
- **Node metadata** - Node types, titles, and status (pending, executing, completed, cached, failed)
- **Queue metrics** - Time spent waiting in queue before execution starts
- **Summary statistics** - Total duration, slowest nodes, progress nodes, execution counts

### Zero Developer Overhead

No need to:
- Manually attach event listeners
- Track node execution yourself  
- Parse WebSocket events
- Build stats objects
- Clean up resources

Everything is handled automatically by the WorkflowPool.

## Usage

### Basic Example

```typescript
import { ComfyApi, Workflow, WorkflowPool } from 'comfyui-node';

// Create pool with profiling enabled
const pool = new WorkflowPool([client], {
  enableProfiling: true  // ✨ That's it!
});

// Listen to completion events
pool.on('job:completed', (event) => {
  const stats = event.detail.job.profileStats;
  
  console.log(`Total: ${stats.totalDuration}ms`);
  console.log(`Execution: ${stats.executionTime}ms`);
  console.log(`Queue time: ${stats.queueTime}ms`);
  
  // Slowest nodes
  for (const node of stats.summary.slowestNodes) {
    console.log(`${node.nodeId}: ${node.type} - ${node.duration}ms`);
  }
});

// Enqueue job - profiling happens automatically!
const jobId = await pool.enqueue(workflow);
```

### Accessing Profile Stats

Profile stats are available in two places:

1. **JobRecord** - Via `job.profileStats` after completion
2. **job:completed event** - Via `event.detail.job.profileStats`

```typescript
// From job record
const job = await pool.getJob(jobId);
if (job.profileStats) {
  console.log(job.profileStats);
}

// From event
pool.on('job:completed', (event) => {
  const stats = event.detail.job.profileStats;
  if (stats) {
    // Use stats...
  }
});
```

## API Reference

### WorkflowPoolOpts

```typescript
interface WorkflowPoolOpts {
  /**
   * Enable automatic profiling of workflow execution.
   * 
   * When enabled, captures detailed per-node execution metrics including:
   * - Node execution timing (start, end, duration)
   * - Progress events for long-running nodes
   * - Cached vs executed nodes
   * - Execution order and dependencies
   * 
   * Profile stats are attached to `JobRecord.profileStats` and included
   * in `job:completed` event details.
   * 
   * @default false
   */
  enableProfiling?: boolean;
  
  // ... other options
}
```

### JobProfileStats

```typescript
interface JobProfileStats {
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
```

### NodeExecutionProfile

```typescript
interface NodeExecutionProfile {
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
```

## Example Output

```
📊 Execution Profile:
════════════════════════════════════════════════════════════════════════════════
Prompt ID: b62abe3b-24a5-4006-a920-fe47041bfd4f
Total Duration: 8747ms
Queue Time: 8ms
Execution Time: 8739ms

📈 Summary:
  Total Nodes: 7
  Executed: 6
  Cached: 0
  Failed: 0

🐌 Slowest Nodes:
  3: KSampler (KSampler) - 4328ms
  4: CheckpointLoaderSimple (Load Checkpoint) - 3540ms
  7: CLIPTextEncode (Negative Prompt) - 592ms
  8: VAEDecode (VAE Decode) - 158ms
  6: CLIPTextEncode (Positive Prompt) - 45ms

⚡ Progress Events Captured:
  3: KSampler (KSampler) - 1/20, 2/20, 3/20, ..., 19/20, 20/20

📋 All Nodes:
────────────────────────────────────────────────────────────────────────────────
Node ID    | Type                      | Status     | Duration
────────────────────────────────────────────────────────────────────────────────
4          | CheckpointLoaderSimple    | completed  | 3540ms
5          | EmptyLatentImage          | completed  | 1ms
7          | CLIPTextEncode            | completed  | 592ms
6          | CLIPTextEncode            | completed  | 45ms
3          | KSampler                  | completed  | 4328ms
8          | VAEDecode                 | completed  | 158ms
9          | SaveImage                 | completed  | 0ms
════════════════════════════════════════════════════════════════════════════════
```

## Implementation Details

### Architecture

The profiling system consists of:

1. **JobProfiler** (`src/pool/profiling/JobProfiler.ts`) - Core profiler class that tracks execution
2. **WorkflowPool Integration** - Automatic setup/teardown of profiler per job
3. **Event Listeners** - Hooks into ComfyUI client events:
   - `execution_start` - Marks execution start
   - `execution_cached` - Records cached nodes
   - `executing` - Tracks node start/completion
   - `execution_error` - Captures node failures
   - `progress` - Records progress updates

### Event Flow

```
Job Enqueued
    ↓
[Profiler Created (if enabled)]
    ↓
Event Listeners Attached to Client
    ↓
execution_start → Record promptId & start time
    ↓
execution_cached → Mark cached nodes (duration: 0ms)
    ↓
executing (node: "3") → Start tracking node 3
    ↓
progress (node: 3, value: 1/20) → Record progress
    ↓
executing (node: "4") → Complete node 3, start node 4
    ↓
executing (node: null) → Complete last node, finalize stats
    ↓
onFinished → Attach stats to JobRecord
    ↓
Event Listeners Cleaned Up
    ↓
job:completed Event Dispatched (with profileStats)
```

### Performance Impact

- **Disabled** (default): Zero overhead, no profiler instantiated
- **Enabled**: Minimal overhead
  - ~5 event listeners per job
  - In-memory Map for node tracking
  - Automatic cleanup on completion

### Generic Design

The profiler works with **any workflow structure**:
- Dynamically discovers nodes from workflow JSON
- No hardcoded node types or IDs
- Adapts to workflow size and complexity
- Handles missing metadata gracefully

## Use Cases

### Performance Optimization

Identify bottlenecks in workflows:

```typescript
pool.on('job:completed', (event) => {
  const stats = event.detail.job.profileStats;
  
  // Find nodes taking > 5 seconds
  const slowNodes = stats.nodes.filter(n => n.duration && n.duration > 5000);
  
  if (slowNodes.length > 0) {
    console.warn('Slow nodes detected:', slowNodes);
  }
});
```

### Progress Tracking

Monitor long-running operations:

```typescript
const progressNodes = stats.summary.progressNodes;
for (const nodeId of progressNodes) {
  const node = stats.nodes.find(n => n.nodeId === nodeId);
  console.log(`${node.type}: ${node.progressEvents.length} steps`);
}
```

### Cache Hit Analysis

Measure cache effectiveness:

```typescript
const cacheRate = (stats.summary.cachedNodes / stats.summary.totalNodes) * 100;
console.log(`Cache hit rate: ${cacheRate.toFixed(1)}%`);

if (cacheRate > 80) {
  console.log('Excellent caching! Most nodes were cached.');
}
```

### Production Monitoring

Track workflow execution in production:

```typescript
pool.on('job:completed', (event) => {
  const stats = event.detail.job.profileStats;
  
  // Log to monitoring service
  await metrics.record({
    workflow: event.detail.job.workflowHash,
    totalDuration: stats.totalDuration,
    executionTime: stats.executionTime,
    queueTime: stats.queueTime,
    nodeCount: stats.summary.totalNodes,
    cachedNodes: stats.summary.cachedNodes,
    slowestNode: stats.summary.slowestNodes[0]
  });
});
```

## Testing

Run the demo script to see profiling in action:

```bash
bun run scripts/demo-pool-profiling.ts
```

The demo:
1. Creates a WorkflowPool with profiling enabled
2. Enqueues a simple txt2img workflow
3. Displays detailed profiling output on completion
4. Shows all metrics (timing, progress, cache, etc.)

## Backward Compatibility

- **Default behavior unchanged**: Profiling is disabled by default
- **No breaking changes**: Existing code works without modifications
- **Optional feature**: Enable only when needed
- **Type-safe**: Full TypeScript support with exported types

## Migration from External Profiler

If you were using the standalone profiler script (`scripts/profile-workflow-advanced.ts`):

**Before** (manual profiling):
```typescript
const profiler = new AdvancedWorkflowProfiler(pool, workflow);
const result = await profiler.profileWorkflow();
console.log(result.stats);
```

**After** (automatic profiling):
```typescript
const pool = new WorkflowPool(clients, { enableProfiling: true });

pool.on('job:completed', (event) => {
  console.log(event.detail.job.profileStats);
});

await pool.enqueue(workflow);
```

Benefits:
- 50% less code
- No manual event management
- Automatic cleanup
- Works for all workflows in the pool
- Available in production without code changes

## Future Enhancements

Potential additions for future versions:

- [ ] Per-node memory usage tracking
- [ ] GPU utilization metrics
- [ ] Network/disk I/O monitoring
- [ ] Comparison between runs
- [ ] Profiling export formats (JSON, CSV)
- [ ] Real-time profiling dashboard
- [ ] Profiling aggregation across multiple jobs
- [ ] Custom profiling hooks/callbacks

## Troubleshooting

### Stats are undefined

Make sure profiling is enabled:
```typescript
const pool = new WorkflowPool(clients, {
  enableProfiling: true  // Must be true!
});
```

### Missing node metadata

Some nodes may not have type/title if the workflow JSON doesn't include `class_type` or `_meta` fields. This is normal and doesn't affect timing metrics.

### Progress events not captured

Only nodes that emit progress events (like KSampler) will have `progressEvents`. Other nodes complete instantly without progress updates.

### Different execution times between runs

First run will be slower due to model loading. Subsequent runs benefit from caching. Compare `stats.summary.cachedNodes` to see cache effectiveness.

## Related Documentation

- [WorkflowPool Guide](../docs/workflow-pool.md)
- [Getting Started](../docs/getting-started.md)
- [API Reference](../README.md#api)

---

**Created**: December 2024  
**Author**: ComfyUI Node SDK Team  
**License**: MIT
