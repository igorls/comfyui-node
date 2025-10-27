# Hash-Based Routing Architecture

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         WorkflowPool                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────┐      ┌──────────────────────┐              │
│  │  Job Enqueue      │      │  SmartFailover       │              │
│  │                   │      │  Strategy            │              │
│  │  • Generate hash  │──┐   │                      │              │
│  │  • Create job     │  │   │  Track:              │              │
│  │  • Queue job      │  └──>│  - Per (client,      │              │
│  │                   │      │    workflow) pair    │              │
│  └───────────────────┘      │  - Failure count     │              │
│                             │  - Block expiry      │              │
│                             └──────────────────────┘              │
│                                      │                             │
│  ┌──────────────────────┐           │                             │
│  │  Job Processing      │           │                             │
│  │                      │           ▼                             │
│  │  • Find available    │      Filter clients:                    │
│  │    clients           │────>  shouldSkipClient()               │
│  │  • Apply failover    │      if blocked:                       │
│  │    strategy          │        try next client                 │
│  │  • Route to client   │                                         │
│  └──────────────────────┘      ┌──────────────────────┐          │
│           │                    │  Selected Client     │          │
│           │                    │                      │          │
│           └───────────────────>│  • Start execution   │          │
│                                │  • Emit events       │          │
│                                │  • Report result     │          │
│                                └──────────────────────┘          │
│                                        │                          │
│                                ┌───────┴──────────┐              │
│                                │                  │               │
│                             SUCCESS            FAILURE            │
│                                │                  │               │
│           ┌────────────────────┴──────────┐      │               │
│           │                               │      │               │
│      Delete block               recordFailure()  │               │
│      entry if exists            │               │               │
│      │                          ▼               ▼               │
│      │                    ┌──────────────────────────┐          │
│      │                    │  workflowFailures[      │          │
│      │                    │    clientId][hash]      │          │
│      │                    │  = {                    │          │
│      │                    │    blockedUntil: now+60s│          │
│      │                    │    failureCount: n      │          │
│      │                    │  }                      │          │
│      │                    └──────────────────────────┘          │
│      │                             │                             │
│      │                    Emit: client:blocked_workflow          │
│      │                                                            │
│      └─────────────┬──────────────────────────────────────────┘  │
│                    │                                               │
│         ┌──────────┴─────────┐                                    │
│         │ After cooldown     │                                    │
│         │ expires (60s):     │                                    │
│         │                    ▼                                    │
│         │  Delete entry     ✅ Available again                   │
│         │  │                                                      │
│         │  └──> Emit: client:unblocked_workflow                 │
│         │                                                         │
│         └─> client:blocked_workflow events                       │
│             enable monitoring & alerting                         │
│                                                                   │
└─────────────────────────────────────────────────────────────────────┘
```

## Data Structures

### SmartFailoverStrategy State

```typescript
// Core tracking structure
workflowFailures: Map<clientId, Map<workflowHash, BlockState>>

interface BlockState {
  blockedUntil: number;      // Timestamp when block expires
  failureCount: number;      // Total failures for this (client, workflow)
}

