# Changelog

## 1.6.2

**What's New:**

* **MultiWorkflowPool** – Event-driven heterogeneous cluster management for ComfyUI workers
  * Manage pools of ComfyUI servers with different workflow capabilities (e.g., SDXL servers, Flux servers, ControlNet servers)
  * **Workflow Affinity Routing** – Automatically route jobs to servers with matching workflow capabilities based on workflow hash
  * **Zero Polling Architecture** – Fully event-driven design with no polling loops for maximum responsiveness and scalability
  * **Per-Workflow Queues** – Separate job queues per workflow type with intelligent fallback to general queue
  * **Client Priority System** – Configure server priority for workflow assignments
  * **Structured Logging** – Built-in logger with configurable log levels (`debug`, `info`, `warn`, `error`, `silent`)
  * **Integrated Profiling** – Optional per-node execution profiling adapted from WorkflowPool
  * **Progress & Preview Events** – Real-time job progress tracking and preview image streaming
  * **Smart Client Management** – Automatic idle/busy state tracking and failover handling

**Architecture:**

```typescript
const pool = new MultiWorkflowPool({
  logLevel: "info",           // Structured logging
  enableProfiling: true,      // Per-node timing stats
  enableMonitoring: true,     // Periodic status summaries
  connectionTimeoutMs: 10000  // Connection timeout per client
});

// Add clients with workflow affinity
pool.addClient("http://server1:8188", {
  workflowAffinity: [sdxlWorkflow],  // Routes SDXL jobs here
  priority: 1
});

pool.addClient("http://server2:8188", {
  workflowAffinity: [fluxWorkflow],  // Routes Flux jobs here
  priority: 2
});

await pool.init();

// Submit jobs - automatic routing to appropriate server
const jobId = await pool.submitJob(sdxlWorkflow);

// Track progress and get results
pool.attachJobProgressListener(jobId, ({ value, max }) => {
  console.log(`Progress: ${Math.round(value/max*100)}%`);
});

const result = await pool.waitForJobCompletion(jobId);
console.log('Profile Stats:', result.profileStats);
```

**Key Features:**

* **ClientRegistry** – Manages client connections, states (idle/busy/offline), and workflow affinity matching
* **JobQueueProcessor** – Per-workflow queue processing with event-driven job assignment
* **JobStateRegistry** – Centralized job lifecycle management with profiling integration
* **PoolEventManager** – Extensible event system for custom monitoring and integration

**Events Supported:**

* Job lifecycle: `job:queued`, `job:started`, `job:completed`, `job:failed`, `job:cancelled`
* Progress tracking: Real-time progress updates with node execution tracking
* Preview streaming: `b_preview_meta` events with blob and metadata
* Client state: Automatic idle/busy transitions, offline detection

**Performance:**

* Event-driven architecture eliminates polling overhead
* O(1) workflow hash lookup for client routing
* Separate queues prevent head-of-line blocking
* Profiling shows cache hit rates, node timing, and execution bottlenecks

**Documentation:**

* `docs/multipool-profiling.md` – Profiling guide for MultiWorkflowPool
* `src/multipool/tests/profiling-demo.ts` – Complete profiling demonstration
* `src/multipool/tests/two-stage-edit-simulation.ts` – Multi-user workflow simulation

**New Exports:**

* `MultiWorkflowPool` – Main pool class
* `JobProfiler` – Per-job execution profiling (MultiWorkflowPool variant)
* `Logger` / `createLogger` – Structured logging infrastructure
* Types: `MultiWorkflowPoolOptions`, `JobResults`, `JobState`, `JobProfileStats`

**Use Cases:**

* Multi-tenant SaaS platforms with heterogeneous server capabilities
* Workflow-specific server pools (image generation, video, upscaling, etc.)
* Development/testing with mixed local and cloud ComfyUI instances
* Load balancing across geographically distributed servers

## 1.5.0

**What's New:**

* **WorkflowPool Profiling** – Enable automatic per-node performance tracking
  * Set `enableProfiling: true` to get detailed execution stats on every job
  * Stats include node timing, progress events, cache hits, and slowest bottlenecks
  * Access via `job.profileStats` in `job:completed` events
  * Example: `"KSampler: 4328ms (50% of execution)"` – instantly see where time is spent
  * Zero overhead when disabled (default)

