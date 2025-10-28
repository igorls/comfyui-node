# Workflow Execution Profiling Guide

This guide explains how to use the profiling tools to measure and analyze ComfyUI node execution performance.

## Overview

The profiling suite provides three levels of analysis:

1. **Basic Profiler** (`profile-workflow-execution.ts`) - Simple node timing collection
2. **Advanced Profiler** (`profile-workflow-advanced.ts`) - Memory, GPU, and parallelization analysis
3. **Test Suite** (`test/profiling.spec.ts`) - Unit tests and integration tests

## Quick Start

### Basic Profiling

Profile a workflow to see how long each node takes:

```bash
# Using default workflow
bun scripts/profile-workflow-execution.ts

# Using custom workflow
WORKFLOW=./path/to/workflow.json bun scripts/profile-workflow-execution.ts

# Custom server URL
COMFY_URL=http://192.168.1.100:8188 bun scripts/profile-workflow-execution.ts
```

**Output:**
```
📈 PROFILING REPORT
═══════════════════════════════════════════════════════════════
📋 Execution Summary:
  Prompt ID:        f1a2b3c4-d5e6-f7g8-h9i0-j1k2l3m4n5o6
  Workflow:         txt2img-workflow.json
  Total Time:       15234ms
  Total Nodes:      8
  Completed:        8
  Failed:           0

⏱️  Node Execution Statistics:
  Average Time:     1904.25ms
  Median Time:      2150.00ms
  Parallelizable:   Moderate

🐌 Top 5 Slowest Nodes:
  1. 4: KSampler
     └─ 12500.25ms
  2. 1: CheckpointLoader
     └─ 2150.00ms
  ...
```

### Advanced Profiling

Get deeper insights including memory, GPU usage, and bottleneck analysis:

```bash
# Full profiling with memory tracking
PROFILE_MEMORY=true bun scripts/profile-workflow-advanced.ts

# Verbose output with detailed logging
VERBOSE=true bun scripts/profile-workflow-advanced.ts

# Combined options
VERBOSE=true PROFILE_MEMORY=true COMFY_URL=http://localhost:8188 \
  bun scripts/profile-workflow-advanced.ts
```

**Output includes:**
- Execution timeline (queue wait vs. execution)
- Critical path analysis
- Parallelizability score (0-100%)
- Memory and GPU usage peaks
- Identified bottlenecks with impact assessment
- Optimization recommendations

### Running Tests

```bash
# Basic tests (no server required)
bun test test/profiling.spec.ts

# Full integration tests (requires real ComfyUI)
COMFY_REAL=1 bun test test/profiling.spec.ts

# With specific URL
COMFY_REAL=1 COMFY_URL=http://localhost:8188 bun test test/profiling.spec.ts
```

## Key Metrics Explained

### Execution Timeline

- **Queue Wait**: Time between submitting prompt and execution start
- **Execution Time**: Actual time nodes run
- **Total Time**: Queue wait + execution + overhead

### Performance Metrics

#### Critical Path
The longest dependency chain in your workflow. This is the theoretical minimum execution time if you could parallelize everything else.

```
Node 1 (100ms) → Node 2 (50ms) → Node 3 (500ms)
                 ↓
Critical Path = 100 + 50 + 500 = 650ms
```

#### Estimated Speedup
How much faster the workflow could theoretically run with unlimited parallelization:

```
Speedup = Total Sequential Time / Critical Path
        = (100 + 50 + 500 + 150) / 650
        = 1.15x
```

A speedup of 1.15x means even perfect parallelization would only make it 15% faster.

#### Parallelizability Score (0-100%)
Measure of how parallelizable your workflow is:

- **0-30%**: Highly sequential (limited parallelization benefit)
- **30-70%**: Moderate parallelization potential
- **70-100%**: Highly parallelizable (significant speedup possible)

Formula: `(1 - criticalPath/totalTime) * 100`

### Node Type Distribution

Shows the breakdown of different node types and their aggregate timing:

```
📊 Node Type Distribution:
  • CheckpointLoader
    Count: 1, Total: 2150.00ms, Avg: 2150.00ms
  • CLIPTextEncode
    Count: 2, Total: 150.00ms, Avg: 75.00ms
  • KSampler
    Count: 1, Total: 12500.00ms, Avg: 12500.00ms
```

### Bottleneck Analysis

Identifies performance issues:

- **Nodes taking 2x+ average time** - Consider optimization
- **Failed nodes** - Block the entire workflow
- **Memory-intensive operations** - May cause slowdowns or crashes

## Programmatic Usage

Use the profiler in your own scripts:

```typescript
import { ComfyApi, Workflow } from 'comfyui-node';

// ... profiler code ...

const profiler = new WorkflowProfiler('http://localhost:8188');
await profiler.initialize();

const workflow = Workflow.from(myWorkflowJson);
const result = await profiler.profileWorkflow(workflow, 'my-workflow');

// Access results programmatically
console.log(`Average node time: ${result.summary.averageNodeTime}ms`);
console.log(`Slowest node: ${result.summary.slowestNodes[0].nodeId}`);
console.log(`Total time: ${result.totalTime}ms`);
```

## Advanced Profiling Features

### Memory Profiling

The advanced profiler automatically samples memory usage during execution:

```bash
PROFILE_MEMORY=true bun scripts/profile-workflow-advanced.ts
```

Output includes:
- Peak system RAM usage
- GPU VRAM usage for each device
- Memory usage timeline

### GPU Monitoring

If your ComfyUI has the monitoring extension:

```bash
bun scripts/profile-workflow-advanced.ts
```

This captures:
- Per-device VRAM usage
- Peak GPU memory
- Device names and capabilities

### Event-Based Profiling

The profilers hook into WebSocket events:

- `progress` - Node execution progress
- `executed` - Node completed successfully
- `execution_error` - Node failed

Custom event tracking:

```typescript
const events: NodeExecutionEvent[] = [];

api.on('progress', (data) => {
  events.push({
    nodeId: String(data.node),
    eventType: 'progress',
    timestamp: Date.now(),
    progressValue: data.value,
    progressMax: data.max
  });
});

api.on('executed', (data) => {
  events.push({
    nodeId: String(data.node),
    eventType: 'completed',
    timestamp: Date.now()
  });
});
```

## Analyzing Results

### JSON Export

Both profilers save detailed JSON reports:

```bash
bun scripts/profile-workflow-advanced.ts
# Creates: profile-advanced-1729987654321.json
```

Use jq for analysis:

```bash
# Find slowest node
jq '.analysis.slowestNodes[0]' profile-advanced-*.json

# Get parallelizability score
jq '.execution.parallelExecutionEstimate.parallelizabilityScore' profile-advanced-*.json

# Export all node timings
jq '.nodes | map({id, type, time: .executionTime})' profile-advanced-*.json
```

### Tracking Over Time

Compare profiling runs:

```bash
# Run multiple times
for i in {1..5}; do
  bun scripts/profile-workflow-advanced.ts
  sleep 5
done

# Analyze trends
jq -s 'map(.execution.totalTime) | {
  min: min,
  max: max,
  avg: (add/length),
  samples: length
}' profile-advanced-*.json
```

## Performance Optimization Tips

Based on profiling output, consider:

1. **High Critical Path?**
   - Look for sequential bottlenecks
   - Consider restructuring workflow with parallel branches

2. **Slow Load Nodes?**
   - Use model caching
   - Load models once, reuse across nodes

3. **High Memory Usage?**
   - Process in smaller batches
   - Use efficient models
   - Clear caches between runs

4. **GPU Bottleneck?**
   - Check VRAM usage - may need smaller batches
   - Monitor VRAM allocation patterns
   - Consider model quantization

5. **Sequential Workflow?**
   - Look for independent branches that can run in parallel
   - Consider splitting into multiple workflows

## API Reference

### ProfileResult (Basic Profiler)

```typescript
interface ProfileResult {
  promptId: string;
  workflowName: string;
  totalTime: number; // ms
  totalNodes: number;
  completedNodes: number;
  failedNodes: number;
  nodeProfiles: NodeProfileData[];
  nodeTimings: Map<string, number>;
  executionHistory?: any;
  summary: {
    slowestNodes: Array<{ nodeId: string; nodeType: string; time: number }>;
    averageNodeTime: number;
    medianNodeTime: number;
    parallelizableEstimate: string;
  };
}
```

### AdvancedProfileResult (Advanced Profiler)

```typescript
interface AdvancedProfileResult {
  metadata: {
    promptId: string;
    workflowName: string;
    serverUrl: string;
    startTime: string;
    endTime: string;
    totalDurationMs: number;
  };
  execution: {
    queuedTime: number;
    executionTime: number;
    totalTime: number;
    nodeCount: number;
    parallelExecutionEstimate: {
      criticalPath: number;
      estimatedSpeedup: number;
      parallelizabilityScore: number; // 0-100
    };
  };
  nodes: Array<{
    id: string;
    type: string;
    title?: string;
    queuedAt?: number;
    startedAt?: number;
    completedAt?: number;
    totalTime?: number;
    executionTime?: number;
    status: 'success' | 'failed' | 'unknown';
    errorMessage?: string;
  }>;
  resources: {
    memorySnapshots: MemorySnapshot[];
    maxMemoryUsage?: { ramFree: number; timestamp: number };
    peakGpuUsage?: Array<{
      device: string;
      vramUsed: number;
      vramTotal: number;
      timestamp: number;
    }>;
  };
  analysis: {
    slowestNodes: Array<{ id: string; type: string; time: number }>;
    fastestNodes: Array<{ id: string; type: string; time: number }>;
    bottlenecks: Array<{ nodeId: string; reason: string; impact: string }>;
    recommendations: string[];
  };
}
```

## Troubleshooting

### "Connection refused"
- Ensure ComfyUI is running on the specified URL
- Check network connectivity
- Verify firewall rules

### "Workflow file not found"
- Use absolute paths for workflow files
- Check file exists: `ls -la path/to/workflow.json`

### Missing timing data
- Some nodes may not emit progress events
- History data may not be available for old executions
- Check if ComfyUI has sufficient logging enabled

### Memory profiling not working
- Requires real ComfyUI server (not mocked)
- May need monitoring extension enabled
- Check server permissions

## See Also

- [Workflow Guide](../docs/workflow-guide.md) - How to build workflows
- [API Features](../docs/api-features.md) - Extended API features
- [Troubleshooting](../docs/troubleshooting.md) - Common issues
