# WorkflowPool Hash-Based Routing

## Overview

The WorkflowPool implements sophisticated hash-based routing to provide **workflow-level failure tracking and intelligent client failover**. Instead of blocking entire clients, the pool uses deterministic workflow hashing to track failures at the workflow granularity, enabling fine-grained failover and recovery strategies.

## Key Concepts

### 1. Workflow Hashing

Each workflow is assigned a deterministic SHA-256 hash based on its content (all node definitions and inputs). This enables:

- **Consistent Identification**: The same workflow always produces the same hash
- **Workflow Grouping**: Related workflows can be tracked as a group  
- **Failure Correlation**: Easy to find all failures for a specific workflow across logs

```typescript
import { hashWorkflow } from "comfyui-node/pool/utils/hash";

const workflow = {
  "1": { class_type: "CheckpointLoader", inputs: { ckpt_name: "model.safetensors" } },
  "2": { class_type: "CLIPTextEncode", inputs: { text: "a landscape" } },
  // ...
};

const hash = hashWorkflow(workflow);
// hash = "a1b2c3d4e5f6g7h8..." (deterministic, always the same)
```

### 2. SmartFailoverStrategy

The `SmartFailoverStrategy` tracks failures per (client, workflow-hash) pair:

```
┌─────────────────────────────────────────────────┐
│ SmartFailoverStrategy                           │
│                                                 │
│ workflowFailures: Map<                          │
│   clientId,                                     │
│   Map<                                          │
│     workflowHash,                               │
│     { failureCount, blockedUntil }              │
│   >                                             │
│ >                                               │
└─────────────────────────────────────────────────┘
```
{: data-line-numbers="false"}

**Behavior**:

- **First Failure**: Records the failure, sets `blockedUntil = now + cooldownMs`
- **Within Cooldown**: `shouldSkipClient()` returns `true` → job routes to different client
- **After Cooldown**: Entry is automatically cleared, client becomes available again
- **Success**: Entry is immediately deleted for that workflow

```typescript
const strategy = new SmartFailoverStrategy({
  cooldownMs: 60_000,           // Default: 60 seconds
  maxFailuresBeforeBlock: 1     // Default: 1 failure blocks immediately
});
```

### 3. Workflow-Level Blocking

**Key Difference from Client Blocking**:

```
Traditional Approach (Client Blocking):
  client-1 fails on ANY workflow → client-1 is unusable ❌

Hash-Based Routing (Workflow-Level Blocking):
  client-1 fails on txt2img_workflow-hash-ABC
  → ONLY txt2img_workflow-hash-ABC is blocked on client-1 ✅
  → Other workflows (upscale, etc.) work fine on client-1 ✅
  → txt2img_workflow-hash-ABC works fine on client-2 ✅
```

## How It Works

### Job Enqueue Flow

```
┌──────────────────────────────────┐
│ pool.enqueue(workflow, options)  │
└─────────────────┬────────────────┘
                  │
                  ▼
        ┌─────────────────────┐
        │ hashWorkflow()      │
        │ Generate workflow   │
        │ hash deterministically
        └──────────┬──────────┘
                   │
                   ▼
    ┌──────────────────────────────┐
    │ Create Job with:             │
    │ - jobId                      │
    │ - workflowHash               │
    │ - status: "queued"           │
    │ - attempts: 0                │
    └──────────┬───────────────────┘
               │
               ▼
    ┌──────────────────────────────┐
    │ Add to queue adapter         │
    │ Dispatch job:queued event    │
    └──────────┬───────────────────┘
               │
               ▼
          [Job scheduled for processing]
```

### Job Processing & Routing