* **Timeout Protection** – Prevent jobs from hanging on stuck servers
  * **Execution Start Timeout** (default: 5s) – Auto-retry if server hangs before starting
  * **Node Execution Timeout** (default: 5 min) – Handle slow model loading or stuck nodes
  * Works with SmartFailoverStrategy to automatically route jobs to healthy servers
  * Configure: `new WorkflowPool(clients, { executionStartTimeoutMs: 5000, nodeExecutionTimeoutMs: 600000 })`

**Configuration:**

```typescript
const pool = new WorkflowPool(clients, {
  enableProfiling: true,              // Get per-node timing stats
  executionStartTimeoutMs: 5000,      // 5s - retry if execution doesn't start
  nodeExecutionTimeoutMs: 600000      // 10 min - for slow model loading
});

pool.on('job:completed', (event) => {
  const stats = event.detail.job.profileStats;
  if (stats) {
    console.log(`Total: ${stats.totalDuration}ms`);
    console.log('Slowest nodes:', stats.summary.slowestNodes);
  }
});
```

**Documentation:**

* `docs/profiling.md` – Profiling guide with examples and best practices
* `docs/execution-timeout.md` – Timeout tuning and troubleshooting
* `scripts/demo-pool-profiling.ts` – See profiling in action

**New Types:**

* `JobProfileStats` – Complete execution statistics with summary and per-node breakdown
* `NodeExecutionProfile` – Individual node metrics (duration, progress, status)

**Fixes:**

* Improved TypeScript compatibility (removed `Array.at()`, fixed Map iteration for ES2022)

## 1.4.3

Features:

* **Hash-Based Workflow Routing with SmartFailoverStrategy**
  * Introduced deterministic SHA-256 hashing of workflow content to enable fine-grained failure tracking and intelligent routing
  * Failures are now tracked per (client, workflow-hash) pair instead of per-client, enabling per-workflow blocking
  * Jobs with the same workflow content automatically route around previously failed clients during the cooldown period (default: 60 seconds, configurable)
  * Duplicate workflows detected via hash are routed to the same server when possible, improving cache hit rates and resource efficiency
  * SmartFailoverStrategy integrated into WorkflowPool by default – no configuration needed
  * Configuration: `new WorkflowPool(clients, { blockDuration: 60000, maxFailuresBeforeBlock: 1 })`
  * Multi-tenant safe: Each tenant's workflows are independently tracked and blocked, preventing cross-tenant interference

Developer Experience:

* Added comprehensive demo scripts showcasing hash-based routing:
  * `scripts/pool-hash-routing-demo.ts` – Educational demo with 4 complete scenarios (normal execution, failures, blocking, recovery) using mock clients
  * `scripts/pool-hash-routing-advanced.ts` – Integration patterns with multi-tenant routing, workflow affinity, and real server support
  * `scripts/pool-multitenant-example.ts` – Production-ready multi-tenant service template
  * `scripts/pool-real-demo.ts` – Intelligent server capability discovery with real workflow execution and hash-routing demonstration
* Added comprehensive documentation:
  * `docs/hash-routing-guide.md` – Practical configuration guide with usage patterns and best practices
  * `docs/hash-routing-architecture.md` – System diagrams, data structures, job lifecycle flows, and performance analysis
  * `HASH_ROUTING_INDEX.md` – Getting started guide with learning paths (5-min quickstart to production integration)
  * `DEMO_PACKAGE.md` – Complete package overview of all resources
  * `docs/hash-routing-quickstart.sh` – Command reference for running demos
* Updated README with hash-routing section and documentation links
* All demos tested with real ComfyUI servers and verified working with multi-server deployments

Technical Details:

* Hash algorithm: Deterministic SHA-256 of JSON-normalized workflow content (order-independent)
* Event system: New `client:blocked_workflow` and `client:unblocked_workflow` events for monitoring
* Blocking lifecycle: Automatic unblocking after cooldown period – self-healing with no manual intervention required
* Performance: O(1) lookup for blocked workflows, minimal memory overhead per client
* Backward compatible: Existing WorkflowPool code works without changes; hash routing is automatic

