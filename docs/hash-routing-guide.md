# WorkflowPool Hash-Based Routing Guide

## Overview

The WorkflowPool implements sophisticated hash-based routing to provide **workflow-level failure tracking and intelligent client failover**. Instead of blocking entire clients, the pool uses deterministic workflow hashing to track failures at the workflow granularity, enabling fine-grained failover and recovery strategies.

## Key Concepts

### Workflow Hashing

Each workflow is assigned a deterministic SHA-256 hash based on its content. This enables:

- **Consistent Identification**: The same workflow always produces the same hash
- **Workflow Grouping**: Related workflows can be tracked as a group  
- **Failure Correlation**: Easy to find all failures for a specific workflow across logs

### SmartFailoverStrategy

The `SmartFailoverStrategy` tracks failures per (client, workflow-hash) pair using a nested map structure:

```
For each client:
  For each workflow hash:
    Track: failureCount, blockedUntil timestamp
```

**Behavior**:

- **First Failure**: Records the failure, sets `blockedUntil = now + cooldownMs`
- **Within Cooldown**: `shouldSkipClient()` returns `true` → job routes to different client
- **After Cooldown**: Entry is automatically cleared, client becomes available again
- **Success**: Entry is immediately deleted for that workflow

### Workflow-Level Blocking (The Key Difference)

Instead of blocking an entire client, hash-based routing blocks specific workflows on specific clients:

**Traditional Approach**:
- client-1 fails on ANY workflow → client-1 is marked unusable ❌

**Hash-Based Routing**:
- client-1 fails on txt2img-workflow-hash-ABC
- → ONLY txt2img-workflow-hash-ABC is blocked on client-1 ✅
- → Other workflows (upscale, etc.) work fine on client-1 ✅
- → txt2img-workflow-hash-ABC works fine on client-2 ✅

## How It Works

### Job Processing Flow

1. **Enqueue**: User calls `pool.enqueue(workflow, options)`
2. **Hash**: Workflow is hashed deterministically
3. **Queue**: Job stored with jobId, workflowHash, status
4. **Process**: Pool picks an available client
5. **Filter**: SmartFailoverStrategy filters out blocked clients for this hash
6. **Run**: Selected client executes the job
7. **Result**: On success/failure, update tracking state

### Failure Recovery Timeline

Example: Workflow fails on client-1 with 60s cooldown

```
T+0s    Job fails on client-1 for workflow-hash-ABC
        → workflowFailures[client-1][ABC] = { blockedUntil: now+60s }
        → Emit: client:blocked_workflow event

T+5s    New job arrives with same workflow-hash-ABC
        → shouldSkipClient checks: blockedUntil > now? YES
        → Skip client-1, route to client-2 instead

T+60s   Cooldown expires (time passes)
        → Entry removed from workflowFailures map

T+61s   Client-1 is available for workflow-hash-ABC again
        → Emit: client:unblocked_workflow event
```

## Configuration

### SmartFailoverStrategy Options

```typescript
const strategy = new SmartFailoverStrategy({
  cooldownMs: 60_000,            // How long to block (default: 60s)
  maxFailuresBeforeBlock: 1      // Failures before blocking (default: 1)
});
```

### WorkflowPool Options

```typescript
const pool = new WorkflowPool(clients, {
  failoverStrategy: strategy,
  queueAdapter: new MemoryQueueAdapter(),
  healthCheckIntervalMs: 30_000  // Keep connections alive
});
```

## Usage Example

```typescript
import { ComfyApi, WorkflowPool, SmartFailoverStrategy } from "comfyui-node";

// Create clients
const clients = [
  new ComfyApi("http://node-1:8188"),
  new ComfyApi("http://node-2:8188"),
  new ComfyApi("http://node-3:8188")
];

// Create pool
const pool = new WorkflowPool(clients, {
  failoverStrategy: new SmartFailoverStrategy({
    cooldownMs: 60_000
  })
});

await pool.ready();

// Enqueue workflow
const jobId = await pool.enqueue(workflow, {
  metadata: { tenantId: "tenant-1" },
  priority: 5
});

// Monitor events
pool.on("client:blocked_workflow", (ev) => {
  console.log(`${ev.detail.clientId} blocked for ${ev.detail.workflowHash}`);
});

pool.on("client:unblocked_workflow", (ev) => {
  console.log(`${ev.detail.clientId} recovered for ${ev.detail.workflowHash}`);
});

pool.on("job:completed", (ev) => {
  console.log(`Job ${ev.detail.job.jobId} completed`);
});
```

## Event Reference

### Client Blocking Events

```typescript
// Workflow hash blocked on a client (failure occurred)
pool.on("client:blocked_workflow", (ev) => {
  const { clientId, workflowHash } = ev.detail;
  // clientId: which client
  // workflowHash: which workflow caused the block
});

// Workflow hash unblocked (cooldown expired, retry possible)
pool.on("client:unblocked_workflow", (ev) => {
  const { clientId, workflowHash } = ev.detail;
  // Automatically fires after cooldownMs expires
});
```

### Job Events

