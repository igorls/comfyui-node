# WorkflowPool Queue Optimization

## Overview

The WorkflowPool queue processing has been optimized to maximize throughput in heterogeneous clusters where clients have different capabilities or workflow affinities.

## What Changed

### Previous Algorithm (First-Fit)
The previous queue processing used a simple greedy first-fit approach:
- For each idle client, iterate through waiting jobs in order
- Assign the first job that the client can run
- Move to the next client

**Problem**: This could leave clients idle when there are jobs they could run further down the queue.

**Example**:
- Client A can only run workflow type X
- Client B can run both X and Y
- Queue: [Job Y, Job X]
- **Result**: Client B takes Job Y, then Client A sits idle until Job X is processed

### New Algorithm (Selectivity-Based)
The new queue processing uses a selectivity-based matching algorithm:
1. Build compatibility matrix for all idle clients and waiting jobs
2. Calculate job selectivity (number of compatible clients)
3. Sort jobs by:
   - **Primary**: Priority (higher priority first)
   - **Secondary**: Selectivity (fewer compatible clients first)
   - **Tertiary**: Queue order (FIFO as tiebreaker)
4. Assign jobs to available compatible clients

**Benefits**:
- Prevents clients from taking versatile jobs when specialized jobs need them
- Maximizes cluster utilization in heterogeneous environments
- Respects explicit job priorities for live queue management

**Same Example**:
- Client A can only run workflow type X
- Client B can run both X and Y
- Queue: [Job Y, Job X]
- **Analysis**: Job X has selectivity=1 (only Client A), Job Y has selectivity=2 (both clients)
- **Result**: Job X assigned to Client A first (more selective), then Job Y to Client B (both busy!)

## Priority Support

Jobs can now be enqueued with numeric priorities to control execution order:

```typescript
// High priority job (executes first)
await pool.enqueue(urgentWorkflow, { 
  priority: 10,
  metadata: { urgent: true }
});

// Normal priority job
await pool.enqueue(normalWorkflow, { 
  priority: 0  // default
});

// Low priority job (executes last)
await pool.enqueue(backgroundWorkflow, { 
  priority: -5
});
```

Priority takes precedence over selectivity, so high-priority jobs execute first regardless of how many clients can run them.

## Testing with Real Servers

### Two-Stage Edit Simulation

The `two-stage-edit-simulation.ts` script demonstrates the optimization with real ComfyUI servers:

```bash
# Set up environment
export TWO_STAGE_HOSTS="http://server1:8188,http://server2:8188,http://server3:8188"
export TWO_STAGE_RUNTIME_MS=600000  # 10 minutes
export TWO_STAGE_CONCURRENCY=3      # 3 parallel workers
export TWO_STAGE_MIN_DELAY_MS=1000  # 1 second between jobs
export TWO_STAGE_MAX_DELAY_MS=5000  # 5 seconds max

# Run simulation
bun scripts/two-stage-edit-simulation.ts
```

**What it does**:
1. **Generation stage**: Text-to-image on specific servers (preferredClientIds)
2. **Edit stage**: Image editing on different servers (preferredClientIds per job)
3. Tests queue optimization with heterogeneous client capabilities

**Key Features**:
- Uses workflow affinities to restrict certain workflows to specific clients
- Demonstrates priority-based job ordering
- Shows how selectivity prevents idle clients
- Provides statistics on client utilization

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TWO_STAGE_HOSTS` | Comma-separated list of ComfyUI server URLs | 3 predefined hosts |
| `TWO_STAGE_RUNTIME_MS` | Total simulation duration in milliseconds | 6 hours |
| `TWO_STAGE_MIN_DELAY_MS` | Minimum delay between job submissions | 0ms |
| `TWO_STAGE_MAX_DELAY_MS` | Maximum delay between job submissions | 0ms |
| `TWO_STAGE_CONCURRENCY` | Number of concurrent workers | 2 |
| `TWO_STAGE_SEED_STRATEGY` | Seed strategy: random, auto, or fixed | random |

## Performance Impact

The selectivity-based algorithm has minimal performance overhead:
- **Time Complexity**: O(n*m) where n=jobs, m=clients (same as before)
- **Additional Operations**: One sort operation per queue processing cycle
- **Memory**: O(n) for job match info (temporary, released after matching)

The benefits far outweigh the minimal cost when running heterogeneous clusters.

## Configuration

The optimization is always active in WorkflowPool. No configuration needed!

To use workflow affinities (which benefit most from this optimization):

```typescript
import { WorkflowPool, hashWorkflow } from 'comfyui-node';

const generationHash = hashWorkflow(generationWorkflow);
const editHash = hashWorkflow(editWorkflow);

const pool = new WorkflowPool(clients, {
  workflowAffinities: [
    { workflowHash: generationHash, preferredClientIds: ['server1'] },
    { workflowHash: editHash, preferredClientIds: ['server2', 'server3'] }
  ]
});
```

## Monitoring

The simulation scripts log detailed statistics:
- Jobs per client
- Success/failure rates
- Client utilization
- Disconnect events

Watch for patterns like:
- ✅ Even distribution across capable clients
- ✅ No idle clients when jobs are waiting
- ✅ Higher priority jobs execute before lower priority
- ⚠️ Any client consistently sitting idle (may indicate configuration issue)
