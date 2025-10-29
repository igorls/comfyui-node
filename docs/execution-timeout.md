# Execution Timeout Protection

## Overview

**Version**: 1.5.0
**Status**: ✅ Implemented and Tested

WorkflowPool now includes two layers of automatic timeout protection to prevent jobs from being lost when servers hang:

1. **Execution Start Timeout** - Prevents jobs from hanging when servers accept prompts but never start execution
2. **Node Execution Timeout** - Prevents jobs from hanging on individual slow/stuck nodes during execution

These timeouts work together to ensure jobs either complete successfully or fail quickly for retry on another server.

## Execution Start Timeout

Previously, if a ComfyUI server:
1. Successfully accepted a prompt (returned `prompt_id`)
2. Emitted the `pending` event
3. Then got stuck (GPU hang, process crash, deadlock)
4. Never emitted `execution_start`

The job would **hang forever** in the WorkflowPool, waiting indefinitely for execution to begin. The job was neither completing nor failing, effectively becoming lost.

## The Solution

WorkflowPool now implements a configurable timeout for the execution start phase:

```typescript
const pool = new WorkflowPool(clients, {
  executionStartTimeoutMs: 5000  // 5 seconds (default)
});
```

### How It Works

1. **Job Enqueued**: WorkflowPool sends prompt to server
2. **Server Accepts**: Server returns `prompt_id` and emits `pending`
3. **Timeout Race**: Pool waits for either:
   - ✅ `execution_start` event (normal case)
   - ❌ Timeout expires (stuck server case)
4. **On Timeout**: 
   - Job is marked as failed
   - Error recorded: `"Execution failed to start within 5000ms. Server may be stuck or unresponsive."`
   - SmartFailoverStrategy blocks this server for this workflow
   - Job automatically retries on another available server
5. **Success**: Job completes on healthy server

## Configuration

### Default Behavior

```typescript
// Default: 5 second timeout
const pool = new WorkflowPool(clients);
```

### Custom Timeout

```typescript
// 10 second timeout for slower servers
const pool = new WorkflowPool(clients, {
  executionStartTimeoutMs: 10000
});
```

### Disable Timeout (Not Recommended)

```typescript
// No timeout - jobs can hang forever
const pool = new WorkflowPool(clients, {
  executionStartTimeoutMs: 0
});
```

## Integration with SmartFailoverStrategy

The timeout works seamlessly with hash-based routing:

```typescript
const pool = new WorkflowPool([server1, server2, server3], {
  executionStartTimeoutMs: 5000,
  // SmartFailoverStrategy is default
});

// Scenario: server1 gets stuck
// 1. Job sent to server1
// 2. server1 accepts prompt but hangs
// 3. Timeout after 5s
// 4. server1 blocked for this workflow (default 60s cooldown)
// 5. Job retried on server2
// 6. server2 completes successfully
// 7. server1 automatically unblocked after 60s
```

## Events and Monitoring

The timeout emits standard WorkflowPool events:

```typescript
pool.on('job:failed', (event) => {
  const { job, willRetry } = event.detail;
  const error = job.lastError as Error;
  
  if (error.message.includes('failed to start within')) {
    console.log(`Server ${job.clientId} timed out - stuck before execution`);
    console.log(`Will retry: ${willRetry}`);
  }
});

pool.on('job:retrying', (event) => {
  const { job, delayMs } = event.detail;
  console.log(`Retrying job ${job.jobId} after ${delayMs}ms`);
});

pool.on('client:blocked_workflow', (event) => {
  const { clientId, workflowHash, unblockAt } = event.detail;
  console.log(`Client ${clientId} blocked for workflow ${workflowHash}`);
  console.log(`Unblocks at: ${new Date(unblockAt)}`);
});
```

## Use Cases

### Production Resilience

```typescript
// Multi-server setup with automatic failover
const pool = new WorkflowPool([
  new ComfyApi('http://gpu1:8188'),
  new ComfyApi('http://gpu2:8188'),
  new ComfyApi('http://gpu3:8188')
], {
  executionStartTimeoutMs: 5000,
  healthCheckIntervalMs: 30000
});

// Jobs automatically route around stuck servers
const jobId = await pool.enqueue(workflow);
```

### High Availability Services

```typescript
// Track timeout failures for monitoring
let timeoutCount = 0;

pool.on('job:failed', (event) => {
  const error = event.detail.job.lastError as Error;
  if (error.message.includes('failed to start within')) {
    timeoutCount++;
    
    // Alert if timeout rate is high
    if (timeoutCount > 10) {
      console.error('⚠️  High timeout rate detected - check server health');
      // Send alert to monitoring system
    }
  }
});
```