```
┌─────────────────────────────────────────────┐
│ processQueue()                              │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
    ┌──────────────────────────────────────┐
    │ For each queued job:                 │
    │ Find available client                │
    │                                      │
    │ Candidates = online + not busy       │
    └──────────┬───────────────────────────┘
               │
               ▼
    ┌──────────────────────────────────────┐
    │ Filter by preferredClientIds (if any)│
    └──────────┬───────────────────────────┘
               │
               ▼
    ┌──────────────────────────────────────┐
    │ SmartFailoverStrategy.shouldSkipClient(
    │   client, job  // job.workflowHash
    │ )                                      │
    │                                      │
    │ Check: Is client blocked for this    │
    │        workflow hash?                │
    │        AND blockedUntil > now?       │
    │                                      │
    │ Return: true → skip, false → use    │
    └──────────┬───────────────────────────┘
               │
        ┌──────┴──────┐
        │             │
    YES │             │ NO
        ▼             ▼
    [Try Next]    [Use This Client]
                      │
                      ▼
            ┌──────────────────────┐
            │ runJob(client)       │
            │ Dispatch job:started │
            └──────────┬───────────┘
                       │
            ┌──────────┴──────────┐
            │                     │
        SUCCESS                 FAILURE
            │                     │
            ▼                     ▼
    ┌──────────────────┐  ┌─────────────────────┐
    │ recordSuccess()  │  │ recordFailure()     │
    │ Delete entry     │  │ • Increment counter │
    │ Dispatch:        │  │ • Set blockedUntil  │
    │ job:completed    │  │ • Dispatch blocked  │
    └──────────────────┘  │   workflow event    │
                          │ • Retry or fail job │
                          └─────────────────────┘
```

### Failure Recovery

```
Timeline of a blocked workflow:

T+0s:   Job fails on client-1
        → workflowFailures[client-1][hash] = { 
              blockedUntil: now + 60s,
              failureCount: 1 
          }
        → Emit: client:blocked_workflow

T+5s:   New job arrives with same workflow hash
        → shouldSkipClient checks: blockedUntil > now?
        → YES → Skip client-1, try client-2
        → client-2 handles the job

T+60s:  Time passes, cooldown expires
        → Entry automatically removed on next:
          - Job attempt for that workflow
          - canClaim() check
        → Emit: client:unblocked_workflow

T+61s:  Client-1 is available for this workflow again
```

## Configuration

### SmartFailoverStrategy Options

```typescript
interface SmartFailoverStrategyOpts {
  /**
   * How long to block a client for a specific workflow after failure.
   * @default 60_000 (60 seconds)
   * @example 30_000 for faster recovery, 120_000 for longer isolation
   */
  cooldownMs?: number;

  /**
   * Number of failures before a workflow is blocked on a client.
   * @default 1 (block immediately)
   * @example 3 for more tolerant strategy
   */
  maxFailuresBeforeBlock?: number;
}
```

### WorkflowPool Options

```typescript
interface WorkflowPoolOpts {
  /**
   * Failover strategy instance
   * @default new SmartFailoverStrategy()
   */
  failoverStrategy?: FailoverStrategy;

  /**
   * Queue adapter for persistence/distribution
   * @default new MemoryQueueAdapter()
   */
  queueAdapter?: QueueAdapter;

  /**
   * Health check interval to keep connections alive
   * @default 30000 (30 seconds)
   * Set to 0 to disable
   */
  healthCheckIntervalMs?: number;
}
```

### Usage Example

```typescript
import { WorkflowPool, SmartFailoverStrategy, MemoryQueueAdapter } from "comfyui-node";

const clients = [
  new ComfyApi("http://node-1:8188"),
  new ComfyApi("http://node-2:8188"),
  new ComfyApi("http://node-3:8188")
];

const pool = new WorkflowPool(clients, {
  failoverStrategy: new SmartFailoverStrategy({
    cooldownMs: 60_000,           // 60 second cooldown
    maxFailuresBeforeBlock: 1     // Block on first failure
  }),
  queueAdapter: new MemoryQueueAdapter(),
  healthCheckIntervalMs: 30_000   // Health check every 30 seconds
});

await pool.ready();

// Enqueue jobs
const jobId = await pool.enqueue(workflow, {
  metadata: { tenantId: "tenant-1" },
  priority: 5,
  includeOutputs: ["SaveImage"]
});

// Monitor events
pool.on("client:blocked_workflow", (ev) => {
  const { clientId, workflowHash } = ev.detail;
  console.log(`${clientId} is blocked for ${workflowHash.slice(0, 8)}`);
});

pool.on("client:unblocked_workflow", (ev) => {
  const { clientId, workflowHash } = ev.detail;
  console.log(`${clientId} recovered for ${workflowHash.slice(0, 8)}`);
});
```