## 1.4.1

Fixes:

* **Resolved WorkflowPool idle connection stability issue**
  * Increased default WebSocket inactivity timeout from 10s to 60s to prevent false disconnections during normal idle periods
  * ComfyUI servers don't send heartbeat messages when idle, causing the old 10s timeout to trigger unnecessary reconnection cycles
  * Implemented automatic health check mechanism in `WorkflowPool` that pings idle clients every 30 seconds (configurable via `healthCheckIntervalMs` option)
  * Health checks use lightweight `getQueue()` calls to keep WebSocket connections alive without interfering with active jobs
  * Added proper cleanup with `ClientManager.destroy()` to stop health checks on shutdown
  * Configuration: `new WorkflowPool(clients, { healthCheckIntervalMs: 30000 })` (default: 30s, set to 0 to disable)
  * Test results: 120+ seconds of stable idle connection with zero disconnections, all WebSocket events (previews, progress, execution) received properly after long idle periods
  * Backward compatible - existing code works automatically with improvements

Developer Experience:

* Added comprehensive test scripts for connection stability:
  * `scripts/debug-idle-connections.ts` - Monitor connection cycles and detect reconnection patterns
  * `scripts/debug-websocket-activity.ts` - Track WebSocket message patterns and timing
  * `scripts/test-long-idle-then-execute.ts` - Verify connection functionality after extended idle periods
  * `scripts/test-long-idle-txt2img.ts` - Test with actual image generation including preview events
  * `scripts/test-health-check.ts` - Validate health check mechanism effectiveness
* Updated documentation in `docs/websocket-idle-issue.md` with root cause analysis, solution details, and migration guide

## 1.4.0

Features:

* Introduced `WorkflowPool`, a new event-driven pooling API with pluggable queue adapters and smarter failover heuristics. Jobs receive stable ids, WebSocket events carry the id, and backends such as Redis/BullMQ/RabbitMQ can be integrated by implementing `QueueAdapter`.
* Added `SmartFailoverStrategy` and `MemoryQueueAdapter` reference implementations plus a typed event map covering `job:*` and `client:*` lifecycle notifications.
* Published `docs/workflow-pool.md` with architecture overview, adapter contract, and event reference. Updated README multi-instance section to compare `WorkflowPool` with the legacy `ComfyPool`.

Breaking:

* None – `ComfyPool` remains unchanged and continues to be exported for existing consumers.

## 1.3.1

Features:

* Added `.bypass()` and `.reinstate()` methods to the `Workflow` class for high-level node bypassing.
  * `workflow.bypass('NODE_NAME')` – marks a node to be bypassed during execution
  * `workflow.bypass(['NODE_1', 'NODE_2'])` – bypass multiple nodes at once
  * `workflow.reinstate('NODE_NAME')` – removes a node from the bypass list
  * Methods are immutable (return new Workflow instance) and chainable
  * Bypassed nodes are automatically removed and connections rewired when `.run()` is called
  * Leverages existing `PromptBuilder.bypass()` and `CallWrapper.bypassWorkflowNodes()` implementation
  * Fully type-safe with compile-time validation of node names

Notes:

* This brings the high-level `Workflow` API to feature parity with `PromptBuilder` for node bypassing.
* Bypass functionality was already available in `PromptBuilder` (since earlier versions); this release extends it to `Workflow`.
* This is additive and backward-compatible.

## 1.3.0

Features (API Nodes / Paid Nodes):

* Added first‑class support for custom/paid API nodes via `comfyOrgApiKey`.
  * Pass it when constructing `ComfyApi(host, id?, { comfyOrgApiKey })` and it will be included in `/prompt` submissions under `extra_data.api_key_comfy_org`.
