# Workflow Execution Profiling - Test Case Summary

## Overview

A comprehensive profiling test suite has been created to measure and analyze ComfyUI node execution times using the library. The solution consists of three complementary components:

### 1. **Basic Profiler** (`scripts/profile-workflow-execution.ts`)
Simple, focused profiling tool that captures:
- Node execution timing
- Node type distribution
- Top slowest nodes
- Basic statistics (average, median)
- Parallelization estimates
- JSON export for further analysis

**Usage:**
```bash
bun scripts/profile-workflow-execution.ts
WORKFLOW=./path/to/workflow.json bun scripts/profile-workflow-execution.ts
```

### 2. **Advanced Profiler** (`scripts/profile-workflow-advanced.ts`)
Rich profiling with deep system insights:
- **Execution Timeline**: Queue wait vs execution time breakdown
- **Memory Profiling**: RAM usage snapshots during execution
- **GPU Monitoring**: Per-device VRAM tracking
- **Bottleneck Detection**: Identifies performance issues with impact assessment
- **Critical Path Analysis**: Theoretical min execution time with unlimited parallelization
- **Parallelizability Score**: 0-100% measure of how parallelizable the workflow is
- **Performance Recommendations**: Actionable suggestions for optimization

**Usage:**
```bash
bun scripts/profile-workflow-advanced.ts
VERBOSE=true PROFILE_MEMORY=true bun scripts/profile-workflow-advanced.ts
COMFY_URL=http://192.168.1.100:8188 bun scripts/profile-workflow-advanced.ts
```

### 3. **Test Suite** (`test/profiling.spec.ts`)
Comprehensive unit and integration tests covering:
- Progress event capture and timing
- Execution history analysis
- System resource monitoring (RAM, GPU)
- Performance metrics collection
- Node dependency analysis
- Critical path calculation
- Bottleneck detection
- Parallelizability scoring
- Data export and serialization

**Usage:**
```bash
bun test test/profiling.spec.ts
COMFY_REAL=1 bun test test/profiling.spec.ts
COMFY_REAL=1 VERBOSE=true bun test test/profiling.spec.ts
```

## Key Information Captured

### Per-Node Metrics
- Node ID and Type
- Execution time (milliseconds)
- Start/end timestamps
- Execution status (success/failed)
- Error messages if applicable

### Workflow-Level Metrics
- Total execution time
- Queue wait time
- Number of nodes (total, completed, failed)
- Node type distribution
- Aggregate timing by type

### System Metrics
- RAM usage (total, free, peak)
- GPU VRAM usage per device
- Device names and capabilities
- Memory snapshots during execution

### Performance Analysis
- **Critical Path**: Longest dependency chain
- **Estimated Speedup**: Best possible speedup with unlimited parallelization
- **Parallelizability Score**: 0-100% measure of parallelization potential
- **Bottlenecks**: Nodes and operations blocking performance
- **Slowest/Fastest Nodes**: Top performers and bottlenecks

## Example Output

### Basic Profiler Report
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
  3. 2: CLIPTextEncode
     └─ 80.50ms
  ...

📊 Node Type Distribution:
  • CheckpointLoader
    Count: 1, Total: 2150.00ms, Avg: 2150.00ms
  • CLIPTextEncode
    Count: 2, Total: 150.00ms, Avg: 75.00ms
  • KSampler
    Count: 1, Total: 12500.00ms, Avg: 12500.00ms
```

### Advanced Profiler Report
```
📈 ADVANCED PROFILING REPORT
═══════════════════════════════════════════════════════════════
📋 Execution Metadata:
  Prompt ID:           f1a2b3c4-d5e6-f7g8-h9i0-j1k2l3m4n5o6
  Workflow:            txt2img-workflow.json
  Server:              http://localhost:8188
  Duration:            15234ms

⏱️  Execution Timeline:
  Queue Wait:          234ms
  Execution:           15000ms
  Total:               15234ms

⚡ Performance Metrics:
  Total Nodes:         8
  Critical Path:       14750ms
  Est. Speedup (∞):    1.03x
  Parallelizability:   97.3%

🐌 Top Slowest Nodes:
  1. [4] KSampler: 12500.00ms
  2. [1] CheckpointLoader: 2150.00ms
  3. [2] CLIPTextEncode: 80.50ms

🚨 Identified Bottlenecks:
  • [4]
    Reason: Execution time (12500ms) is 6.6x average
    Impact: Critical - reduces parallelization potential

💾 Memory Usage:
  Min Free RAM:        2.4 GB
  Snapshots Taken:     15

🎮 GPU Usage:
  NVIDIA RTX 3090: 18.2 GB / 24.0 GB (75.8%)

💡 Recommendations:
  • Address 1 identified bottleneck(s) to improve overall performance
  • ⚡ 1 GPU-accelerated node(s) detected; monitor VRAM usage
  • 💡 Monitor real-time VRAM usage with: api.ext.monitor.enableMonitoring()
