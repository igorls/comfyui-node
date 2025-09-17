# ComfyUI SDK

[![NPM Version](https://img.shields.io/npm/v/comfyui-node?style=flat-square)](https://www.npmjs.com/package/comfyui-node)
[![License](https://img.shields.io/npm/l/comfyui-node?style=flat-square)](https://github.com/igorls/comfyui-node/blob/main/LICENSE)
![CI](https://github.com/igorls/comfyui-node/actions/workflows/ci.yml/badge.svg)
![Type Coverage](https://img.shields.io/badge/type--coverage-95%25-brightgreen?style=flat-square)
![Node Version](https://img.shields.io/badge/node-%3E%3D22-brightgreen?style=flat-square)

TypeScript SDK for interacting with the [ComfyUI](https://github.com/comfyanonymous/ComfyUI) API – focused on workflow construction, prompt execution orchestration, multi‑instance scheduling and extension integration.

> 1.0 is a complete redesign around modular feature namespaces (`api.ext.*`) and stronger typing. All legacy instance methods have been removed – see Migration section if upgrading.

## Contents

- [Features](#features)
- [Installation](#installation)
- [Cheat Sheet](#cheat-sheet)
- [Recent Enhancements (Ergonomics & Typing)](#recent-enhancements-ergonomics--typing)
- [High‑Level Workflow API (Experimental) – Quick Intro](#highlevel-workflow-api-experimental--quick-intro)
- [Choosing: Workflow vs PromptBuilder](#choosing-workflow-vs-promptbuilder)
- [Result Object Anatomy](#result-object-anatomy)
- [Multi-Instance Pool](#multi-instance-pool)
- [Authentication](#authentication)
- [Custom WebSocket](#custom-websocket)
- [Modular Features (`api.ext`)](#modular-features-apiext)
- [Events](#events)
- [Preview Metadata](#preview-metadata)
- [1.0 Migration](#10-migration)
- [Reference Overview](#reference-overview)
- [Examples](#examples)
- [Errors & Diagnostics](#errors--diagnostics)
- [Troubleshooting](#troubleshooting)
- [Published Smoke Test](#published-smoke-test)
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
- High‑level `Workflow` abstraction (rapid parameter tweaking of existing JSON graphs)
- Input sugar helpers: `wf.input(...)`, `wf.batchInputs(...)`
- Soft autocomplete mode for sampler / scheduler (`Workflow.fromAugmented`)
- Progressive typed outputs inferred from `wf.output(...)` declarations
- Per‑node output shape heuristics (e.g. `SaveImage*`, `KSampler`)
- Automatic random seed substitution for `seed: -1` with `_autoSeeds` metadata

## Installation

Requires Node.js >= 22 (modern WebSocket + fetch + ES2023 features). Works with Bun as well.

```bash
npm install comfyui-node
# or
pnpm add comfyui-node
# or
bun add comfyui-node
```ts

TypeScript types are bundled; no extra install needed.

Minimal ESM usage example:

```ts
import { ComfyApi, Workflow } from 'comfyui-node';
import BaseWorkflow from './example-txt2img-workflow.json';

async function main() {
  const api = await new ComfyApi('http://127.0.0.1:8188').ready();
  const wf = Workflow.from(BaseWorkflow)
    .set('6.inputs.text', 'Hello ComfyUI SDK')
    .output('images:9');
  const job = await api.run(wf, { autoDestroy: true });
  const result = await job.done();
  for (const img of (result.images?.images || [])) {
    console.log('image path:', api.ext.file.getPathImage(img));
  }
}
main();
```ts

## Cheat Sheet

Fast reference for common operations. See deeper sections for narrative explanations.

### Workflow (High-Level)

```ts
import { ComfyApi, Workflow } from 'comfyui-node';
const api = await new ComfyApi('http://127.0.0.1:8188').ready();
const wf = Workflow.from(json)
  .set('3.inputs.steps', 20)          // dotted path set
  .input('SAMPLER','cfg', 4)          // input helper
  .batchInputs('SAMPLER', { steps: 15, cfg: 3 })
  .output('images:9');                // alias:nodeId
const job = await api.run(wf);        // acceptance barrier
job.on('progress_pct', p => console.log(p,'%'));
const result = await job.done();
for (const img of (result.images?.images||[])) console.log(api.ext.file.getPathImage(img));
```

### PromptBuilder (Lower-Level)

```ts
import { PromptBuilder } from 'comfyui-node';
const builder = new PromptBuilder(base,[ 'positive','seed' ],[ 'images' ])
  .setInputNode('positive','6.inputs.text')
  .setInputNode('seed','3.inputs.seed')
  .setOutputNode('images','9')
  .input('positive','A misty forest')
  .input('seed', 1234)
  .validateOutputMappings();
```

### Running (Alternate APIs)

```ts
await api.run(wf);            // high-level (Workflow)
await api.runWorkflow(wf);    // alias
new CallWrapper(api, builder)
  .onFinished(o => console.log(o.images?.images?.length))
  .run();                     // builder execution
```

### Declaring Outputs

```ts
wf.output('alias:NodeId');
wf.output('alias','NodeId');
wf.output('NodeId');          // key = id
// none declared -> auto collect SaveImage nodes
```

### Events (WorkflowJob)

```txt
pending -> start -> progress / progress_pct / preview -> output* -> finished (or failed)
```

| Event | Notes |
| ----- | ----- |
| pending | accepted into queue |
| start | first execution step began |
| progress_pct | integer 0-100 (deduped) |
| preview | live frame (Blob) |
| output | a declared / auto-detected node produced data |
| finished | all requested nodes resolved |
| failed | execution error / interruption |

### Seed Handling

```ts
// -1 sentinel => randomized & reported under _autoSeeds
wf.batchInputs('SAMPLER', { seed: -1 });
```

### Type Extraction

```ts
type Result = ReturnType<typeof wf.typedResult>;
```

### Pool Quick Start

```ts
const pool = new ComfyPool([
  new ComfyApi('http://localhost:8188'),
  new ComfyApi('http://localhost:8189')
]);
const job2 = await pool.clients[0].run(wf, { pool });
await job2.done();
```

### Selecting Workflow vs PromptBuilder

Use Workflow for 90% of: tweak existing JSON, few parameter edits, rapid prototyping. Use PromptBuilder when you must programmatically assemble / rewire node graphs or need validation utilities pre-submit.



### High‑Level Workflow API (Experimental) – Quick Intro

Skip manual `PromptBuilder` wiring with `Workflow` when you just want to tweak an existing graph JSON and run it. A full step‑by‑step tutorial is below; here is the 10‑second overview:

- Load JSON – `Workflow.from(json)`
- Mutate values – `.set('nodeId.inputs.field', value)`
- Declare outputs – `.output('alias:nodeId')` (or just `.output('nodeId')`; falls back to auto‑detecting `SaveImage` nodes)
- Execute – `await api.run(wf)` (or `api.runWorkflow(wf)` alias) returning a `WorkflowJob` (Promise‑like)
- Subscribe to events – `progress`, `progress_pct`, `preview`, `output`, `finished`, `failed`
- Await final object – either `await job` or `await job.done()`

See the dedicated tutorial section for a narrated example and option details.

### Recent Enhancements (Ergonomics & Typing)

The `Workflow` surface has gained several quality‑of‑life helpers and **progressive typing** features. All are additive (no breaking changes) and optional—fall back to raw `set()` / `output()` styles whenever you prefer.

| Feature | Purpose | Example | Type Effect |
| ------- | ------- | ------- | ----------- |
| `wf.input(nodeId, inputName, value)` | Concise single input mutation (vs dotted path) | `wf.input('SAMPLER','steps',30)` | none (runtime sugar) |
| `wf.batchInputs(nodeId, { ... })` | Set multiple inputs on one node | `wf.batchInputs('SAMPLER',{ steps:30, cfg:5 })` | none |
| `wf.batchInputs({ NODEA:{...} })` | Multi‑node batch mutation | `wf.batchInputs({ SAMPLER:{ cfg:6 } })` | none |
| `Workflow.fromAugmented(json)` | Soft autocomplete on sampler / scheduler but still accepts future values | `Workflow.fromAugmented(base)` | narrows fields to union \| (string & {}) |
| Typed output inference | `.output('alias:ID')` accumulates object keys | `wf.output('images:SAVE_IMAGE')` | widens result shape with `images` key |
| Per‑node output shape hints | Heuristic shapes for `SaveImage*`, `KSampler` | `result.images.images` | structural hints for nested fields |
| Multiple output syntaxes | Choose preferred style | `'alias:NodeId'` / `('alias','NodeId')` / `'NodeId'` | identical effect |
| `wf.typedResult()` | Get IDE type of final result | `type R = ReturnType<typeof wf.typedResult>` | captures accumulated generic |
| Auto seed substitution | `seed: -1` randomized before submit | `wf.input('SAMPLER','seed',-1)` | adds `_autoSeeds` map key |
| Acceptance barrier run | `await api.run(wf)` returns job handle pre-completion | `const job=await api.run(wf)` | result type unchanged |

> All typing is structural—no runtime validation. Unknown / future sampler names or new node classes continue to work.

#### Input Helpers

```ts
const wf = Workflow.fromAugmented(baseJson)
  .input('LOADER','ckpt_name','model.safetensors')
  .batchInputs('SAMPLER', {
    steps: 30,
    cfg: 4,
    sampler_name: 'euler_ancestral', // autocomplete + accepts future strings
    scheduler: 'karras',             // autocomplete + forward compatible
    seed: -1                         // -1 -> auto randomized before submit
  })
  .batchInputs({
    CLIP_TEXT_ENCODE_POSITIVE: { text: 'A moody cinematic landscape' },
    LATENT_IMAGE: { width: 896, height: 1152 }
  });
```

### Output Declaration & Typing

Each `output()` call accumulates inferred keys:

```ts
const wf2 = Workflow.fromAugmented(baseJson)
  .output('gallery:SAVE_IMAGE')       // key 'gallery'
  .output('KSamplerNode')             // key 'KSamplerNode'
  .output('thumb','THUMBNAIL_NODE');  // key 'thumb'

// Type exploration (IDE only):
type Wf2Result = ReturnType<typeof wf2.typedResult>;
// Wf2Result ~ {
//   gallery: { images?: any[] };   // SaveImage heuristic
//   KSamplerNode: { samples?: any }; // KSampler heuristic
//   thumb: any;                    // THUMBNAIL_NODE class not mapped yet
//   _promptId?: string; _nodes?: string[]; _aliases?: Record<string,string>; _autoSeeds?: Record<string,number>;
// }

const job = await api.run(wf2);
const final = await job.done();
final.gallery.images?.forEach(img => console.log(api.ext.file.getPathImage(img)));
```

Supported output forms (all equivalent semantically; choose your style):

```ts
wf.output('alias:NodeId');
wf.output('alias','NodeId');
wf.output('NodeId'); // raw key = node id
```

If you declare *no* outputs the SDK still auto‑collects all `SaveImage` nodes.

#### Per‑Node Output Shapes (Heuristics)

Currently recognized:

| class_type match | Inferred shape fragment |
| ---------------- | ----------------------- |
| `SaveImage`, `SaveImageAdvanced` | `{ images?: any[] }` |
| `KSampler` | `{ samples?: any }` |

All others are typed as `any` (you still get alias key inference). This table will expand; explicit contributions welcome.

#### Combining With Result Metadata

The object from `job.done()` (and `runAndWait`) is always the intersection:

```ts
// final result shape (conceptual)
{ ...yourDeclaredOutputs, _promptId?: string, _nodes?: string[], _aliases?: Record<string,string>, _autoSeeds?: Record<string,number> }
```

#### When to Use `Workflow.fromAugmented`

Use it when you want IDE suggestions for sampler / scheduler *without* losing forward compatibility. The widened types are `TSamplerName | (string & {})` and `TSchedulerName | (string & {})` internally—any new upstream values are valid.

#### Extracting a Stable Result Type

If you want to export a type for downstream modules:

```ts
export type MyGenerationResult = ReturnType<typeof wf.typedResult>;
```

This stays accurate as long as all `output()` calls run before the type is captured.

#### Limitations & Future Work

- Output shapes are heuristic; not all node classes annotated yet.
- Dynamic node creation using non‑strict `input()` cannot update the generic shape (TypeScript limitation). You can re‑wrap with `Workflow.fromAugmented` after structural edits if needed.
- Potential future API: `wf.withOutputShapes({ MyCustomNode: { customField: string } })` for user overrides.

---

## Choosing: Workflow vs PromptBuilder

| Criterion | Prefer Workflow | Prefer PromptBuilder |
| --------- | --------------- | -------------------- |
| Starting point | You already have a working JSON graph | You need to assemble nodes programmatically |
| Change pattern | Tweak a handful of numeric/text inputs | Add/remove/re‑wire nodes dynamically |
| Output declaration | Simple image node aliases | Complex multi‑node mapping / conditional outputs |
| Validation needs | Light (auto collect `SaveImage`) | Strong: explicit mapping + cycle checks |
| Type ergonomics | Progressive result typing via `.output()` + heuristics | Fully explicit generic parameters on construction |
| Autocomplete | Sampler / scheduler (augmented mode) | Input & output alias keys / builder fluency |
| Serialization | Not needed / reuse same base JSON | Need to persist & replay builder state |
| Scheduling | Direct `api.run(wf)` | Usually wrapped in `CallWrapper` (or converted later) |
| Learning curve | Minimal (few fluent methods) | Slightly higher (need to map inputs / outputs) |
| Migration path | Can drop down later to builder if requirements grow | Can export to JSON & wrap with `Workflow.from(...)` for simpler tweaking |

Rule of thumb: start with `Workflow`. Move to `PromptBuilder` when you feel friction needing structural graph edits or stronger pre‑submit validation.


Pool variant (experimental):

```ts
import { ComfyApi, ComfyPool, Workflow } from 'comfyui-node';
import BaseWorkflow from './example-txt2img-workflow.json';

const pool = new ComfyPool([
  new ComfyApi('http://localhost:8188'),
  new ComfyApi('http://localhost:8189')
]);

const wf = Workflow.from(BaseWorkflow)
  .set('6.inputs.text', 'A macro photo of a dewdrop on a leaf')
  .output('9');

// Run using one specific API (pool provided for scheduling context)
const api2 = pool.clients[0];
const job2 = await api2.run(wf, { pool });
await job2.done();
```

Notes:

- Experimental surface: event names / helpers may refine before a stable minor release.

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

## Result Object Anatomy

All high‑level executions (`api.run(wf)` / `runWorkflow` / `runAndWait`) ultimately resolve to an object merging:

1. Declared / inferred output aliases (each key value is the raw node output JSON for that node)
2. Heuristic shape hints (currently only augmenting `SaveImage*` & `KSampler` nodes with friendly nested fields)
3. Metadata fields: `_promptId`, `_nodes`, `_aliases`, `_autoSeeds`

Conceptual shape:

```ts
type WorkflowResult = {
  // Your keys:
  [aliasOrNodeId: string]: any; // each node's output blob (heuristically narrowed)
  // Metadata:
  _promptId?: string;
  _nodes?: string[];                 // collected node ids
  _aliases?: Record<string,string>;  // nodeId -> alias
  _autoSeeds?: Record<string,number>; // nodeId -> randomized seed (when -1 sentinel used)
};
```

Example with heuristics:

```ts
const wf = Workflow.fromAugmented(json)
  .output('gallery:SAVE_IMAGE')
  .output('sampler:KSampler');
type R = ReturnType<typeof wf.typedResult>; // => { gallery: { images?: any[] }; sampler: { samples?: any }; _promptId?: ... }
```

Heuristics are intentionally shallow – they provide just enough structure for IDE discovery without locking you into specific upstream node versions. Missing shape? You still get the alias key with `any` type; open a PR to extend the mapping.

Access patterns:

```ts
const job = await api.run(wf);
job.on('output', id => console.log('node completed', id));
const res = await job.done();
console.log(res._promptId, Object.keys(res));
for (const img of (res.gallery?.images || [])) {
  console.log(api.ext.file.getPathImage(img));
}
```

If you need a stable exported type for consumers:

```ts
export type GenerationResult = ReturnType<typeof wf.typedResult>;
```

Changing outputs later? Re‑generate the type after adding the new `.output()` call.


## Multi-Instance Pool

`ComfyPool` provides weighted job scheduling & automatic client selection across multiple ComfyUI instances. It is transport‑agnostic and only relies on the standard `ComfyApi` event surface.

### Modes

| Mode | Enum | Behavior | When to use |
| ---- | ---- | -------- | ----------- |
| Pick zero queue | `EQueueMode.PICK_ZERO` (default) | Choose any online client whose reported `queue_remaining` is 0 (prefers idle machines). Locks a client until it emits an execution event. | Co‑existence with the ComfyUI web UI where queue spikes are common. |
| Lowest queue | `EQueueMode.PICK_LOWEST` | Choose the online client with the smallest `queue_remaining` (may still be busy). | High throughput batch ingestion; keeps all nodes saturated. |
| Round‑robin | `EQueueMode.PICK_ROUTINE` | Simple rotation through available online clients irrespective of queue depth. | Latency balancing; predictable distribution. |

### Basic Example

```ts
import { ComfyApi, ComfyPool, EQueueMode, CallWrapper, PromptBuilder, seed } from "comfyui-node";
import ExampleTxt2ImgWorkflow from "./example-txt2img-workflow.json";
// ... pool basic example content (see earlier dedicated Workflow section for high-level abstraction)
```

Pool variant (experimental):

```ts
import { ComfyApi, ComfyPool, Workflow } from 'comfyui-node';
import BaseWorkflow from './example-txt2img-workflow.json';

const pool = new ComfyPool([
  new ComfyApi('http://localhost:8188'),
  new ComfyApi('http://localhost:8189')
]);

const wf = Workflow.from(BaseWorkflow)
  .set('6.inputs.text', 'A macro photo of a dewdrop on a leaf')
  .output('9');

// Run using one specific API (pool provided for scheduling context)
const api = pool.clients[0];
const job = await api.run(wf, { pool });
await job.done();
```

Notes:

- Experimental surface: event names / helpers may refine before a stable minor release.
- Falls back to `SaveImage` detection if you omit `output(...)`.
- For advanced validation, serialization, or complex key mapping prefer `PromptBuilder`.

---

## High‑Level Workflow Tutorial (New Users of This SDK)

Audience: You already understand ComfyUI graphs & node JSON, but are new to this TypeScript SDK.

Goals after this section you can: (a) clone a base workflow, (b) modify its parameters, (c) name your desired outputs, (d) track progress & previews, and (e) retrieve final image paths – with minimal boilerplate.

### 1. Prepare a Base Workflow JSON

Export or copy a working ComfyUI txt2img graph (e.g. the one in `test/example-txt2img-workflow.json`). Ensure you know the node ID of the final `SaveImage` (here we assume `9`).

### 2. Initialize the API

`api.ready()` handles connection & feature probing. It is idempotent (can be safely called multiple times). You can override the host using `COMFY_HOST`.

### 3. Mutate Parameters & Declare Outputs

Use `.set('<nodeId>.inputs.<field>', value)` to change values. Call `.output('alias:nodeId')` to collect that node's result under a friendly key (`alias`). If you omit alias (`.output('9')`) the key will be the node ID. If you omit all outputs the SDK tries to collect every `SaveImage` node automatically.

Auto seed: If any node has an input field literally named `seed` with value `-1`, the SDK will replace it with a random 32‑bit integer before submission and expose the mapping in the final result under `_autoSeeds` (object keyed by node id). This lets you keep templates with `-1` sentinel for “random every run”.

### 4. Run & Observe Progress

`api.run(workflow, { autoDestroy: true })` executes and (optionally) closes underlying sockets once finished/failed so the process can exit without manual cleanup. The returned `WorkflowJob` is an EventEmitter‑like object AND a Promise: `await job` works just like `await job.done()`.

### 5. Extract Image Paths

Final structure includes your alias keys plus `_promptId`, `_nodes` and `_aliases` metadata. Use `api.ext.file.getPathImage(imageInfo)` to build a fetchable URL.

### Complete Example

```ts
import { ComfyApi, Workflow } from 'comfyui-node';
import BaseWorkflow from './example-txt2img-workflow.json';

async function main() {
  const api = await new ComfyApi(process.env.COMFY_HOST || 'http://127.0.0.1:8188').ready();

  const wf = Workflow.from(BaseWorkflow)
    .set('4.inputs.ckpt_name', process.env.COMFY_MODEL || 'SDXL/realvisxlV40_v40LightningBakedvae.safetensors')
    .set('6.inputs.text', 'A dramatic cinematic landscape, volumetric light')
    .set('7.inputs.text', 'text, watermark')
    .set('3.inputs.seed', Math.floor(Math.random() * 10_000_000))
    .set('3.inputs.steps', 8)
    .set('3.inputs.cfg', 2)
    .set('3.inputs.sampler_name', 'dpmpp_sde')
    .set('3.inputs.scheduler', 'sgm_uniform')
    .set('5.inputs.width', 1024)
    .set('5.inputs.height', 1024)
    .output('images:9'); // alias 'images' -> node 9

  const job = await api.runWorkflow(wf, { autoDestroy: true });

  job
    .on('pending', id => console.log('[queue]', id))
    .on('start', id => console.log('[start]', id))
    .on('progress_pct', pct => process.stdout.write(`\rprogress ${pct}%   `))
    .on('preview', blob => console.log('\npreview frame bytes=', blob.size))
    .on('failed', err => console.error('\nerror', err));

  const result = await job; // or await job.done();
  console.log('\nPrompt ID:', result._promptId);
  for (const img of (result.images?.images || [])) {
    console.log('image path:', api.ext.file.getPathImage(img));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
```

### Key Options Recap

| Option | Where | Purpose |
| ------ | ----- | ------- |
| `autoDestroy` | `api.run(...)` | Automatically `destroy()` the client on finish/fail |
| `includeOutputs` | `api.run(wf,{ includeOutputs:['9'] })` | Force extra node IDs (in addition to `.output(...)`) |
| `pool` | (advanced) | Execute through a `ComfyPool` for multi‑instance scheduling |

### Event Cheat Sheet (WorkflowJob)

| Event | Payload | Description |
| ----- | ------- | ----------- |
| `pending` | promptId | Enqueued, waiting to start |
| `start` | promptId | Execution began |
| `progress` | raw `{ value,max }` | Low‑level progress data |
| `progress_pct` | number (0‑100) | Deduped integer percentage (fires on change) |
| `preview` | `Blob` | Live image preview frame |
| `output` | nodeId | Partial node output arrived |
| `finished` | final object | All requested outputs resolved |
| `failed` | `Error` | Execution failed / interrupted |

### Execution Flow & Await Semantics

`await api.run(wf)` resolves AFTER the job has been accepted (queued) and returns a `WorkflowJob` handle you can attach events to. You then explicitly `await job.done()` for final outputs.

```ts
const job = await api.run(wf);     // acceptance barrier reached -> you have prompt id via 'pending' event
job
  .on('progress_pct', pct => console.log('progress', pct))
  .on('preview', blob => console.log('preview frame', blob.size));

const outputs = await job.done();  // final mapped outputs + metadata
```

This two‑stage await keeps early feedback (events available immediately after acceptance) while still letting you write linear code for final result consumption.

Auto‑generated metadata keys:

| Key | Meaning |
| --- | ------- |
| `_promptId` | Server prompt id assigned |
| `_nodes` | Array of collected node ids |
| `_aliases` | Mapping nodeId -> alias (where provided) |
| `_autoSeeds` | Mapping nodeId -> randomized seed (only when you used -1 sentinel) |

---

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

### Pool Events

`ComfyPool` is an `EventTarget` emitting high‑level orchestration signals:

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
import { ComfyApi, ComfyPool, EQueueMode, PromptBuilder, CallWrapper, seed } from "comfyui-node";

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
import { ComfyApi, BasicCredentials, BearerTokenCredentials, CustomCredentials } from "comfyui-node";

const basic = new ComfyApi("http://localhost:8189","id1", { credentials: { type: "basic", username: "u", password: "p" } as BasicCredentials }).init();
const bearer = new ComfyApi("http://localhost:8189","id2", { credentials: { type: "bearer_token", token: "token" } as BearerTokenCredentials }).init();
const custom = new ComfyApi("http://localhost:8189","id3", { credentials: { type: "custom", headers: { "X-Api-Key": "abc" } } as CustomCredentials }).init();
```

## Custom WebSocket

```ts
import { ComfyApi, WebSocketInterface } from "comfyui-node";
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

## Events

Both `ComfyApi` and `ComfyPool` expose strongly typed event maps. Import the key unions or event maps for generic helpers:

```ts
import { ComfyApi, ComfyApiEventKey, TComfyAPIEventMap } from 'comfyui-node';

const api = new ComfyApi('http://localhost:8188');
api.on('progress', (ev) => {
  console.log(ev.detail.value, '/', ev.detail.max);
});

function handleApiEvent<K extends ComfyApiEventKey>(k: K, e: TComfyAPIEventMap[K]) {
  if (k === 'executed') {
    console.log('Node executed:', e.detail.node);
  }
}
```

Pool usage:

```ts
import { ComfyPool, ComfyPoolEventKey } from 'comfyui-node';

pool.on('execution_error', (ev) => {
  if (ev.detail.willRetry) console.warn('Transient failure, retrying...');
});
```

---

## Preview Metadata

When the server advertises the `supports_preview_metadata` feature flag, binary preview frames are sent using a richer protocol (`PREVIEW_IMAGE_WITH_METADATA`). The SDK decodes these frames and exposes both legacy and richer events.

What you get:

- Low-level API events on `ComfyApi`:
  - `b_preview` – existing event with `Blob` image only (kept for backward compatibility)
  - `b_preview_meta` – new event with `{ blob: Blob; metadata: any }`

- High-level `WorkflowJob` events:
  - `preview` – existing event with `Blob`
  - `preview_meta` – new event with `{ blob, metadata }`

Server protocol (per ComfyUI `protocol.py`):

- Binary event IDs:
  - `1` = `PREVIEW_IMAGE` (legacy)
  - `4` = `PREVIEW_IMAGE_WITH_METADATA`
- For type `4`, payload format after the 4-byte type header:
  - 4 bytes: big-endian uint32 `metadata_length`
  - N bytes: UTF-8 JSON metadata
  - remaining: image bytes (PNG or JPEG)

The SDK reads `metadata.image_type` to set the Blob MIME type.

Example – low-level API usage:

```ts
api.on('b_preview_meta', (ev) => {
  const { blob, metadata } = ev.detail;
  console.log('[b_preview_meta]', metadata, 'bytes=', blob.size);
});
```

Example – high-level Workflow API usage:

```ts
const job = await api.run(wf, { autoDestroy: true });

job
  .on('preview', (blob) => console.log('preview bytes=', blob.size))
  .on('preview_meta', ({ blob, metadata }) => {
     console.log('mime:', metadata?.image_type, 'size=', blob.size);
     // other metadata fields depend on the server implementation
  });
```

Backwards compatibility:

- If the server only emits legacy frames, you will still receive `preview` / `b_preview` events as before.
- When metadata frames are present, both are emitted: `b_preview` and `b_preview_meta` (and at the high level, `preview` and `preview_meta`).

Troubleshooting:

- Ensure your ComfyUI build supports `PREVIEW_IMAGE_WITH_METADATA` and that the feature flag is enabled. The SDK announces support via WebSocket on connect.

---

## 1.0 Migration

All legacy `ComfyApi` instance methods listed below were **removed in 1.0.0** after a deprecation window in 0.2.x. Migrate to the `api.ext.*` namespaces. If you're upgrading from <1.0, replace calls as shown. No runtime warnings remain (they were stripped with the removals).

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

Quick grep-based migration (bash):

```bash
grep -R "api\.getSystemStats" -n src | cut -d: -f1 | xargs sed -i '' 's/api\.getSystemStats()/api.ext.system.getSystemStats()/g'
```

PowerShell example:

```powershell
Get-ChildItem -Recurse -Include *.ts | ForEach-Object {
  (Get-Content $_.FullName) -replace 'api.getSystemStats\(\)', 'api.ext.system.getSystemStats()' | Set-Content $_.FullName
}
```

(Adjust the pattern per method; or use a codemod tool if you have many occurrences.)

Diff example:

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

## Monitoring: System vs Job Progress

"Monitoring" in this SDK refers to two unrelated event domains:

| Type | Source | Requires Extension | Events | Usage |
| ---- | ------ | ------------------ | ------ | ----- |
| System Monitoring | Crystools extension | Yes (ComfyUI-Crystools) | `system_monitor` (pool) + feature internals | Host CPU/GPU/RAM telemetry |
| Job Progress | Core ComfyUI | No | `executing`, `progress`, `executed`, `execution_success`, `execution_error`, `execution_interrupted`, `b_preview` | Per‑job progress %, live image previews |

System monitoring is toggled via env flags in the smoke script (`COMFY_MONITOR`, `COMFY_MONITOR_STRICT`, `COMFY_MONITOR_FORCE`) and is surfaced under `api.ext.monitor`.

Job progress monitoring is always active: subscribe directly (`api.on("progress", ...)`) or use higher‑level helpers:

```ts
new CallWrapper(api, builder)
  .onProgress(p => console.log(p.value, '/', p.max))
  .onPreview(blob => /* show transient image */)
  .onFinished(out => /* final outputs */)
  .run();
```

The published smoke test now logs job progress automatically and counts preview frames. Set `COMFY_PROGRESS_VERBOSE=1` to force log every step (not just percentage changes).

If you only need generation progress & previews you do NOT need the Crystools extension.

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
import { ErrorCode, EnqueueFailedError } from "comfyui-node";

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

## Troubleshooting

| Symptom | Likely Cause | Fix |
| ------- | ------------ | ---- |
| `progress_pct` never fires | Only listening to raw `progress` (or run finished instantly) | Subscribe to `progress_pct`; ensure workflow isn't trivially cached / instant |
| Empty `images` array | Wrong node id in `.output()` or no `SaveImage` nodes detected | Verify node id in base JSON; omit outputs to let auto-detect run |
| `_autoSeeds` missing | No `seed: -1` inputs present | Set seed field explicitly to `-1` on nodes requiring randomization |
| Autocomplete missing for sampler | Used `Workflow.from(...)` not `fromAugmented` | Switch to `Workflow.fromAugmented(json)` |
| Type not updating after new `.output()` | Captured type alias before adding the call | Recompute `type R = ReturnType<typeof wf.typedResult>` after the last output declaration |
| Execution error but no missing outputs | Underlying node error surfaced via `execution_error` event | Listen to `failed` + inspect error / server logs |
| Job hangs waiting for output | Declared non-existent node id | Run with fewer outputs or validate JSON; inspect `_nodes` metadata |
| Random seed not changing between runs | Provided explicit numeric seed | Use `-1` sentinel or generate a random seed before `.set()` |
| Preview frames never appear | Workflow lacks preview-capable nodes (e.g. KSampler) | Confirm server emits `b_preview` events for your graph |
| Pool never selects idle client | Mode set to `PICK_LOWEST` with constant queue depth | Switch to `PICK_ZERO` for latency focus |
| High-level run returns immediately | Accessed `await api.run(wf)` only (acceptance barrier) | Await `job.done()` or events to completion |

Diagnostic tips:

- Enable verbose progress: set `COMFY_PROGRESS_VERBOSE=1` before running the smoke script.
- For enqueue failures inspect `EnqueueFailedError` fields (`status`, `reason`, `bodyTextSnippet`).
- Use `_aliases` metadata to confirm alias -> node id mapping at runtime.
- Log `_autoSeeds` to verify sentinel replacement behavior in batch runs.
- If types feel stale, close & reopen the file – TypeScript sometimes caches deep conditional expansions.


## Published Smoke Test

The script `scripts/published-e2e.ts` offers a zero‑config verification of the published npm artifact with **Bun auto‑install**. It dynamically imports `comfyui-node`, builds a small txt2img workflow (optionally an upscale branch), waits for completion and prints output image URLs.

### Quick Run (Auto‑Install)

```bash
mkdir comfyui-node-smoke
cd comfyui-node-smoke
curl -o published-e2e.ts https://raw.githubusercontent.com/igorls/comfyui-node/main/scripts/published-e2e.ts
COMFY_HOST=http://localhost:8188 bun run published-e2e.ts
```

### Optional Explicit Install

```bash
mkdir comfyui-node-smoke
cd comfyui-node-smoke
bun add comfyui-node
curl -o published-e2e.ts https://raw.githubusercontent.com/igorls/comfyui-node/main/scripts/published-e2e.ts
COMFY_HOST=http://localhost:8188 bun run published-e2e.ts
```

### Environment Variables

| Var | Default | Purpose |
| --- | ------- | ------- |
| `COMFY_HOST` | `http://127.0.0.1:8188` | Base ComfyUI server |
| `COMFY_MODEL` | `SDXL/sd_xl_base_1.0.safetensors` | Checkpoint file name (must exist) |
| `COMFY_POSITIVE_PROMPT` | scenic base prompt | Positive text |
| `COMFY_NEGATIVE_PROMPT` | `text, watermark` | Negative text |
| `COMFY_SEED` | random | Deterministic seed override |
| `COMFY_STEPS` | `8` | Sampling steps |
| `COMFY_CFG` | `2` | CFG scale |
| `COMFY_SAMPLER` | `dpmpp_sde` | Sampler name |
| `COMFY_SCHEDULER` | `sgm_uniform` | Scheduler name |
| `COMFY_TIMEOUT_MS` | `120000` | Overall timeout (ms) |
| `COMFY_UPSCALE` | unset | If set, adds RealESRGAN upscale branch |
| `COMFY_MONITOR` | unset | If set, attempt to enable Crystools system monitor & log first event |
| `COMFY_MONITOR_STRICT` | unset | With monitor enabled, fail (exit 5) if no events received |

Exit codes: 0 success, 1 import failure, 2 timeout, 3 enqueue failure, 4 other error, 5 monitor strict failure.

### Rationale

Ensures the published `dist` is coherent and functional in a clean consumer environment; can later be wired into CI behind an opt‑in flag (e.g. `E2E_PUBLISHED=1`).

### Future

Possible enhancement: GitHub Action that spins up a ComfyUI container, runs the smoke test, and archives generated images as artifacts.

## Contributing

Issues and PRs welcome. Please include focused changes and tests where sensible. Adhere to existing coding style and keep feature surfaces minimal & cohesive.

## License

MIT – see `LICENSE`.