```typescript
// Job added to queue
pool.on("job:queued", (ev) => {
  const { job } = ev.detail;
});

// Job started execution
pool.on("job:started", (ev) => {
  const { job } = ev.detail;
});

// Job progress update
pool.on("job:progress", (ev) => {
  const { jobId, progress } = ev.detail;
});

// Job completed
pool.on("job:completed", (ev) => {
  const { job } = ev.detail;
});

// Job failed
pool.on("job:failed", (ev) => {
  const { job, willRetry } = ev.detail;
});
```

## Real-World Scenarios

### Scenario 1: Multi-Tenant System

Different tenants submit workflows. One tenant's problematic workflow doesn't block others:

- Tenant A's workflow fails on client-1 → only Tenant A's workflow blocked
- Tenant B can continue using client-1 with different workflows
- Tenant A's workflow succeeds on client-2

### Scenario 2: Monitoring & Alerting

Track workflow health across your cluster:

```typescript
const workflowHealthMap = new Map();

pool.on("client:blocked_workflow", (ev) => {
  const key = ev.detail.workflowHash;
  const health = workflowHealthMap.get(key) || { failures: 0 };
  health.failures++;
  
  // Alert if workflow fails on multiple clients
  if (health.failures > 2) {
    console.warn(`Workflow ${key} is problematic (${health.failures} failures)`);
  }
});

pool.on("client:unblocked_workflow", (ev) => {
  console.log(`Workflow ${ev.detail.workflowHash} recovered`);
});
```

### Scenario 3: Performance Optimization

Combine hash-based routing with client affinity:

```typescript
// Route complex workflows to powerful clients
const jobId = await pool.enqueue(complexWorkflow, {
  preferredClientIds: ["gpu-client-1", "gpu-client-2"],
  // If both fail for this workflow hash, routes to others automatically
});
```

## Performance Considerations

### Memory Usage

Hash-based routing adds minimal overhead:

- **Per Client**: ~8 bytes per tracked workflow hash
- **Per Workflow Failure**: ~40 bytes (hash + timestamp + count)
- **Example**: 3 clients × 100 workflows = ~12 KB total

### CPU Impact

- **Hash Calculation**: ~0.1-1ms per workflow (SHA-256 on JSON)
- **Lookup**: O(1) hash map operations
- **Overall**: <1ms per job

### Configuration Recommendations

**Cooldown Tuning**:
- Fast recovery: 30s (development/unstable servers)
- Normal: 60s (default, balanced)
- Conservative: 120s (production stability)

**Max Failures Before Block**:
- Tolerant: 3+ (allow retries before blocking)
- Normal: 1 (default, immediate failover)

**Health Check**:
- Set to 30-60s for stable systems
- Increase to 120s if bandwidth-constrained
- Set to 0 to disable if using external monitoring

## Troubleshooting

### Problem: Workflow keeps failing even after cooldown

**Solutions**:
1. Increase cooldown duration (server needs more recovery time)
2. Allow more failures before blocking (set maxFailuresBeforeBlock to 2-3)
3. Check ComfyUI server logs for underlying issue

```typescript
const strategy = new SmartFailoverStrategy({
  cooldownMs: 120_000,
  maxFailuresBeforeBlock: 2
});
```

### Problem: One client is blocked for too long

This is by design! The cooldown prevents busy retry loops. After cooldown expires, the client becomes available again automatically (client:unblocked_workflow event).

### Problem: Jobs not routing to preferred clients

Possible causes:
1. Preferred clients are blocked for that workflow hash
2. Preferred clients are offline or busy
3. Pool automatically routes to any available client

Ensure you have enough fallback clients:

```typescript
const jobId = await pool.enqueue(workflow, {
  preferredClientIds: ["gpu-1", "gpu-2", "gpu-3"],
  // Falls back to any available if all preferred are blocked
});
```

## Demos

Two comprehensive demos showcase the feature:

### Basic Demo: `scripts/pool-hash-routing-demo.ts`

Educational demo showing core concepts:

```bash
bun scripts/pool-hash-routing-demo.ts [--verbose]
```

Shows:
- Deterministic workflow hashing
- Client failure and blocking
- Smart failover mechanics
- Cooldown and recovery

### Advanced Demo: `scripts/pool-hash-routing-advanced.ts`

Integration demo with optional real ComfyUI servers:

```bash
# With real servers
COMFY_HOSTS=http://host1:8188,http://host2:8188 bun scripts/pool-hash-routing-advanced.ts

# Simulation mode
bun scripts/pool-hash-routing-advanced.ts
```

Shows:
- Multi-tenant job routing
- Workflow affinity optimization
- Event monitoring and alerting
- Custom failover strategies
- Real-world patterns

## Summary

Hash-based routing provides:

1. **Fine-Grained Failure Tracking**: Per (client, workflow) pair
2. **Intelligent Failover**: Only blocks problematic combinations
3. **Automatic Recovery**: Cooldown-based unblocking
4. **Multi-Tenant Safety**: Isolates failures per workflow
5. **Observable**: Events for monitoring and alerting

## References

- [SmartFailoverStrategy Implementation](../src/pool/failover/SmartFailoverStrategy.ts)
- [WorkflowPool Implementation](../src/pool/WorkflowPool.ts)
- [Workflow Hashing](../src/pool/utils/hash.ts)
- [Event Types](../src/pool/types/events.ts)
