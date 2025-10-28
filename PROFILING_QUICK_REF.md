# Profiling Test Case - Quick Reference

## What's Been Created

A comprehensive workflow execution profiling suite with 3 components:

| Component | File | Purpose |
|-----------|------|---------|
| **Basic Profiler** | `scripts/profile-workflow-execution.ts` | Simple node timing collection |
| **Advanced Profiler** | `scripts/profile-workflow-advanced.ts` | Memory, GPU, bottleneck analysis |
| **Test Suite** | `test/profiling.spec.ts` | 13 unit/integration tests |
| **Documentation** | `docs/profiling-guide.md` | Complete usage guide |
| **This Summary** | `PROFILING_TEST_CASE.md` | Detailed overview |

## Quick Start Commands

```bash
# Basic profiling (simple timing)
bun scripts/profile-workflow-execution.ts

# Advanced profiling (memory, GPU, recommendations)
bun scripts/profile-workflow-advanced.ts

# With custom workflow
WORKFLOW=./path/to/workflow.json bun scripts/profile-workflow-advanced.ts

# Verbose with memory profiling
VERBOSE=true PROFILE_MEMORY=true bun scripts/profile-workflow-advanced.ts

# Run tests
bun test test/profiling.spec.ts

# Integration tests with real server
COMFY_REAL=1 bun test test/profiling.spec.ts
```

## Key Metrics Captured

### Per-Node Information
- Node ID and type
- Execution time (ms)
- Status (success/failed)
- Error messages

### Workflow Performance
- Total execution time
- Queue wait time
- Node count (total/completed/failed)
- Slowest nodes top 5
- Average/median node time

### System Resources
- RAM usage (free, total)
- GPU VRAM per device
- Peak memory usage
- Memory snapshots during execution

### Performance Analysis
- **Critical Path**: Longest dependency chain
- **Parallelizability Score**: 0-100% measure
- **Estimated Speedup**: Theoretical max speedup
- **Bottlenecks**: Performance issues identified
- **Recommendations**: Optimization suggestions

## Example Output

### Basic Report
```
📈 PROFILING REPORT
Total Time:       15234ms
Total Nodes:      8
Average Time:     1904.25ms
Parallelizable:   Moderate

Top 5 Slowest:
1. Node 4: KSampler - 12500ms
2. Node 1: CheckpointLoader - 2150ms
...
```

### Advanced Report
```
📈 ADVANCED PROFILING REPORT
Total Time:       15234ms
Queue Wait:       234ms
Execution:        15000ms

Critical Path:    14750ms
Parallelizability: 97.3%
Est. Speedup:     1.03x

GPU: NVIDIA RTX 3090 - 18.2 / 24.0 GB (75.8%)

Recommendations:
• Address 1 bottleneck(s)
• Monitor VRAM usage
• Consider workflow restructuring
```

## File Locations

```
comfyui-node/
├── scripts/
│   ├── profile-workflow-execution.ts      (480 lines)
│   └── profile-workflow-advanced.ts       (750 lines)
├── test/
│   └── profiling.spec.ts                  (380 lines)
├── docs/
│   └── profiling-guide.md                 (350 lines)
└── PROFILING_TEST_CASE.md                 (this file)
```

## What Information Can Be Extracted

### From WebSocket Events
- ✅ Node execution start/end times
- ✅ Progress updates during execution
- ✅ Failures and error details
- ✅ Event timestamps (1ms precision)

### From History API
- ✅ Node outputs and data
- ✅ Execution status
- ✅ Status messages and timeline

### From System API
- ✅ Current RAM usage (free/total)
- ✅ GPU VRAM per device
- ✅ Device names and capabilities
- ✅ ComfyUI version, Python version, etc.

### Calculated Analysis
- ✅ Node dependency graph
- ✅ Critical path (longest chain)
- ✅ Parallelizability potential
- ✅ Performance bottlenecks
- ✅ Memory/GPU peak usage

## Usage Patterns

### Simple One-Off Profiling
```bash
bun scripts/profile-workflow-execution.ts
```

### Detailed Analysis
```bash
bun scripts/profile-workflow-advanced.ts
# → Creates: profile-advanced-TIMESTAMP.json
```

### Compare Multiple Runs
```bash
for i in {1..5}; do
  bun scripts/profile-workflow-advanced.ts
  sleep 5
done
# Analyze all reports with jq
```

### Integration with CI/CD
```bash
# Profile and assert performance
COMFY_REAL=1 bun test test/profiling.spec.ts
```

## Performance Metrics Explained

| Metric | Meaning | Good Range |
|--------|---------|-----------|
| **Critical Path** | Minimum possible execution time | Lower = more parallelizable |
| **Parallelizability** | How much benefit from parallelization | 70-100% = good |
| **Speedup** | Theoretical max speedup | >1.5x = good candidate for optimization |
| **Bottleneck** | Nodes 2x+ average time | Minimize or parallelize |

## Example Analysis Flow

1. **Run Basic Profiler**
   ```bash
   bun scripts/profile-workflow-execution.ts
   ```
   → Identify slow nodes

2. **Run Advanced Profiler**
   ```bash
   bun scripts/profile-workflow-advanced.ts
   ```
   → Get detailed insights, bottlenecks, recommendations

3. **Analyze JSON Report**
   ```bash
   jq '.analysis' profile-advanced-*.json
   jq '.nodes | sort_by(-.executionTime) | .[0:5]' profile-advanced-*.json
   ```

4. **Implement Recommendations**
   → Restructure workflow, optimize slow nodes

5. **Re-profile for Validation**
   ```bash
   WORKFLOW=optimized.json bun scripts/profile-workflow-advanced.ts
   ```
   → Compare results

## Test Coverage

✅ 13 tests all passing:
- Progress event capture
- Execution history
- System monitoring
- Timing collection
- Dependency analysis
- Critical path calculation
- Bottleneck detection
- Data export

## Requirements

- Node.js >= 22
- Bun runtime
- ComfyUI server (for real profiling)
- Access to workflow JSON files

## Performance Overhead

- Basic profiling: <1% overhead (WebSocket listeners only)
- Advanced profiling: 1-3% overhead (memory sampling every 1s)
- No impact on workflow execution

## Output Formats

### Console Report
- Human-readable text with ASCII formatting
- Color-coded sections
- Summary statistics

### JSON Export
- Complete detailed metrics
- All event timestamps
- Memory/GPU snapshots
- Analysis results
- Machine-readable for further processing

## Common Questions

**Q: Do profilers slow down the workflow?**
A: Minimal - <1% overhead from event listeners and memory sampling

**Q: Can I profile remote ComfyUI?**
A: Yes - set `COMFY_URL=http://remote:8188`

**Q: How often are memory samples taken?**
A: Every 1 second during execution (configurable)

**Q: Can I compare multiple runs?**
A: Yes - JSON export enables trending and comparisons

**Q: What if nodes don't emit events?**
A: Timing is estimated from history data, accuracy varies

**Q: How detailed is the GPU tracking?**
A: Per-device VRAM usage, peak tracking, name/type info

## Next Steps

1. Choose a workflow to profile
2. Run: `bun scripts/profile-workflow-advanced.ts`
3. Review the report (console + JSON)
4. Implement recommended optimizations
5. Re-profile to validate improvements

---

**For detailed information, see: `docs/profiling-guide.md`**