## Event Reference

### Job Events

```typescript
// Job was added to queue
pool.on("job:queued", (ev) => {
  const { job } = ev.detail;
  console.log(`Job queued: ${job.jobId}`);
});

// Job assigned to a client (about to run)
pool.on("job:accepted", (ev) => {
  const { job } = ev.detail;
  console.log(`Job accepted by ${job.clientId}`);
});

// Job started execution (received promptId)
pool.on("job:started", (ev) => {
  const { job } = ev.detail;
  console.log(`Job started: ${job.promptId}`);
});

// Job progress update
pool.on("job:progress", (ev) => {
  const { jobId, progress } = ev.detail;
  console.log(`Job ${jobId}: ${progress.value}/${progress.max}`);
});

// Job completed successfully
pool.on("job:completed", (ev) => {
  const { job } = ev.detail;
  console.log(`Job completed after ${job.attempts} attempt(s)`);
});

// Job failed permanently
pool.on("job:failed", (ev) => {
  const { job, willRetry } = ev.detail;
  console.log(`Job failed: ${job.lastError} (retry=${willRetry})`);
});

// Job cancelled by caller
pool.on("job:cancelled", (ev) => {
  const { job } = ev.detail;
  console.log(`Job cancelled: ${job.jobId}`);
});
```

### Client Events

```typescript
// Client online/offline or state change
pool.on("client:state", (ev) => {
  const { clientId, online, busy } = ev.detail;
  console.log(`${clientId}: online=${online}, busy=${busy}`);
});

// Workflow hash blocked on a specific client
pool.on("client:blocked_workflow", (ev) => {
  const { clientId, workflowHash } = ev.detail;
  console.log(`${clientId} blocked for workflow ${workflowHash.slice(0, 8)}`);
  // Can emit alert, update metrics, etc.
});

// Workflow hash unblocked (cooldown expired)
pool.on("client:unblocked_workflow", (ev) => {
  const { clientId, workflowHash } = ev.detail;
  console.log(`${clientId} available for workflow ${workflowHash.slice(0, 8)}`);
});
```

## Real-World Scenarios

### Scenario 1: Multi-Tenant System

Different tenants submit diverse workflows. One tenant's problematic workflow shouldn't affect others:

```typescript
// Tenant A's high-memory workflow fails on client-1
// → Only blocks that specific workflow on client-1
// → Tenant B's workflows continue on client-1 normally
// → Tenant A's workflow succeeds on client-2
```

### Scenario 2: Specialized Clients

Some clients have specific hardware (e.g., RTX 4090) for complex workflows:

```typescript
// You can combine hash-based routing with client affinity hints:
const jobId = await pool.enqueue(complexWorkflow, {
  preferredClientIds: ["gpu-client-1", "gpu-client-2"],  // Try GPU clients first
  // If both fail on this workflow, route to others
});
```

### Scenario 3: Monitoring & Alerting

Track workflow health across your cluster:

```typescript
const workflowHealthMap = new Map<string, { failures: number; lastFailedAt: Date }>();

pool.on("client:blocked_workflow", (ev) => {
  const key = ev.detail.workflowHash;
  const health = workflowHealthMap.get(key) || { failures: 0, lastFailedAt: new Date() };
  health.failures++;
  health.lastFailedAt = new Date();
  workflowHealthMap.set(key, health);

  // Alert if workflow fails on multiple clients
  if (health.failures > 2) {
    console.warn(`⚠️ Workflow ${key} is problematic (${health.failures} failures)`);
    // Trigger investigation, revert workflow definition, etc.
  }
});

pool.on("client:unblocked_workflow", (ev) => {
  const key = ev.detail.workflowHash;
  console.log(`✅ Workflow ${key} recovered on ${ev.detail.clientId}`);
});
```