// Example state:
{
  "client-1": {
    "abc123de": { blockedUntil: 1700000000000, failureCount: 1 },
    "def456gh": { blockedUntil: 1699999950000, failureCount: 2 }
  },
  "client-2": {
    "abc123de": { blockedUntil: 1699999980000, failureCount: 1 }
  }
}
```

## Job Lifecycle

### Successful Path

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. User calls: pool.enqueue(workflow, options)                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Pool.normalizeWorkflow() & hashWorkflow()                     │
│    Generate deterministic SHA-256 hash                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Create JobRecord                                             │
│    - jobId: unique UUID                                         │
│    - workflowHash: sha256(workflow)                             │
│    - status: "queued"                                           │
│    - attempts: 0                                                │
│    - startedAt: null                                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Dispatch: job:queued event                                   │
│    Add to queue adapter                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. processQueue() triggered                                      │
│    Get next job from queue                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. ClientManager.claim(job)                                     │
│    Find available candidates:                                   │
│    - online && !busy && past reconnection grace                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 7. Filter by failover strategy                                  │
│    .shouldSkipClient(candidate, job)                            │
│    Check: workflowFailures[clientId][job.workflowHash]?        │
│    → If blockedUntil > now: skip this client                   │
│    → Otherwise: use this client                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 8. runJob(selectedClient)                                       │
│    - Update job.status = "running"                              │
│    - job.attempts++                                             │
│    - job.startedAt = now                                        │
│    - job.clientId = selectedClient.id                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 9. Execute on ComfyUI server                                    │
│    - CallWrapper.run()                                          │
│    - Monitor for promptId                                       │
│    - On promptId: Dispatch job:started                          │
│    - On progress: Dispatch job:progress                         │
│    - On preview: Dispatch job:preview                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 10. Execution completes                                          │
│     - Collect output nodes                                      │
│     - job.status = "completed"                                  │
│     - job.lastError = undefined                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 11. recordSuccess(client, job)                                  │
│     Delete workflowFailures[clientId][job.workflowHash]         │
│     (Clean up any previous failure state)                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 12. Dispatch: job:completed event                               │
│     Return result to caller                                     │
└─────────────────────────────────────────────────────────────────┘
```

### Failure Path

```
┌──────────────────────────────────────┐
│ 1-9. Same as above                   │
└──────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────┐
│ 10. Execution FAILS on client        │
│     Exception thrown / timeout       │
└──────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────┐
│ 11. recordFailure(client, job, err)  │
│                                      │
│ Get or create:                       │
│ workflowFailures[clientId] = new Map │
│                                      │
│ Increment failure count              │
│ failureCount++                       │
│                                      │
│ Calculate block expiry:              │
│ blockedUntil = now + cooldownMs      │
│                                      │
│ Update entry:                        │
│ workflowFailures[clientId][hash] =   │
│   { failureCount, blockedUntil }     │
└──────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────┐
│ 12. Dispatch:                        │
│ client:blocked_workflow event        │
│ {                                    │
│   clientId: string,                  │
│   workflowHash: string               │
│ }                                    │
└──────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────┐
│ 13. Determine retry strategy:        │
│                                      │
│ if maxAttemptsReached:               │
│   job.status = "failed"              │
│   Dispatch: job:failed event         │
│                                      │
│ else:                                │
│   Queue for retry                    │
│   Dispatch: job:retrying event       │
└──────────────────────────────────────┘
                      │
                      ▼
         ┌───────────────────┐
         │ Next processQueue │
         │ cycles will:      │
         │                   │
         │ 1. See job needs  │
         │    retry          │
         │ 2. Get available  │
         │    candidates     │
         │ 3. Check strategy │
         │    for this hash  │
         │ 4. Skip client-X  │
         │    (blocked)      │
         │ 5. Route to       │
         │    client-Y       │
         └───────────────────┘
```

## Failure Recovery Timeline

```
Timeline of a blocked workflow with 60s cooldown:

T+0s ┌─ Execution fails on client-1
     │  recordFailure():
     │  workflowFailures["client-1"]["hash-ABC"] = {
     │    blockedUntil: T+60s,
     │    failureCount: 1
     │  }
     │  Emit: client:blocked_workflow
     │
T+5s ├─ New job arrives for same workflow
     │  processQueue():
     │  shouldSkipClient(client-1, job):
     │    Check: blockedUntil > now?
     │    YES (T+60s > T+5s)
     │    Return: true (skip)
     │  Try next client → client-2 ✅
     │
T+30s├─ Another job for same workflow
     │  Repeat: blockedUntil > now? YES
     │  Skip client-1, use client-3 ✅
     │
T+60s├─ Cooldown expires (exact moment)
     │  Next processQueue():
     │  shouldSkipClient(client-1, job):
     │    Check: blockedUntil > now?
     │    NO (T+60s NOT > T+60s)
     │    Delete entry
     │    Return: false (use this client)
     │
T+61s├─ Job routed to client-1 again
     │  Emit: client:unblocked_workflow
     │  ✅ Client-1 available for this workflow
     │
```