```

## Features & Capabilities

### Event-Based Timing
- Captures WebSocket progress events in real-time
- Tracks node transitions (queued → running → completed)
- Measures queue wait vs execution time separately

### Memory & Resource Tracking
- Automatic memory snapshots during execution (1 sample/sec)
- GPU VRAM tracking per device
- Peak memory usage identification

### Dependency Analysis
- Builds node dependency graph from workflow structure
- Calculates critical path (longest chain of dependencies)
- Estimates theoretical speedup with unlimited parallelization

### Bottleneck Detection
- Identifies nodes taking 2x+ average time
- Detects failed nodes blocking execution
- Reports impact and severity

### Historical Analysis
- Exports detailed JSON reports
- Supports trending analysis across multiple runs
- Enables performance regression detection

### System Integration
- Works with existing `api.ext.history` for detailed history data
- Uses `api.ext.system` for resource monitoring
- Uses `api.ext.monitor` for real-time monitoring (if available)
- Hooks into WebSocket events (progress, executed, execution_error)

## Usage Examples

### Profile a workflow with default settings
```bash
bun scripts/profile-workflow-execution.ts
```

### Profile with verbose output and memory tracking
```bash
VERBOSE=true PROFILE_MEMORY=true bun scripts/profile-workflow-advanced.ts
```

### Profile a specific workflow
```bash
WORKFLOW=./demos/recursive-edit/server.ts bun scripts/profile-workflow-advanced.ts
```

### Profile a remote ComfyUI instance
```bash
COMFY_URL=http://192.168.1.100:8188 bun scripts/profile-workflow-advanced.ts
```

### Run profiling tests with real server
```bash
COMFY_REAL=1 COMFY_URL=http://localhost:8188 bun test test/profiling.spec.ts
```

### Analyze saved report
```bash
jq '.analysis.slowestNodes' profile-advanced-1729987654321.json
jq '.execution.parallelExecutionEstimate' profile-advanced-1729987654321.json
```

## Test Suite Details

All 13 tests pass successfully:

1. ✓ Progress event capture
2. ✓ Execution history retrieval
3. ✓ Status data extraction
4. ✓ System statistics
5. ✓ Device statistics (GPU)
6. ✓ Timing data collection
7. ✓ Queue vs execution time measurement
8. ✓ Node dependency analysis
9. ✓ Critical path calculation
10. ✓ Bottleneck detection
11. ✓ Parallelizability scoring
12. ✓ Profiling data export
13. ✓ JSON serialization

## Metrics Explained

### Critical Path
The longest chain of dependent nodes in the workflow. This is the theoretical minimum execution time if all other nodes could run in parallel.

### Parallelizability Score
Measure of how much speedup is theoretically possible:
- **0-30%**: Highly sequential (little parallelization benefit)
- **30-70%**: Moderate parallelization potential
- **70-100%**: Highly parallelizable (significant speedup possible)

### Estimated Speedup
How much faster the workflow could theoretically run with unlimited parallelization:
```
Speedup = Total Sequential Time / Critical Path
```

### Node Type Distribution
Breakdown of different node types and their aggregate timing, useful for identifying resource-intensive operations.

## Documentation

Complete guide available in: `docs/profiling-guide.md`

Includes:
- Detailed API reference
- Performance optimization tips
- Troubleshooting guide
- Advanced profiling features
- JSON export analysis

## Technical Architecture

### Real-time Event Tracking
- Subscribes to WebSocket events: `progress`, `executed`, `execution_error`
- Records timestamps for accurate timing
- Builds execution timeline as events occur

### History Integration
- Fetches detailed execution history after completion
- Extracts output data and status information
- Correlates with real-time events

### Resource Monitoring
- Periodic system stats queries (memory snapshots)
- GPU VRAM tracking via device stats
- Calculates peak usage during execution

### Analysis Engine
- Calculates critical path from dependency graph
- Identifies bottlenecks (2x+ average time)
- Scores parallelizability potential
- Generates optimization recommendations

## Files Created

1. **`scripts/profile-workflow-execution.ts`** - Basic profiler (480 lines)
2. **`scripts/profile-workflow-advanced.ts`** - Advanced profiler (750 lines)
3. **`test/profiling.spec.ts`** - Test suite (380 lines)
4. **`docs/profiling-guide.md`** - Complete documentation (350 lines)

## Next Steps

To use the profilers:

1. Ensure ComfyUI is running on your machine or network
2. Have a workflow JSON file ready
3. Run one of the profiling scripts
4. Review the report and JSON export
5. Use recommendations to optimize workflows

Example:
```bash
# Start with basic profiling
bun scripts/profile-workflow-execution.ts

# Then use advanced profiling for deeper insights
bun scripts/profile-workflow-advanced.ts

# Export and analyze results
cat profile-advanced-*.json | jq '.analysis'
```

## API Surface

All profilers expose clean, typed interfaces:

```typescript
// Basic profiler result
interface ProfileResult {
  promptId: string;
  totalTime: number;
  nodeProfiles: NodeProfileData[];
  summary: {
    slowestNodes: Array<{ nodeId: string; time: number }>;
    averageNodeTime: number;
    parallelizableEstimate: string;
  };
}

// Advanced profiler result
interface AdvancedProfileResult {
  metadata: { /* execution info */ };
  execution: { /* timing breakdown */ };
  nodes: Array<{ /* per-node details */ }>;
  resources: { /* memory, GPU usage */ };
  analysis: { /* bottlenecks, recommendations */ };
}
```

## Summary

A complete, production-ready profiling suite has been implemented that:

✅ Captures detailed per-node execution timing
✅ Tracks memory and GPU usage
✅ Analyzes workflow parallelization potential
✅ Identifies performance bottlenecks
✅ Provides optimization recommendations
✅ Exports detailed JSON reports
✅ Includes comprehensive test coverage
✅ Offers both basic and advanced profiling modes
✅ Works with real ComfyUI servers
✅ Fully documented with usage examples

The solution is ready to use and can help identify performance issues and optimization opportunities in ComfyUI workflows!