* Implemented full handling of ComfyUI binary WebSocket frames:
  * 1 PREVIEW_IMAGE → `b_preview` (Blob)
  * 2 UNENCODED_PREVIEW_IMAGE → `b_preview_raw` (Uint8Array)
  * 3 TEXT → `b_text` (string) and `b_text_meta` ({ channel, text })
  * 4 PREVIEW_IMAGE_WITH_METADATA → `b_preview` + `b_preview_meta` ({ blob, metadata })
* Added a normalized high‑level event `node_text_update` for TEXT frames emitted by API nodes (e.g. comfy_api_nodes PollingOperation):
  * `detail = { channel, text, cleanText?, kind: 'progress' | 'result' | 'message', progressSeconds?, resultUrl?, nodeHint?, executingNode?, promptIdHint? }`
  * Added `cleanText` (prefix‑stripped message). Normalization now simply starts from the first known phrase ("Task in progress:" | "Result URL:"), removing any preceding node label (e.g. numeric id or "NODE_LABEL"). Falls back to the last `executing` node when a hint isn't present in text.

DX & Diagnostics:

* New optional `debug` flag (or `COMFY_DEBUG=1`) prints structured logs for socket lifecycle and messages; sensitive headers are redacted.
* More resilient output mapping in `Workflow.output(...)`: calls like `output('2','images')` are auto‑corrected to `('images','2')` with a console warning.
* New high‑level helpers to simplify image inputs:
  * `Workflow.attachImage(nodeId, inputName, data, fileName, opts?)` – uploads a single image buffer/blob before run() and sets the input to the filename.
  * `Workflow.attachFolderFiles(subfolder, files[], opts?)` – uploads multiple files into a server subfolder (useful for `LoadImageSetFromFolderNode`).
  * Example script added: `scripts/image-loading-demo.ts` – demonstrates mixed loaders (single images + folder import) powered by the new helpers.

Notes:

* `node_text_update` is best‑effort normalization based on upstream conventions; for full fidelity keep listening to `b_text` / `b_text_meta`.
* This is additive and backward‑compatible.

## 1.2.0

Features:

* Configurable announced feature flags on the WebSocket connection via a new `ComfyApi` option `announceFeatureFlags`.
  * `supports_preview_metadata?: boolean` (default `true`)
  * `max_upload_size?: number` (bytes; default `50 * 1024 * 1024`)
  * Values are merged with defaults and sent to the server on socket open (and after reconnects).

Notes:

* This is additive and backward‑compatible. Existing behavior remains the same if you do not pass the option.

## 1.0.0

Breaking:

* Removed all previously deprecated `ComfyApi` instance wrappers in favor of modular feature namespaces (`api.ext.*`).
  * Removed methods: `queuePrompt`, `appendPrompt`, `getHistories`, `getHistory`, `getSystemStats`, `getTerminalLogs`, `setTerminalSubscription`, `getExtensions`, `getEmbeddings`, `getCheckpoints`, `getLoras`, `getSamplerInfo`, `getNodeDefs`, `getUserConfig`, `createUser`, `getSettings`, `getSetting`, `storeSettings`, `storeSetting`, `uploadImage`, `uploadMask`, `getPathImage`, `getImage`, `getUserData`, `storeUserData`, `deleteUserData`, `moveUserData`, `listUserData`, `interrupt`.
  * Also removed the internal deprecation warning helper.

Migration:

* Replace direct calls with their namespaced equivalents, e.g. `api.getSystemStats()` -> `api.ext.system.getSystemStats()`.
* See README "1.0 Migration" section for a diff table.

Other:

* Expanded branch test coverage for `CallWrapper` (execution success, cached output, error branches, interruption, went missing).
* Pruned dead code paths and improved internal consistency of feature namespace usage to avoid deprecated shims.
* Added support for metadata-enhanced preview frames (`PREVIEW_IMAGE_WITH_METADATA`):
  * Low-level: new `b_preview_meta` event with `{ blob, metadata }` while keeping `b_preview` for backward compatibility.
  * High-level: `WorkflowJob` now emits `preview_meta` alongside existing `preview`.
  * See README "Preview Metadata" for usage examples.

SemVer rationale: First major release locks in modular `ext` surface as the canonical public API; removed legacy wrappers to reduce bundle size and ambiguity.