### GPU Hang Detection

```typescript
// Shorter timeout for detecting GPU hangs quickly
const pool = new WorkflowPool(clients, {
  executionStartTimeoutMs: 15000  // 15 seconds
});

pool.on('job:failed', async (event) => {
  const { job, willRetry } = event.detail;
  const error = job.lastError as Error;
  
  if (error.message.includes('failed to start within')) {
    console.warn(`Possible GPU hang on ${job.clientId}`);
    
    // Could trigger server restart, health check, etc.
    if (!willRetry) {
      // Job exhausted retries - manual intervention needed
      await notifyAdmins(`Job ${job.jobId} failed on all servers`);
    }
  }
});
```

## Choosing the Right Timeout

### Factors to Consider

1. **Server Load**: Heavily loaded servers take longer to start execution
2. **Model Size**: Large models (SDXL, Flux) take longer to load
3. **Queue Depth**: Deep queues delay execution start
4. **Network Latency**: Remote servers may have event delivery delays

### Recommended Values

| Scenario | Timeout | Rationale |
|----------|---------|-----------|
| **Development** | 60s | Generous timeout for debugging |
| **Production (Local)** | 5s | Default, balanced |
| **Production (Remote)** | 45s | Account for network latency |
| **High-Performance** | 15s | Fast failover for GPU farms |
| **Slow/Loaded Servers** | 90s | Allow time for model loading |

### Tuning Tips

Monitor your `job:failed` events:

```typescript
const startTimes: number[] = [];

pool.on('job:started', () => {
  startTimes.push(Date.now());
});

// After running many jobs, analyze p95/p99 start times
const p95 = percentile(startTimes, 95);
const p99 = percentile(startTimes, 99);

console.log(`Set timeout to p99 + safety margin: ${p99 + 5000}ms`);
```

## Implementation Details

### Timeout Mechanism

The timeout uses `Promise.race()` between the pending promise and a timeout promise:

```typescript
const pendingWithTimeout = Promise.race([
  pendingPromise,  // Resolves when execution_start received
  new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error('Execution failed to start within 30000ms...'));
    }, executionStartTimeoutMs);
  })
]);

await pendingWithTimeout;
```

### Cleanup

The timeout is properly cleaned up on success or failure:

```typescript
if (executionStartTimeout > 0) {
  const timeout = Promise.race([...]);
  await timeout;
  clearTimeout(timeoutId);  // Cleanup on success
}
// Cleanup also happens in catch block on failure
```

### Race Condition Safety

The implementation handles race conditions properly:
- Timeout cleared if `execution_start` arrives
- Timeout cleared if execution fails for other reasons
- No memory leaks from dangling timeouts

## Backward Compatibility

- **Default behavior unchanged**: 30s timeout is reasonable for most setups
- **Opt-out available**: Set `executionStartTimeoutMs: 0` to disable
- **No breaking changes**: Existing code works without modification
- **Type-safe**: Full TypeScript support

## Testing

Test the timeout behavior:

```bash
bun run scripts/test-execution-start-timeout.ts
```

The test simulates a stuck server and verifies:
1. Timeout triggers after configured duration
2. Job is marked as failed with correct error message
3. Job retries on another server
4. Job completes successfully on healthy server

## Troubleshooting

### Jobs timing out frequently

**Possible causes:**
- Servers overloaded (increase timeout or add more servers)
- Large models taking long to load (increase timeout)
- Network issues (check connectivity, increase timeout)
- GPU instability (check driver/hardware issues)

**Solutions:**
```typescript
// Option 1: Increase timeout
const pool = new WorkflowPool(clients, {
  executionStartTimeoutMs: 60000  // 60 seconds
});

// Option 2: Add more servers to distribute load
const pool = new WorkflowPool([...moreClients]);

// Option 3: Implement warmup to preload models
await client.ext.queue.appendPrompt(warmupWorkflow);
```

### Timeout too long for stuck servers

**Problem:** Stuck servers hold jobs too long before failover

**Solution:**
```typescript
// Reduce timeout for faster failover
const pool = new WorkflowPool(clients, {
  executionStartTimeoutMs: 15000  // 15 seconds
});
```

### False positives on slow servers

**Problem:** Legitimate slow starts being treated as timeouts

**Solution:**
```typescript
// Increase timeout for slower environments
const pool = new WorkflowPool(clients, {
  executionStartTimeoutMs: 90000  // 90 seconds
});
```

## Node Execution Timeout

### The Problem

