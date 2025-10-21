# Workflow Guide

Complete guide to using the high-level `Workflow` API for running ComfyUI workflows.

## Table of Contents

- [Overview](#overview)
- [Complete Tutorial](#complete-tutorial)
- [Recent Enhancements](#recent-enhancements)
- [Output Declaration & Typing](#output-declaration--typing)
- [Choosing: Workflow vs PromptBuilder](#choosing-workflow-vs-promptbuilder)
- [Result Object Anatomy](#result-object-anatomy)

## Overview

The `Workflow` API is the recommended high-level interface for:

- Tweaking existing ComfyUI workflow JSONs
- Quick parameter changes (prompts, seeds, steps, cfg)
- Progressive output typing with IDE support
- Automatic seed randomization
- Minimal boilerplate

**When to use Workflow:**
- You have a working JSON workflow from ComfyUI
- You need to adjust parameters without rebuilding the graph
- You want progressive TypeScript types from `.output()` declarations

**When to use PromptBuilder instead:** See [comparison section](#choosing-workflow-vs-promptbuilder).

## Complete Tutorial

### 1. Prepare a Base Workflow JSON

Export or copy a working ComfyUI txt2img graph (e.g. `test/example-txt2img-workflow.json`). Ensure you know the node ID of the final `SaveImage` node (e.g. `9`).

### 2. Initialize the API

```ts
import { ComfyApi } from 'comfyui-node';

const api = await new ComfyApi('http://127.0.0.1:8188').ready();
// or use environment variable:
// const api = await new ComfyApi(process.env.COMFY_HOST || 'http://127.0.0.1:8188').ready();
```

`api.ready()` handles connection & feature probing. It is idempotent (can be safely called multiple times).

### 3. Mutate Parameters & Declare Outputs

```ts
import { Workflow } from 'comfyui-node';
import BaseWorkflow from './example-txt2img-workflow.json';

const wf = Workflow.from(BaseWorkflow)
  .set('4.inputs.ckpt_name', 'SDXL/realvisxlV40_v40LightningBakedvae.safetensors')
  .set('6.inputs.text', 'A dramatic cinematic landscape, volumetric light')
  .set('7.inputs.text', 'text, watermark')  // negative prompt
  .set('3.inputs.seed', Math.floor(Math.random() * 10_000_000))
  .set('3.inputs.steps', 8)
  .set('3.inputs.cfg', 2)
  .set('3.inputs.sampler_name', 'dpmpp_sde')
  .set('3.inputs.scheduler', 'sgm_uniform')
  .set('5.inputs.width', 1024)
  .set('5.inputs.height', 1024)
  .output('images:9'); // alias 'images' -> node 9
```

**Path format:** `'<nodeId>.inputs.<field>'`

**Output format:** 
- `'alias:NodeId'` - collect node output under friendly alias
- `'NodeId'` - key equals node ID  
- If you omit all outputs, SDK auto-collects all `SaveImage` nodes

**Auto seed:** If any node has `seed: -1`, the SDK replaces it with a random 32-bit integer before submission and exposes the mapping in `result._autoSeeds`.

### 4. Run & Observe Progress

```ts
const job = await api.run(wf, { autoDestroy: true });

job
  .on('pending', id => console.log('[queue]', id))
  .on('start', id => console.log('[start]', id))
  .on('progress_pct', pct => process.stdout.write(`\rprogress ${pct}%   `))
  .on('preview', blob => console.log('\npreview frame bytes=', blob.size))
  .on('failed', err => console.error('\nerror', err));

const result = await job.done(); // or simply: await job
```

The returned `WorkflowJob` is both an EventEmitter and a Promise.

**Key options:**
- `autoDestroy: true` - Automatically closes connections after completion/failure

### 5. Extract Image Paths

```ts
console.log('Prompt ID:', result._promptId);
for (const img of (result.images?.images || [])) {
  console.log('image path:', api.ext.file.getPathImage(img));
}
```

### Event Cheat Sheet (WorkflowJob)

| Event | Payload | Description |
| ----- | ------- | ----------- |
| `pending` | promptId | Enqueued, waiting to start |
| `start` | promptId | Execution began |
| `progress` | `{ value, max }` | Low-level progress data |
| `progress_pct` | number (0-100) | Deduped integer percentage |
| `preview` | `Blob` | Live image preview frame |
| `output` | nodeId | Partial node output arrived |
| `finished` | final object | All outputs resolved |
| `failed` | `Error` | Execution failed/interrupted |

## Recent Enhancements

The `Workflow` API has gained several quality-of-life helpers and **progressive typing** features. All are additive (no breaking changes) and optional.

| Feature | Purpose | Example | Type Effect |
| ------- | ------- | ------- | ----------- |
| `wf.input(nodeId, inputName, value)` | Concise single input mutation | `wf.input('SAMPLER','steps',30)` | none (runtime sugar) |
| `wf.batchInputs(nodeId, {...})` | Set multiple inputs on one node | `wf.batchInputs('SAMPLER',{steps:30,cfg:5})` | none |
| `wf.batchInputs({...})` | Multi-node batch mutation | `wf.batchInputs({SAMPLER:{cfg:6}})` | none |
| `Workflow.fromAugmented(json)` | Soft autocomplete for sampler/scheduler | `Workflow.fromAugmented(base)` | narrows to union \| (string & {}) |
| Typed output inference | `.output()` accumulates object keys | `wf.output('images:SAVE')` | widens result shape |
| Per-node output shapes | Heuristic shapes for `SaveImage*`, `KSampler` | `result.images.images` | structural hints |
| Multiple output syntaxes | Choose preferred style | `'alias:NodeId'` / `('alias','NodeId')` / `'NodeId'` | identical effect |
| `wf.typedResult()` | Get IDE type of final result | `type R = ReturnType<typeof wf.typedResult>` | captures generic |
| Auto seed substitution | `seed: -1` randomized before submit | `wf.input('SAMPLER','seed',-1)` | adds `_autoSeeds` |

### Input Helpers

```ts
const wf = Workflow.fromAugmented(baseJson)
  .input('LOADER', 'ckpt_name', 'model.safetensors')
  .batchInputs('SAMPLER', {
    steps: 30,
    cfg: 4,
    sampler_name: 'euler_ancestral', // autocomplete + accepts future strings
    scheduler: 'karras',
    seed: -1  // auto-randomized before submit
  })
  .batchInputs({
    CLIP_TEXT_ENCODE_POSITIVE: { text: 'A moody cinematic landscape' },
    LATENT_IMAGE: { width: 896, height: 1152 }
  });
```

## Output Declaration & Typing

Each `.output()` call accumulates inferred keys:

```ts
const wf2 = Workflow.fromAugmented(baseJson)
  .output('gallery:SAVE_IMAGE')       // key 'gallery'
  .output('KSamplerNode')             // key 'KSamplerNode'
  .output('thumb', 'THUMBNAIL_NODE'); // key 'thumb'

// Type exploration (IDE only):
type Wf2Result = ReturnType<typeof wf2.typedResult>;
// Wf2Result ~ {
//   gallery: { images?: any[] };      // SaveImage heuristic
//   KSamplerNode: { samples?: any };  // KSampler heuristic  
//   thumb: any;                       // THUMBNAIL_NODE not mapped
//   _promptId?: string; _nodes?: string[]; _aliases?: Record<string,string>; _autoSeeds?: Record<string,number>;
// }

const job = await api.run(wf2);
const final = await job.done();
final.gallery.images?.forEach(img => console.log(api.ext.file.getPathImage(img)));
```

### Supported Output Forms

All equivalent semantically – choose your style:

```ts
wf.output('alias:NodeId');
wf.output('alias', 'NodeId');
wf.output('NodeId'); // key = node ID
```

If you declare no outputs, the SDK auto-collects all `SaveImage` nodes.

### Per-Node Output Shapes (Heuristics)

Currently recognized:

| class_type match | Inferred shape |
| ---------------- | -------------- |
| `SaveImage`, `SaveImageAdvanced` | `{ images?: any[] }` |
| `KSampler` | `{ samples?: any }` |

All others typed as `any` (you still get alias key inference). This table will expand; contributions welcome.

### Extracting a Stable Result Type

Export types for downstream modules:

```ts
export type MyGenerationResult = ReturnType<typeof wf.typedResult>;
```

This stays accurate as long as all `.output()` calls run before the type is captured.

### When to Use `Workflow.fromAugmented`

Use when you want IDE suggestions for sampler/scheduler without losing forward compatibility. Widened types (`TSamplerName | (string & {})`) accept any new upstream values.

## Choosing: Workflow vs PromptBuilder

| Criterion | Prefer Workflow | Prefer PromptBuilder |
| --------- | --------------- | -------------------- |
| **Starting point** | Existing JSON workflow | Programmatic node assembly |
| **Change pattern** | Tweak numeric/text inputs | Add/remove/rewire nodes |
| **Output declaration** | Simple image node aliases | Complex multi-node mapping |
| **Validation needs** | Light (auto-collect SaveImage) | Strong: explicit mapping + cycle checks |
| **Type ergonomics** | Progressive result typing via `.output()` | Fully explicit generic parameters |
| **Autocomplete** | Sampler/scheduler (augmented mode) | Input/output alias keys |
| **Serialization** | Not needed / reuse base JSON | Need to persist builder state |
| **Scheduling** | Direct `api.run(wf)` | Usually wrapped in `CallWrapper` |
| **Learning curve** | Minimal (few fluent methods) | Slightly higher (mapping required) |
| **Migration path** | Can drop to builder if needed | Can export JSON & wrap with Workflow |

**Rule of thumb:** Start with `Workflow`. Move to `PromptBuilder` when you need structural graph edits or stronger pre-submit validation.

See [PromptBuilder Guide](./prompt-builder.md) for lower-level details.

## Result Object Anatomy

All high-level executions resolve to an object merging:

1. Declared/inferred output aliases (each key is the raw node output JSON)
2. Heuristic shape hints (currently only `SaveImage*` & `KSampler` nodes)
3. Metadata fields: `_promptId`, `_nodes`, `_aliases`, `_autoSeeds`

### Conceptual Shape

```ts
type WorkflowResult = {
  // Your keys:
  [aliasOrNodeId: string]: any; // heuristically narrowed
  
  // Metadata:
  _promptId?: string;
  _nodes?: string[];                  // collected node IDs
  _aliases?: Record<string, string>;  // nodeId -> alias
  _autoSeeds?: Record<string, number>; // nodeId -> randomized seed (when -1 used)
};
```

### Example with Heuristics

```ts
const wf = Workflow.fromAugmented(json)
  .output('gallery:SAVE_IMAGE')
  .output('sampler:KSampler');

type R = ReturnType<typeof wf.typedResult>; 
// => { 
//   gallery: { images?: any[] }; 
//   sampler: { samples?: any }; 
//   _promptId?: string; 
//   ... 
// }
```

Heuristics are intentionally shallow – they provide structure for IDE discovery without locking you into specific upstream node versions.

### Access Patterns

```ts
const job = await api.run(wf);
job.on('output', id => console.log('node completed', id));

const res = await job.done();
console.log(res._promptId, Object.keys(res));

for (const img of (res.gallery?.images || [])) {
  console.log(api.ext.file.getPathImage(img));
}
```

### Exporting Stable Types

```ts
export type GenerationResult = ReturnType<typeof wf.typedResult>;
```

Changing outputs later? Re-generate the type after adding new `.output()` calls.

## Execution Flow & Await Semantics

`await api.run(wf)` resolves AFTER the job is accepted (queued) and returns a `WorkflowJob` handle:

```ts
const job = await api.run(wf);  // acceptance barrier -> prompt ID available

job
  .on('progress_pct', pct => console.log('progress', pct))
  .on('preview', blob => console.log('preview frame', blob.size));

const outputs = await job.done(); // final mapped outputs + metadata
```

This two-stage await provides:
- Early feedback (events available immediately after acceptance)
- Linear code for final result consumption

### Auto-Generated Metadata

| Key | Meaning |
| --- | ------- |
| `_promptId` | Server prompt ID assigned |
| `_nodes` | Array of collected node IDs |
| `_aliases` | Mapping nodeId -> alias |
| `_autoSeeds` | Mapping nodeId -> randomized seed (only when -1 used) |

## Next Steps

- **[PromptBuilder Guide](./prompt-builder.md)** – Lower-level graph construction
- **[Advanced Usage](./advanced-usage.md)** – Events, previews, image attachments
- **[API Features](./api-features.md)** – Modular `api.ext.*` namespaces
- **[Troubleshooting](./troubleshooting.md)** – Common issues and diagnostics
