# Workflow Pool

The `WorkflowPool` is a higher-level execution orchestrator designed for multi-client ComfyUI deployments. It wraps a set of `ComfyApi` clients, manages a pluggable job queue, and fans out WebSocket-native events with per-job correlation. Unlike the legacy `ComfyPool`, job admission and scheduling are handled entirely client-side, enabling integration with external queuing backends and cluster-aware failover strategies.

## Key Concepts

- **Queue Adapters** – Implement the `QueueAdapter` interface to back the pool with Redis, BullMQ, RabbitMQ, or in-memory queues. The pool never blocks on the ComfyUI server queue depth.
- **Failover Strategy** – The default `SmartFailoverStrategy` rate-limits problematic nodes per workflow hash. You can provide a custom strategy to plug into your health heuristics.
- **Event-Driven API** – `WorkflowPool` extends `TypedEventTarget` and emits structured events such as `job:queued`, `job:accepted`, `job:progress`, `job:failed`, and `job:completed`. All payloads include the pool-generated job id for correlation.
- **Job Registry** – Every `enqueue` call returns a unique job id and stores metadata (attempt counts, prompt id, result payload). Consumers can inspect job status via `getJob` at any time.
- **Smart Cancel & Interrupt** – Cancelling a queued job removes it from the adapter; cancelling a running job triggers a ComfyUI interrupt and cleans up pool state.

## Getting Started

```ts
import { ComfyApi, WorkflowPool, MemoryQueueAdapter } from "comfyui-node";

const clients = [
  new ComfyApi("http://node-a:8188"),
  new ComfyApi("http://node-b:8188")
];

const pool = new WorkflowPool(clients, {
  queueAdapter: new MemoryQueueAdapter()
});

pool.on("pool:ready", () => console.log("Pool ready"));

pool.on("job:progress", (ev) => {
  console.log(`job ${ev.detail.jobId} progress`, ev.detail.progress.value);
});

const jobId = await pool.enqueue(myWorkflowJson, {
  priority: 5,
  metadata: { userId: "42" },
  includeOutputs: ["SaveImage"]
});

console.log("queued", jobId);
```

## QueueAdapter Interface

```ts
interface QueueAdapter {
  enqueue(payload: WorkflowJobPayload, opts?: { priority?: number; delayMs?: number }): Promise<void>;
  reserve(): Promise<QueueReservation | null>;
  commit(reservationId: string): Promise<void>;
  retry(reservationId: string, opts?: { delayMs?: number }): Promise<void>;
  discard(reservationId: string, reason?: unknown): Promise<void>;
  remove(jobId: string): Promise<boolean>;
  stats(): Promise<QueueStats>;
  shutdown(): Promise<void>;
}
```

The in-memory adapter ships by default for single-process scenarios. Production deployments should provide a durable implementation.

## Event Reference

| Event | Detail |
| --- | --- |
| `pool:ready` | `{ clientIds }` once all clients finish `init()` |
| `job:queued` | `{ job }` emitted on first enqueue and on every retry enqueue |
| `job:accepted` | `{ job }` after the Comfy server acknowledges the prompt |
| `job:progress` | `{ jobId, clientId, progress }` (WebSocket origin) |
| `job:preview` | `{ jobId, clientId, blob }` streamed previews |
| `job:output` | `{ jobId, clientId, key, data }` node output events |
| `job:completed` | `{ job }` on successful completion |
| `job:failed` | `{ job, willRetry }` with the captured error in `job.lastError` |
| `job:retrying` | `{ job, delayMs }` before job requeued |
| `job:cancelled` | `{ job }` when removed or interrupted |
| `client:state` | `{ clientId, online, busy, lastError? }` status transitions |
| `client:blocked_workflow` | `{ clientId, workflowHash }` when a node is temporarily avoided for that workflow |
| `client:unblocked_workflow` | `{ clientId, workflowHash }` when the block is lifted |

## Failover Strategy

`SmartFailoverStrategy` blocks a client from receiving the same workflow hash after a configurable number of failures, automatically unblocking after a cooldown. Implement `FailoverStrategy` to integrate heuristics such as GPU health or tenant affinity.

```ts
const pool = new WorkflowPool(clients, {
  failoverStrategy: new SmartFailoverStrategy({
    cooldownMs: 2 * 60_000,
    maxFailuresBeforeBlock: 2
  })
});
```

## Cancellation

```ts
const cancelled = await pool.cancel(jobId);
if (!cancelled) {
  console.warn("Job already finished or missing");
}
```

Queued jobs are removed immediately. Running jobs trigger `interrupt` on the underlying `ComfyApi` client and emit `job:cancelled` once the pool updates the registry.

---

For migration guidance from `ComfyPool`, consult the `CHANGELOG.md` entry for the release introducing `WorkflowPool`.