Even after execution starts successfully, individual nodes can hang or take extremely long to complete:

**Common scenarios:**
- **Model loading on slow disks**: First-time model loads can take 60+ seconds on HDDs or network storage
- **Heavy diffusion steps**: Large batch sizes or high step counts on slower GPUs
- **VAE decode**: Large images (2048x2048+) can take minutes to decode
- **Custom nodes**: Third-party nodes with unpredictable execution times
- **GPU hang during execution**: Node starts but GPU freezes mid-computation

Without a timeout, one stuck node can cause the entire workflow to hang indefinitely.

### The Solution

WorkflowPool implements a per-node execution timeout:

```typescript
const pool = new WorkflowPool(clients, {
  nodeExecutionTimeoutMs: 300000  // 5 minutes (default)
});
```

### How It Works

1. **Node Starts**: When `executing` event received with node ID, timeout starts
2. **Progress Updates**: Each `progress` event resets the timeout (node is still working)
3. **Node Completes**: Next `executing` event signals completion, timeout resets for new node
4. **Timeout Triggered**: If node exceeds timeout without progress, job fails with detailed error
5. **Automatic Retry**: Job retries on another server via SmartFailoverStrategy

### Key Features

- **Per-node timeout**: Each node gets the full timeout duration
- **Progress-aware**: Timeout resets on progress events (e.g., KSampler 1/20, 2/20, ...)
- **Tracks current node**: Error message includes which node timed out
- **Cached nodes**: Instant completion, don't trigger timeout
- **Automatic cleanup**: Timeout cleared on success, failure, or cancellation

## Configuration

### Both Timeouts Together

```typescript
const pool = new WorkflowPool(clients, {
  executionStartTimeoutMs: 5000,    // 5s to start execution
  nodeExecutionTimeoutMs: 600000    // 10 min per node
});
```

### For Slow Disk/Model Loading

```typescript
// Generous timeout for first-generation model loading
const pool = new WorkflowPool(clients, {
  nodeExecutionTimeoutMs: 900000  // 15 minutes
});
```

### For Fast GPU Farm

```typescript
// Aggressive timeouts for quick failover
const pool = new WorkflowPool(clients, {
  executionStartTimeoutMs: 15000,   // 15s
  nodeExecutionTimeoutMs: 120000    // 2 min
});
```

### Disable Node Timeout (Not Recommended)

```typescript
const pool = new WorkflowPool(clients, {
  executionStartTimeoutMs: 5000,    // Keep start timeout
  nodeExecutionTimeoutMs: 0         // No node timeout
});
```

## Events and Monitoring

Node timeout failures emit standard events:

```typescript
pool.on('job:failed', (event) => {
  const { job, willRetry } = event.detail;
  const error = job.lastError as Error;
  
  if (error.message.includes('Node execution timeout')) {
    // Extract timeout details
    const match = error.message.match(/took longer than (\d+)ms.*node: ([^)]+)/);
    if (match) {
      const [, timeout, nodeId] = match;
      console.log(`Node ${nodeId} timed out after ${timeout}ms`);
      
      // Check profiling stats for more context
      if (job.profileStats) {
        const node = job.profileStats.nodes.find(n => n.nodeId === nodeId);
        console.log(`Node type: ${node?.type}`);
        console.log(`Progress events: ${node?.progressEvents?.length || 0}`);
      }
    }
  }
});
```

## Use Cases

### Handling Slow Model Loading

```typescript
// First generation on cold server with slow disk
const pool = new WorkflowPool(clients, {
  nodeExecutionTimeoutMs: 900000  // 15 minutes for model loading
});

pool.on('job:completed', (event) => {
  const stats = event.detail.job.profileStats;
  if (stats) {
    // Find slow loaders
    const loaders = stats.nodes.filter(n => 
      n.type?.includes('Loader') && n.duration && n.duration > 30000
    );
    
    for (const loader of loaders) {
      console.warn(`Slow loader: ${loader.type} took ${loader.duration}ms`);
    }
  }
});
```

### Production Monitoring

```typescript
const nodeTimeouts: Record<string, number> = {};

pool.on('job:failed', (event) => {
  const error = event.detail.job.lastError as Error;
  
  if (error.message.includes('Node execution timeout')) {
    const match = error.message.match(/node: ([^)]+)/);
    if (match) {
      const nodeId = match[1];
      nodeTimeouts[nodeId] = (nodeTimeouts[nodeId] || 0) + 1;
      
      // Alert if specific node times out frequently
      if (nodeTimeouts[nodeId] > 5) {
        console.error(`Node ${nodeId} has timed out ${nodeTimeouts[nodeId]} times`);
        // Send alert, increase timeout, or investigate
      }
    }
  }
});
```