## Configuration Impact

### Cooldown Duration

```
cooldownMs: 30_000  (30s)
├─ Fast recovery
├─ Good for: Development, unstable hardware
└─ Risk: Might retry before recovery complete

cooldownMs: 60_000  (60s) ← DEFAULT
├─ Balanced recovery
├─ Good for: Most production scenarios
└─ Prevents busy retry loops

cooldownMs: 120_000 (2min)
├─ Conservative recovery
├─ Good for: Heavy workflows, slow recovery servers
└─ Longer isolation period
```

### Max Failures Before Block

```
maxFailuresBeforeBlock: 1  ← DEFAULT
├─ Block immediately on first failure
├─ Good for: Consistent, reliable workflows
└─ Fail fast, recover quick

maxFailuresBeforeBlock: 3
├─ Allow 3 failures before blocking
├─ Good for: Occasional transient failures
└─ More tolerant, but slower to detect issues
```

## Monitoring & Observability

### Key Events for Monitoring

```typescript
// Production monitoring:
pool.on("client:blocked_workflow", (ev) => {
  // Alert: specific workflow problematic on specific client
  // Data: clientId, workflowHash
  // Action: Investigate server logs, node definitions
});

pool.on("client:unblocked_workflow", (ev) => {
  // Info: client recovered for workflow
  // Data: clientId, workflowHash
  // Action: Log recovery, update metrics
});

pool.on("job:failed", (ev) => {
  // Error: job execution failed
  // Data: job details, error, attempt count
  // Action: Retry or escalate based on attempts
});

// Performance monitoring:
pool.on("job:progress", (ev) => {
  // Track execution progress
  // Detect stalled jobs
});

pool.on("client:state", (ev) => {
  // Track client availability
  // Monitor reconnections
});
```

## Performance Characteristics

### Space Complexity

```
Per client: O(N) where N = number of unique workflows seen
Per workflow: O(1) hash entry

Example:
- 3 clients
- 100 distinct workflows per client
- ~40 bytes per failure entry
Total: 3 × 100 × 40 = 12 KB

Scales linearly with clients and workflows.
```

### Time Complexity

```
enqueue():
  - hashWorkflow(): O(workflow size) ≈ 1-5ms
  - Add to queue: O(1)
  Total: O(workflow size)

claim():
  - Get candidates: O(clients)
  - Filter by failover: O(clients) hash lookups = O(1) each
  Total: O(clients)

shouldSkipClient():
  - Hash map lookup: O(1)
  - Timestamp comparison: O(1)
  Total: O(1)

processQueue():
  - Per job: O(clients) in worst case
  - Scales well with CPU power of pool
```

## Best Practices

1. **Use consistent workflow definitions**
   - Same workflow type = consistent hashing
   - Enables tracking across restarts

2. **Monitor blocking events**
   - Set up alerts on `client:blocked_workflow`
   - Correlate with server logs
   - Track failure trends

3. **Tune cooldown for your hardware**
   - Measure recovery time on your servers
   - Set cooldown slightly higher
   - Balance between isolation and capacity

4. **Combine with alerting**
   - Block count > 1 per workflow = investigate
   - If multiple clients block same workflow = workflow issue
   - Pattern analysis enables proactive fixes

5. **Use metadata for correlation**
   - Add tenantId, userId to job metadata
   - Filter events by metadata
   - Build dashboards per tenant/workflow

## Summary

Hash-based routing provides intelligent, automatic, fine-grained failure handling:

- **Workflow-level tracking** (not client-level)
- **Automatic failover** to healthy clients
- **Self-healing** recovery after cooldown
- **Observable** via events for monitoring
- **Multi-tenant safe** with isolation

This enables production-grade multi-instance scheduling without manual intervention.
