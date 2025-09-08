# ComfyUI SDK

[![NPM Version](https://img.shields.io/npm/v/@saintno/comfyui-sdk?style=flat-square)](https://www.npmjs.com/package/@saintno/comfyui-sdk)
[![License](https://img.shields.io/npm/l/@saintno/comfyui-sdk?style=flat-square)](https://github.com/tctien342/comfyui-sdk/blob/main/LICENSE)
![CI](https://github.com/tctien342/comfyui-sdk/actions/workflows/release.yml/badge.svg)

TypeScript SDK for interacting with the [ComfyUI](https://github.com/comfyanonymous/ComfyUI) API – focused on workflow construction, prompt execution orchestration, multi‑instance scheduling and extension integration.

> From 0.2.x the API surface is transitioning from a monolithic `ComfyApi` to modular feature namespaces under `api.ext.*`. Legacy methods remain (deprecated) with one‑time runtime warnings. See Migration section.

## Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Multi-Instance Pool](#multi-instance-pool)
- [Authentication](#authentication)
- [Custom WebSocket](#custom-websocket)
- [Modular Features (`api.ext`)](#modular-features-apiext)
- [Migration & Deprecations](#migration--deprecations)
- [Reference Overview](#reference-overview)
- [Examples](#examples)
- [Errors & Diagnostics](#errors--diagnostics)
- [Contributing](#contributing)
- [License](#license)

## Features

- Fully typed TypeScript surface
- Fluent `PromptBuilder` for graph mutation & input/output mapping
- Fluent `PromptBuilder` for graph mutation & input/output mapping (with validation & JSON (de)serialization helpers)
- WebSocket events (progress, preview, output, completion) with reconnection & HTTP polling fallback
- Weighted multi‑instance job distribution (`ComfyPool`)
- Extension integration (Manager, Crystools monitor, feature flags)
- Modular feature namespaces (`api.ext.queue`, `api.ext.node`, etc.)
- Upload helpers (images, masks) & user data file operations
- Authentication strategies (basic, bearer token, custom headers)
- Structured errors & narrow fetch helper
- Validation utilities for prompt graphs (missing mappings, immediate cycles)
- JSON round‑trip support for builder state persistence

## Installation

```bash
bun add @saintno/comfyui-sdk
# or
npm install @saintno/comfyui-sdk
```

## Quick Start

```ts
import { ComfyApi, CallWrapper, PromptBuilder, seed, TSamplerName, TSchedulerName } from "@saintno/comfyui-sdk";
import ExampleTxt2ImgWorkflow from "./example-txt2img-workflow.json";

const api = new ComfyApi("http://localhost:8189").init();
const workflow = new PromptBuilder(
  ExampleTxt2ImgWorkflow,
  ["positive","negative","checkpoint","seed","batch","step","cfg","sampler","sheduler","width","height"],
  ["images"]
)
  .setInputNode("checkpoint","4.inputs.ckpt_name")
  .setInputNode("seed","3.inputs.seed")
  .setInputNode("batch","5.inputs.batch_size")
  .setInputNode("negative","7.inputs.text")
  .setInputNode("positive","6.inputs.text")
  .setInputNode("cfg","3.inputs.cfg")
  .setInputNode("sampler","3.inputs.sampler_name")
  .setInputNode("sheduler","3.inputs.scheduler")
  .setInputNode("step","3.inputs.steps")
  .setInputNode("width","5.inputs.width")
  .setInputNode("height","5.inputs.height")
  .setOutputNode("images","9")
  .input("checkpoint","SDXL/realvisxlV40_v40LightningBakedvae.safetensors", api.osType)
  .input("seed", seed())
  .input("step", 6)
  .input("cfg", 1)
  .input<TSamplerName>("sampler","dpmpp_2m_sde_gpu")
  .input<TSchedulerName>("sheduler","sgm_uniform")
  .input("width",1024)
  .input("height",1024)
  .input("batch",1)
  .input("positive","A picture of a dog on the street");

new CallWrapper(api, workflow)
  .onFinished(d => console.log(d.images?.images.map((img: any) => api.ext.file.getPathImage(img))))
  .run();
```

### PromptBuilder Validation & Serialization

`PromptBuilder` now includes optional robustness helpers you can invoke before submission:

```ts
builder
  .validateOutputMappings()        // Ensures every declared output key maps to an existing node id
  .validateNoImmediateCycles();    // Guards against a node directly referencing itself in its input tuple

// Serialize to persist / send over IPC
const saved = builder.toJSON();
// Later restore (types must line up with original generic parameters when casting)
const restored = PromptBuilder.fromJSON(saved);
```

If validation fails an `Error` is thrown with a concise list of offending mappings, e.g.

```text
Error: Unmapped or missing output nodes: images:UNMAPPED
```

Cycle detection currently targets immediate self‑cycles (a node whose input tuple references itself). Broader multi‑hop cycle detection can be layered later without breaking this API.

### Common Validation Patterns

```ts
function safeBuild(wf: any) {
  return new PromptBuilder(wf,["positive","seed"],["images"])
    .setInputNode("positive","6.inputs.text")
    .setInputNode("seed","3.inputs.seed")
    .setOutputNode("images","9")
    .input("positive","Hello world")
    .input("seed", seed())
    .validateOutputMappings()
    .validateNoImmediateCycles();
}
```

## Multi‑Instance Pool

`ComfyPool` provides weighted job scheduling & automatic client selection across multiple ComfyUI instances. It is transport‑agnostic and only relies on the standard `ComfyApi` event surface.

### Modes

| Mode | Enum | Behavior | When to use |
| ---- | ---- | -------- | ----------- |
| Pick zero queue | `EQueueMode.PICK_ZERO` (default) | Choose any online client whose reported `queue_remaining` is 0 (prefers idle machines). Locks a client until it emits an execution event. | Co‑existence with the ComfyUI web UI where queue spikes are common. |
| Lowest queue | `EQueueMode.PICK_LOWEST` | Choose the online client with the smallest `queue_remaining` (may still be busy). | High throughput batch ingestion; keeps all nodes saturated. |
| Round‑robin | `EQueueMode.PICK_ROUTINE` | Simple rotation through available online clients irrespective of queue depth. | Latency balancing; predictable distribution. |

### Basic Example

```ts
import { ComfyApi, ComfyPool, EQueueMode, CallWrapper, PromptBuilder, seed } from "@saintno/comfyui-sdk";
import ExampleTxt2ImgWorkflow from "./example-txt2img-workflow.json";

// Create two API clients (auth / headers etc still work as normal)
const pool = new ComfyPool([
  new ComfyApi("http://localhost:8188"),
  new ComfyApi("http://localhost:8189")
]); // defaults to PICK_ZERO

// A single generation task (returns file paths for convenience)
const generate = async (api: ComfyApi) => {
  const wf = new PromptBuilder(ExampleTxt2ImgWorkflow,["positive","checkpoint","seed"],["images"])
    .setInputNode("checkpoint","4.inputs.ckpt_name")
    .setInputNode("seed","3.inputs.seed")
    .setInputNode("positive","6.inputs.text")
    .setOutputNode("images","9")
    .input("checkpoint","SDXL/realvisxlV40_v40LightningBakedvae.safetensors", api.osType)
    .input("seed", seed())
    .input("positive","A close up picture of a cat");
  return await new Promise<string[]>(resolve => {
    new CallWrapper(api, wf)
      .onFinished(data => resolve(data.images?.images.map((img: any) => api.ext.file.getPathImage(img)) || []))
      .run();
  });
};

// Dispatch 3 parallel generations across the pool
const results = await pool.batch(Array(3).fill(generate));
console.log(results.flat());
```

### Job Weighting

Jobs are inserted into an internal priority queue ordered by ascending weight. Lower weight runs earlier. By default the weight is set to the queue length at insertion (FIFO). You can override:

```ts
await Promise.all([
  pool.run(doSomethingHeavy, 10),       // runs later
  pool.run(doSomethingQuick, 1),        // runs first
  pool.run(anotherTask, 5)
]);
```

### Include / Exclude Filters

Target or avoid specific client IDs:

```ts
await pool.run(taskA, undefined, { includeIds: ["gpu-a"] }); // only gpu-a
await pool.run(taskB, undefined, { excludeIds: ["gpu-b"] }); // any except gpu-b
```

### Failover & Retries

`run()` attempts transparent failover when a job throws. It excludes the failing client and retries another (up to `maxRetries`).

```ts
await pool.run(doGenerate, undefined, undefined, { maxRetries: 3, retryDelay: 1500 });
```

Disable failover:

```ts
await pool.run(doGenerate, undefined, undefined, { enableFailover: false });
```

### Events

`ComfyPool` itself is an `EventTarget` emitting high‑level orchestration signals:

| Event | Detail Payload | When |
| ----- | -------------- | ---- |
| `init` | – | All clients added & initial processing pass done |
| `added` / `removed` | `{ client, clientIdx }` | Client lifecycle changes |
| `ready` | `{ client, clientIdx }` | Individual client fully initialized |
| `executing` / `executed` | `{ client, clientIdx }` | A job starts / finishes on a client |
| `execution_error` | `{ client, clientIdx, error, willRetry, attempt, maxRetries }` | A job threw; may retry |
| `execution_interrupted` | `{ client, clientIdx }` | Underlying API emitted interruption |
| `connected` / `disconnected` / `reconnected` | `{ client, clientIdx }` | WebSocket state relayed from `ComfyApi` |
| `terminal` | `{ clientIdx, line }` | Terminal log pass‑through |
| `system_monitor` | `{ clientIdx, data }` | Crystools monitor snapshot (when supported) |
| `add_job` | `{ jobIdx, weight }` | Job inserted into internal queue |
| `change_mode` | `{ mode }` | Queue selection mode altered |
| `have_job` | `{ client, remain }` | A client reports pending queue > 0 |
| `idle` | `{ client }` | A previously busy client reports queue 0 |

### Cleaning Up

Always invoke `destroy()` when finished to clear intervals, event listeners & underlying client connections:

```ts
pool.destroy();
```

### Combined Orchestration Example (Auth + Pool + Validation + Retry)

```ts
import { ComfyApi, ComfyPool, EQueueMode, PromptBuilder, CallWrapper, seed } from "@saintno/comfyui-sdk";

const pool = new ComfyPool([
  new ComfyApi(process.env.C1!,"c1", { credentials: { type: "bearer_token", token: process.env.C1_TOKEN! } }),
  new ComfyApi(process.env.C2!,"c2")
], { mode: EQueueMode.PICK_LOWEST });

async function generate(api: ComfyApi, text: string) {
  const wf = /* load / clone a base workflow JSON */ {} as any;
  const builder = new PromptBuilder(wf,["positive","seed"],["images"])
    .setInputNode("positive","6.inputs.text")
    .setInputNode("seed","3.inputs.seed")
    .setOutputNode("images","9")
    .input("positive", text)
    .input("seed", seed())
    .validateOutputMappings();

  return await new Promise<string[]>((resolve, reject) => {
    new CallWrapper(api, builder)
      .onFinished(d => resolve((d.images?.images||[]).map((img:any)=> api.ext.file.getPathImage(img))))
      .onFailed(err => reject(err))
      .run();
  });
}

// Weighted submission with retry semantics
const tasks = ["cat portrait","cyberpunk city","forest at dawn"].map(txt => (api: ComfyApi) => generate(api, txt));
const results = await Promise.all(tasks.map((fn,i)=> pool.run(fn, i))); // lower weight = earlier
console.log(results.flat());
pool.destroy();
```

### Choosing a Mode

| Goal | Suggested Mode |
| ---- | -------------- |
| Minimize latency spikes | `PICK_ZERO` |
| Maximize throughput | `PICK_LOWEST` |
| Deterministic striping | `PICK_ROUTINE` |

You can change dynamically:

```ts
pool.changeMode(EQueueMode.PICK_LOWEST);
```

### Observability Tips

Listen for `execution_error` with `willRetry=true` to surface transient node failures; attach Prometheus / metrics counters externally from these events if desired.

### Relation to `CallWrapper`

`ComfyPool` does not abstract prompt construction or execution detail; each job decides how to use `CallWrapper`, direct `api.ext.queue.*` calls or even file operations before enqueueing.

### Future Ideas (Contributions Welcome)

- Global circuit breaker (temporarily exclude flapping client)
- Adaptive weight assignment based on rolling execution duration
- Pluggable selection strategies via user callback

If you build one, open a PR – keep the core minimal & dependency‑free.

## Authentication

```ts
import { ComfyApi, BasicCredentials, BearerTokenCredentials, CustomCredentials } from "@saintno/comfyui-sdk";

const basic = new ComfyApi("http://localhost:8189","id1", { credentials: { type: "basic", username: "u", password: "p" } as BasicCredentials }).init();
const bearer = new ComfyApi("http://localhost:8189","id2", { credentials: { type: "bearer_token", token: "token" } as BearerTokenCredentials }).init();
const custom = new ComfyApi("http://localhost:8189","id3", { credentials: { type: "custom", headers: { "X-Api-Key": "abc" } } as CustomCredentials }).init();
```

## Custom WebSocket

```ts
import { ComfyApi, WebSocketInterface } from "@saintno/comfyui-sdk";
import CustomWebSocket from "your-custom-ws";

const api = new ComfyApi("http://localhost:8189", "node-id", { customWebSocketImpl: CustomWebSocket as WebSocketInterface }).init();
```

## Modular Features (`api.ext`)

```ts
await api.waitForReady();
await api.ext.queue.queuePrompt(null, workflow);
const stats = await api.ext.system.getSystemStats();
const checkpoints = await api.ext.node.getCheckpoints();
const embeddings = await api.ext.misc.getEmbeddings();
const flags = await api.ext.featureFlags.getServerFeatures();
```

| Namespace | Responsibility |
| --------- | -------------- |
| `queue` | Prompt submission, append & interrupt |
| `history` | Execution history retrieval |
| `system` | System stats & memory free |
| `node` | Node defs + sampler / checkpoint / lora helpers |
| `user` | User & settings CRUD |
| `file` | Uploads, image helpers, user data file ops |
| `model` | Experimental model browsing & previews |
| `terminal` | Terminal logs & subscription toggle |
| `misc` | Extensions list, embeddings (new + fallback) |
| `manager` | ComfyUI Manager extension integration |
| `monitor` | Crystools monitor events & snapshot |
| `featureFlags` | Server capabilities (`/features`) |

## Migration & Deprecations

Legacy `ComfyApi` instance methods are deprecated in favor of `api.ext.*` namespaces. Each deprecated call emits a one‑time runtime warning. Removal planned no earlier than **0.3.0**.

| Deprecated | Replacement |
| ---------- | ----------- |
| `queuePrompt(...)` | `api.ext.queue.queuePrompt(...)` |
| `appendPrompt(...)` | `api.ext.queue.appendPrompt(...)` |
| `getHistories(...)` | `api.ext.history.getHistories(...)` |
| `getHistory(id)` | `api.ext.history.getHistory(id)` |
| `getSystemStats()` | `api.ext.system.getSystemStats()` |
| `getCheckpoints()` | `api.ext.node.getCheckpoints()` |
| `getLoras()` | `api.ext.node.getLoras()` |
| `getSamplerInfo()` | `api.ext.node.getSamplerInfo()` |
| `getNodeDefs(name?)` | `api.ext.node.getNodeDefs(name?)` |
| `getExtensions()` | `api.ext.misc.getExtensions()` |
| `getEmbeddings()` | `api.ext.misc.getEmbeddings()` |
| `uploadImage(...)` | `api.ext.file.uploadImage(...)` |
| `uploadMask(...)` | `api.ext.file.uploadMask(...)` |
| `getPathImage(info)` | `api.ext.file.getPathImage(info)` |
| `getImage(info)` | `api.ext.file.getImage(info)` |
| `getUserData(file)` | `api.ext.file.getUserData(file)` |
| `storeUserData(...)` | `api.ext.file.storeUserData(...)` |
| `deleteUserData(file)` | `api.ext.file.deleteUserData(file)` |
| `moveUserData(...)` | `api.ext.file.moveUserData(...)` |
| `listUserData(...)` | `api.ext.file.listUserData(...)` |
| `getUserConfig()` | `api.ext.user.getUserConfig()` |
| `createUser(name)` | `api.ext.user.createUser(name)` |
| `getSettings()` | `api.ext.user.getSettings()` |
| `getSetting(id)` | `api.ext.user.getSetting(id)` |
| `storeSettings(map)` | `api.ext.user.storeSettings(map)` |
| `storeSetting(id,val)` | `api.ext.user.storeSetting(id,val)` |
| `getTerminalLogs()` | `api.ext.terminal.getTerminalLogs()` |
| `setTerminalSubscription()` | `api.ext.terminal.setTerminalSubscription()` |
| `interrupt()` | `api.ext.queue.interrupt()` |

Example migration:

```diff
- const stats = await api.getSystemStats();
+ const stats = await api.ext.system.getSystemStats();
- await api.uploadImage(buf, 'a.png');
+ await api.ext.file.uploadImage(buf, 'a.png');
```

## Reference Overview

Core (non‑deprecated) `ComfyApi` methods: `init`, `waitForReady`, event registration (`on`/`off`/`removeAllListeners`), `fetchApi`, `pollStatus`, `ping`, `reconnectWs`, `destroy`, and modular surface via `ext`.

Supporting classes:

- `PromptBuilder` – graph construction & value injection
- `CallWrapper` – prompt execution lifecycle helpers
- `ComfyPool` – multi‑instance scheduler

Enums & Types: `EQueueMode`, sampler / scheduler unions, `OSType`, plus exported response types found under `types/*`.

## Examples

See the `examples` directory for text‑to‑image, image‑to‑image, upscaling and pool orchestration patterns.

## Errors & Diagnostics

The SDK raises specialized subclasses of `Error` to improve debuggability during workflow submission and execution:

| Error | When | Key Extras |
| ----- | ---- | ---------- |
| `EnqueueFailedError` | HTTP `/prompt` (append/queue) failed | `status`, `statusText`, `url`, `method`, `bodyJSON`, `bodyTextSnippet`, `reason` |
| `ExecutionFailedError` | Execution finished but not all mapped outputs arrived | missing outputs context |
| `ExecutionInterruptedError` | Server emitted an interruption mid run | cause carries interruption detail |
| `MissingNodeError` | A declared bypass or output node is absent | `cause` (optional) |
| `WentMissingError` | Job disappeared from queue and no cached output | – |
| `FailedCacheError` | Cached output retrieval failed | – |
| `CustomEventError` | Server emitted execution error event | event payload in `cause` |
| `DisconnectedError` | WebSocket disconnected mid‑execution | – |

### Error Codes

Every custom error exposes a stable `code` (enum) to enable branch logic without string matching message text:

```ts
import { ErrorCode, EnqueueFailedError } from "@saintno/comfyui-sdk";

try { /* run call wrapper */ } catch (e) {
  if ((e as any).code === ErrorCode.ENQUEUE_FAILED) {
    // inspect structured diagnostics
  }
}
```

### EnqueueFailedError Details

When the server rejects a workflow submission the SDK now attempts to surface the underlying cause:

```ts
try {
  await new CallWrapper(api, workflow).run();
} catch (e) {
  if (e instanceof EnqueueFailedError) {
    console.error('Status:', e.status, e.statusText);
    console.error('Reason:', e.reason);
    console.error('Body JSON:', e.bodyJSON);
    console.error('Snippet:', e.bodyTextSnippet);
  }
}
```

`reason` is resolved using (in order): `bodyJSON.error`, `bodyJSON.message`, falling back to a truncated textual body (first 500 chars). Raw JSON (if parseable) and a short text snippet are both retained to help rapidly identify mis‑shaped prompts, missing extensions, permission issues or model path problems.

If the response body is not JSON, `bodyTextSnippet` contains the first 500 characters of the returned text, which is also copied into `reason`.

These enriched diagnostics are only attached for the enqueue phase; downstream execution issues still rely on event‑level errors.

### Execution Failure vs Interruption

- `ExecutionFailedError`: The workflow ran but one or more declared output nodes never produced data (often due to an upstream node error not surfaced as a global event). Revisit your output mappings or inspect per‑node errors.
- `ExecutionInterruptedError`: The server (or user action) actively interrupted execution; retrying may succeed if the interruption cause was transient.

### Persisting & Replaying Builder State

You can store builder state in a database / job queue:

```ts
const snapshot = builder.toJSON();
// later
const restored = PromptBuilder.fromJSON(snapshot)
  .validateOutputMappings();
```

This is useful for deferred execution, cross‑process scheduling, or audit logging of the exact prompt graph sent to the server.

## Contributing

Issues and PRs welcome. Please include focused changes and tests where sensible. Adhere to existing coding style and keep feature surfaces minimal & cohesive.

## Testing & Coverage

This repository uses Bun's built-in test runner. Common scripts:

```bash
bun test                 # unit + lightweight integration tests
bun run test:real        # real server tests (COMFY_REAL=1)
bun run test:full        # comprehensive real server tests (COMFY_REAL=1 COMFY_FULL=1)
bun run coverage         # text coverage summary (lines/functions per file)
bun run coverage:lcov    # generate coverage/lcov.info (for badges or external services)
bun run coverage:enforce # generate LCOV then enforce thresholds
```

Environment flags:

- `COMFY_REAL=1` enables `test/real.integration.spec.ts` (expects a running ComfyUI at `http://localhost:8188` unless overridden via `COMFY_HOST`).
- `COMFY_FULL=1` additionally enables the extended `test/real.full.integration.spec.ts` suite.
- `COMFY_HOST=http://host:port` to point at a non-default instance.

Coverage thresholds are enforced by `scripts/coverage-check.ts` (baseline intentionally modest to allow incremental improvement):

Default thresholds:

- Lines: `>= 25%`
- Functions: `>= 60%`

Override thresholds ad hoc (CI example):

```bash
COVERAGE_MIN_LINES=30 COVERAGE_MIN_FUNCTIONS=65 bun run coverage:enforce
```

or in PowerShell:

```powershell
$env:COVERAGE_MIN_LINES=30; $env:COVERAGE_MIN_FUNCTIONS=65; bun run coverage:enforce
```

### Improving Coverage

Current low-coverage areas (see `bun test --coverage` output):

- `src/client.ts` – large surface; break out helpers & add unit tests for fetch error branches and WebSocket reconnect logic.
- `src/call-wrapper.ts` – test error paths (enqueue failure, execution interruption, missing outputs) with mocked `fetch` & event streams.
- Feature modules with toleration logic (`monitoring`, `manager`, `terminal`) – add mocks to simulate absent endpoints & successful responses.

Incremental strategy:

1. Extract pure helper functions from monolithic classes (e.g., parsing, polling backoff) into modules you can unit test in isolation.
2. Add fine-grained tests for error branches (simulate non-200 responses & malformed JSON bodies) to raise line coverage quickly.
3. Introduce deterministic mock WebSocket that replays scripted events (connection drop, progress, output) to cover reconnect & event translation.
4. Gradually raise `COVERAGE_MIN_LINES` by 5% after each meaningful set of additions.

Skipping heavy real-image generation: full suite internally tolerates missing models & will skip or soften assertions rather than fail—use it sparingly in CI (nightly job) if runtime is a concern.

If contributing, please run at least:

```bash
bun test && bun run coverage
```
 
before opening a PR, and prefer adding tests alongside new feature code.

## License

MIT – see `LICENSE`.
