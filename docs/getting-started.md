# Getting Started

Complete guide to installing and running your first ComfyUI workflow with the SDK.

## Installation

Requires Node.js >= 22 (modern WebSocket + fetch + ES2023 features). Works with Bun as well.

```bash
npm install comfyui-node
# or
pnpm add comfyui-node
# or
bun add comfyui-node
```

TypeScript types are bundled; no extra install needed.

## Quick Start

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
```

## Cheat Sheet

Fast reference for common operations. See [Workflow Guide](./workflow-guide.md) and [API Features](./api-features.md) for detailed explanations.

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

## Core Concepts

### 1. ComfyApi Client

The main client for connecting to ComfyUI servers:

```ts
const api = new ComfyApi('http://127.0.0.1:8188', {
  // Optional configuration
  credentials: { type: 'basic', username: 'user', password: 'pass' },
  wsTimeout: 60000  // WebSocket inactivity timeout (ms)
});

await api.ready();  // Wait for connection + feature probing
```

### 2. Workflow vs PromptBuilder

**Use `Workflow`** when:
- You have an existing JSON workflow from ComfyUI
- You want to tweak parameters (prompts, steps, seeds)
- You need quick parameter changes

**Use `PromptBuilder`** when:
- You're building graphs programmatically
- You need validation (missing mappings, cycles)
- You need to serialize/deserialize builder state

See [Workflow Guide](./workflow-guide.md#choosing-workflow-vs-promptbuilder) for detailed comparison.

### 3. WorkflowJob Lifecycle

When you run a workflow, you get a `WorkflowJob` object:

```ts
const job = await api.run(wf);

// Listen to events
job.on('start', () => console.log('Started!'));
job.on('progress_pct', p => console.log(`${p}%`));
job.on('preview', ev => console.log('Preview:', ev.filename));
job.on('output', ev => console.log('Output node:', ev.nodeId));

// Wait for completion
const result = await job.done();
// or simply: await job
```

### 4. Result Object

The final result includes:

```ts
{
  images: { images: [...] },      // Your declared outputs
  _promptId: '12345',              // ComfyUI prompt ID
  _nodes: ['9'],                   // Nodes that produced output
  _aliases: { images: '9' },       // Alias mappings
  _autoSeeds: { '3': 1234567 }     // Random seeds substituted
}
```

See [Workflow Guide](./workflow-guide.md#result-object-anatomy) for details.

## Next Steps

- **[Workflow Guide](./workflow-guide.md)** – In-depth tutorial on the high-level Workflow API
- **[PromptBuilder](./prompt-builder.md)** – Lower-level graph construction
- **[Multi-Instance Pooling](./workflow-pool.md)** – WorkflowPool and ComfyPool for managing multiple servers
- **[API Features](./api-features.md)** – Modular features (`api.ext.*`)
- **[Advanced Usage](./advanced-usage.md)** – Authentication, events, custom nodes, image attachments
- **[Troubleshooting](./troubleshooting.md)** – Common issues and diagnostics
