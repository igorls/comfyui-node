# Job Profiling in MultiWorkflowPool

The MultiWorkflowPool includes integrated per-node execution profiling to help you understand and optimize workflow performance.

## Overview

Job profiling automatically tracks:
- **Per-node execution timing** - Duration of each node's execution
- **Progress tracking** - Capture progress events for nodes that emit them (e.g., KSampler)
- **Execution order** - Timeline showing the sequence of node execution
- **Cached nodes** - Identify which nodes were cached (instant execution)
- **Node metadata** - Node types, titles, and other metadata

## Enabling Profiling

Enable profiling when creating your pool:

```typescript
import { MultiWorkflowPool } from "comfyui-node/multipool";

const pool = new MultiWorkflowPool({
  enableProfiling: true  // Enable job profiling
});
```

## Accessing Profile Data

Profile statistics are included in the job results when profiling is enabled:

```typescript
const jobId = await pool.submitJob(workflow);
const result = await pool.waitForJobCompletion(jobId);

if (result.profileStats) {
  console.log("Total execution time:", result.profileStats.totalDuration, "ms");
  console.log("Queue time:", result.profileStats.queueTime, "ms");
  console.log("Execution time:", result.profileStats.executionTime, "ms");
}
```

## Profile Statistics Structure

### JobProfileStats

```typescript
interface JobProfileStats {
  promptId?: string;           // ComfyUI prompt ID
  totalDuration: number;        // Queue + execution time (ms)
  queueTime: number;            // Time spent in queue (ms)
  executionTime: number;        // Actual execution time (ms)
  queuedAt: number;             // Timestamp when queued
  startedAt?: number;           // Timestamp when execution started
  completedAt: number;          // Timestamp when completed
  nodes: NodeExecutionProfile[]; // Per-node profiles
  summary: {
    totalNodes: number;
    executedNodes: number;
    cachedNodes: number;
    failedNodes: number;
    slowestNodes: Array<{      // Top 5 slowest nodes
      nodeId: string;
      type?: string;
      title?: string;
      duration: number;
    }>;
    progressNodes: string[];    // Nodes that emitted progress
  };
}
```

### NodeExecutionProfile

```typescript
interface NodeExecutionProfile {
  nodeId: string;
  type?: string;                 // Node class type (e.g., "KSampler")
  title?: string;                // Node title/label
  startedAt?: number;            // Start timestamp
  completedAt?: number;          // End timestamp
  duration?: number;             // Execution time (ms)
  progressEvents?: Array<{       // Progress tracking
    timestamp: number;
    value: number;
    max: number;
  }>;
  cached: boolean;               // Whether node was cached
  status: 'pending' | 'executing' | 'completed' | 'cached' | 'failed';
  error?: string;                // Error message if failed
}
```

## Example: Analyzing Slowest Nodes

```typescript
const result = await pool.waitForJobCompletion(jobId);

if (result.profileStats) {
  console.log("\n🐌 Slowest Nodes:");
  result.profileStats.summary.slowestNodes.forEach((node, i) => {
    console.log(`${i + 1}. ${node.type} (Node ${node.nodeId}): ${node.duration}ms`);
  });
}
```

## Example: Progress Tracking

```typescript
const result = await pool.waitForJobCompletion(jobId);

if (result.profileStats) {
  // Find nodes that track progress (e.g., KSampler)
  const progressNodes = result.profileStats.nodes.filter(
    n => n.progressEvents && n.progressEvents.length > 0
  );
  
  progressNodes.forEach(node => {
    console.log(`\n${node.type} (Node ${node.nodeId}):`);
    console.log(`  Total duration: ${node.duration}ms`);
    console.log(`  Progress events: ${node.progressEvents!.length}`);
    
    // Show first and last progress
    const first = node.progressEvents![0];
    const last = node.progressEvents![node.progressEvents!.length - 1];
    console.log(`  Progress: ${first.value}/${first.max} → ${last.value}/${last.max}`);
  });
}
```