### Dynamic Timeout Adjustment

```typescript
let currentTimeout = 300000; // Start with 5 minutes

pool.on('job:failed', (event) => {
  const error = event.detail.job.lastError as Error;
  
  if (error.message.includes('Node execution timeout')) {
    // Increase timeout on failures
    currentTimeout = Math.min(currentTimeout * 1.5, 1800000); // Max 30 min
    console.log(`Increased node timeout to ${currentTimeout}ms`);
    
    // Would need to recreate pool with new timeout
    // Or implement dynamic timeout in custom failover strategy
  }
});

pool.on('job:completed', (event) => {
  const stats = event.detail.job.profileStats;
  if (stats && stats.summary.slowestNodes.length > 0) {
    const slowest = stats.summary.slowestNodes[0].duration;
    
    // If slowest node was well under timeout, we can reduce it
    if (slowest < currentTimeout * 0.5) {
      currentTimeout = Math.max(currentTimeout * 0.9, 120000); // Min 2 min
      console.log(`Reduced node timeout to ${currentTimeout}ms`);
    }
  }
});
```

## Choosing the Right Timeouts

### Recommended Values by Environment

| Environment | Start Timeout | Node Timeout | Rationale |
|-------------|---------------|--------------|-----------|
| **Development (Local SSD)** | 5s | 5 min | Default, balanced |
| **Development (HDD)** | 10s | 15 min | Slow disk model loading |
| **Production (SSD, Warm)** | 5s | 3 min | Models pre-loaded |
| **Production (SSD, Cold)** | 10s | 10 min | First-gen model loading |
| **Production (Network Storage)** | 15s | 20 min | Slow remote disk access |
| **High-Performance GPU Farm** | 3s | 2 min | Fast hardware, quick failover |
| **Slow/Shared GPUs** | 30s | 15 min | Resource contention |

### Tuning Based on Profiling

Use profiling stats to determine appropriate timeouts:

```typescript
const pool = new WorkflowPool(clients, {
  enableProfiling: true,
  nodeExecutionTimeoutMs: 300000
});

const nodeDurations: number[] = [];

pool.on('job:completed', (event) => {
  const stats = event.detail.job.profileStats;
  if (stats) {
    // Collect all node durations
    for (const node of stats.nodes) {
      if (node.duration && node.duration > 0) {
        nodeDurations.push(node.duration);
      }
    }
    
    // After sufficient samples, analyze
    if (nodeDurations.length > 100) {
      nodeDurations.sort((a, b) => a - b);
      const p95 = nodeDurations[Math.floor(nodeDurations.length * 0.95)];
      const p99 = nodeDurations[Math.floor(nodeDurations.length * 0.99)];
      
      console.log(`Node duration p95: ${p95}ms`);
      console.log(`Node duration p99: ${p99}ms`);
      console.log(`Recommended timeout: ${p99 * 1.5}ms (p99 + 50% margin)`);
    }
  }
});
```

## Troubleshooting

### Nodes timing out on first generation

**Cause:** Model loading from disk takes longer than timeout

**Solution:**
```typescript
// Increase node timeout for cold starts
const pool = new WorkflowPool(clients, {
  nodeExecutionTimeoutMs: 900000  // 15 minutes
});

// OR: Implement model warmup
async function warmupServer(client: ComfyApi) {
  const warmupWorkflow = { /* minimal workflow with required models */ };
  await client.ext.queue.appendPrompt(warmupWorkflow);
}
```

### Progress events not resetting timeout

**Verify:** Check if your workflow nodes emit progress events

```typescript
pool.on('job:progress', (event) => {
  console.log('Progress event:', event.detail.progress);
});
```

If nodes don't emit progress, they get the full timeout without resets.

### Different nodes need different timeouts

**Current limitation:** Single timeout applies to all nodes

**Workaround:** Set timeout to accommodate slowest node type

```typescript
// Set timeout based on slowest node (e.g., model loaders)
const pool = new WorkflowPool(clients, {
  nodeExecutionTimeoutMs: 600000  // 10 min for loaders
});
```

**Future enhancement:** Per-node-type timeout configuration could be added.

## Related Documentation

- [WorkflowPool Guide](./workflow-pool.md)
- [Hash-Based Routing](./hash-routing-guide.md)
- [Troubleshooting](./troubleshooting.md)

---

**Created**: December 2024  
**Author**: ComfyUI Node SDK Team  
**License**: MIT