## Demos

Two comprehensive demos are included:

### 1. Basic Demo: `scripts/pool-hash-routing-demo.ts`

Educational demo showing core hash-based routing concepts without real servers:

```bash
bun scripts/pool-hash-routing-demo.ts [--verbose]
```

**Shows:**
- Deterministic workflow hashing
- Client failure and blocking
- Smart failover mechanics
- Cooldown and recovery
- Workflow independence

### 2. Advanced Demo: `scripts/pool-hash-routing-advanced.ts`

Integration demo with optional real ComfyUI servers:

```bash
# With real servers
COMFY_HOSTS=http://host1:8188,http://host2:8188 bun scripts/pool-hash-routing-advanced.ts

# Simulation mode (no servers needed)
bun scripts/pool-hash-routing-advanced.ts
```

**Shows:**
- Multi-tenant job routing
- Workflow affinity optimization
- Event monitoring and alerting
- Custom failover strategies
- Real-world monitoring patterns

## Performance Considerations

### Memory Usage

Hash-based routing adds minimal overhead:
- **Per Client**: ~8 bytes per tracked workflow hash
- **Per Workflow Failure**: ~40 bytes (hash + timestamp + count)
- **Example**: 3 clients × 100 workflows × 40 bytes = ~12 KB

### CPU Impact

- **Hash Calculation**: ~0.1-1ms per workflow (SHA-256 on ~1-10KB JSON)
- **Lookup**: O(1) hash map operations
- **Overall**: <1ms per job enqueue/process

### Recommendations

1. **Cooldown Tuning**: 
   - Fast recovery: 30s (for development/unstable servers)
   - Normal: 60s (default, balanced)
   - Conservative: 120s (for production stability)

2. **Max Failures Before Block**:
   - Tolerant: 3+ (allow retries)
   - Normal: 1 (default, immediate failover)
   - Strict: 1 (block on first failure)

3. **Health Check**:
   - Set to 30-60s for stable systems
   - Increase to 60-120s if bandwidth-constrained
   - Set to 0 to disable if using external health monitoring

## Troubleshooting

### Problem: Workflow keeps failing even after cooldown expires

**Causes:**
1. Underlying issue not resolved (check ComfyUI logs)
2. Cooldown too short for recovery (increase `cooldownMs`)
3. Subsequent attempts hitting same issue

**Solution:**
```typescript
const strategy = new SmartFailoverStrategy({
  cooldownMs: 120_000,  // Increase to 2 minutes
  maxFailuresBeforeBlock: 2  // Allow 2 failures before blocking
});
```

### Problem: One client is blocked for too long

**Causes:**
1. Cooldown period active (by design, prevents busy retry loop)
2. Workflow still problematic on that client

**Solution:**
```typescript
// Manual reset if workflow is fixed
// (Note: This requires access to strategy instance)
// strategy.resetForWorkflow(workflowHash);

// Or wait for cooldown to expire naturally
```

### Problem: Jobs not routing to preferred clients

**Causes:**
1. Preferred clients blocked for that workflow hash
2. Preferred clients offline/busy
3. Filter results in no available clients

**Solution:**
```typescript
// Combine with enough fallback clients
const jobId = await pool.enqueue(workflow, {
  preferredClientIds: ["gpu-1", "gpu-2", "gpu-3"],  // Multiple preferences
  // If all blocked, routes to any available client
});
```

## See Also

- [SmartFailoverStrategy](../src/pool/failover/SmartFailoverStrategy.ts)
- [WorkflowPool](../src/pool/WorkflowPool.ts)
- [Hash Utilities](../src/pool/utils/hash.ts)
- [WorkflowPool Events](../src/pool/types/events.ts)