## Example: Execution Timeline

```typescript
const result = await pool.waitForJobCompletion(jobId);

if (result.profileStats) {
  // Sort nodes by execution order
  const timeline = result.profileStats.nodes
    .filter(n => n.startedAt)
    .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
  
  console.log("\n📅 Execution Timeline:");
  timeline.forEach(node => {
    const offset = node.startedAt! - result.profileStats!.startedAt!;
    const status = node.cached ? "CACHED" : "EXECUTED";
    console.log(`+${offset}ms | ${status} | ${node.type} | ${node.duration}ms`);
  });
}
```

## Example: Identifying Cached Nodes

```typescript
const result = await pool.waitForJobCompletion(jobId);

if (result.profileStats) {
  const cachedCount = result.profileStats.summary.cachedNodes;
  const totalCount = result.profileStats.summary.totalNodes;
  
  console.log(`Cache hit rate: ${cachedCount}/${totalCount} nodes`);
  
  // List cached nodes
  const cached = result.profileStats.nodes.filter(n => n.cached);
  cached.forEach(node => {
    console.log(`⚡ ${node.type} (Node ${node.nodeId}) - CACHED`);
  });
}
```

## Performance Impact

Profiling has minimal overhead:
- Events are captured in memory during execution
- Statistics are computed only once at completion
- No additional network requests or file I/O

For production use, you may want to enable profiling selectively:

```typescript
const pool = new MultiWorkflowPool({
  enableProfiling: process.env.NODE_ENV === "development"
});
```

## Use Cases

### Workflow Optimization
Identify bottleneck nodes and optimize their parameters or replace them with faster alternatives.

### Cache Analysis
Understand which nodes benefit from caching and adjust your workflow to maximize cache hits.

### Progress Monitoring
Track which nodes emit progress events for better user feedback in your application.

### Performance Regression Testing
Compare profile statistics across workflow versions to detect performance regressions.

### Capacity Planning
Use execution time data to estimate server capacity needs for production workloads.

## Complete Example

```typescript
import { MultiWorkflowPool, Workflow } from "comfyui-node/multipool";
import workflowJson from "./my-workflow.json";

const pool = new MultiWorkflowPool({
  enableProfiling: true,
  logLevel: "info"
});

pool.addClient("http://localhost:8188", {
  workflowAffinity: [Workflow.fromAugmented(workflowJson)]
});

await pool.init();

// Submit job
const workflow = Workflow.fromAugmented(workflowJson)
  .input("prompt", "value", "a beautiful landscape")
  .input("seed", "value", 42);

const jobId = await pool.submitJob(workflow);
const result = await pool.waitForJobCompletion(jobId);

// Analyze performance
if (result.profileStats) {
  const stats = result.profileStats;
  
  console.log(`\n📊 Performance Report:`);
  console.log(`Total Time: ${stats.totalDuration}ms`);
  console.log(`Queue Time: ${stats.queueTime}ms (${Math.round(stats.queueTime / stats.totalDuration * 100)}%)`);
  console.log(`Execution: ${stats.executionTime}ms (${Math.round(stats.executionTime / stats.totalDuration * 100)}%)`);
  
  console.log(`\n🎯 Node Stats:`);
  console.log(`Executed: ${stats.summary.executedNodes}`);
  console.log(`Cached: ${stats.summary.cachedNodes}`);
  
  console.log(`\n🐌 Top 3 Slowest Nodes:`);
  stats.summary.slowestNodes.slice(0, 3).forEach((node, i) => {
    const pct = Math.round(node.duration / stats.executionTime * 100);
    console.log(`${i + 1}. ${node.type}: ${node.duration}ms (${pct}%)`);
  });
}

await pool.shutdown();
```

## See Also

- [MultiWorkflowPool Getting Started](./README.md)
- [Error Handling Guide](./error-handling.md)
- [Workflow API Reference](./workflow-api.md)
