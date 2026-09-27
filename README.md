# ComfyUI SDK

[![NPM Version](https://img.shields.io/npm/v/comfyui-node?style=flat-square)](https://www.npmjs.com/package/comfyui-node)
[![License](https://img.shields.io/npm/l/comfyui-node?style=flat-square)](https://github.com/igorls/comfyui-node/blob/main/LICENSE)
![CI](https://github.com/igorls/comfyui-node/actions/workflows/ci.yml/badge.svg)
![Type Coverage](https://img.shields.io/badge/type--coverage-95%25-brightgreen?style=flat-square)
![Node Version](https://img.shields.io/badge/node-%3E%3D22-brightgreen?style=flat-square)

TypeScript SDK for interacting with the [ComfyUI](https://github.com/comfyanonymous/ComfyUI) API – focused on workflow construction, prompt execution orchestration, multi-instance scheduling and extension integration. It also ships a local [MCP](https://modelcontextprotocol.io) server, so coding agents such as Claude Code, Codex and Cursor can build, run and review ComfyUI workflows.

## Features

- Fully typed TypeScript surface with progressive output typing
- High-level `Workflow` API – tweak existing JSON workflows with minimal boilerplate
- Low-level `PromptBuilder` – programmatic graph construction with validation
- WebSocket events – progress, preview, output, completion with reconnection
- Multi-instance pooling – `WorkflowPool` with smart failover & health checks (v1.4.1+)
- Modular features – `api.ext.*` namespaces (queue, history, system, file, etc.)
- Authentication – basic, bearer token, custom headers
- Image attachments – upload files directly with workflow submissions
- Preview metadata – rich preview frames with metadata support
- Auto seed substitution – `seed: -1` randomized automatically
- API node support – compatible with custom/paid API nodes (Comfy.org)
- Bundled MCP server – `npx -y comfyui-node` gives coding agents nine tools to discover nodes, build and validate workflows, generate, and review results (v1.11+)

## Installation

Requires Node.js >= 22. Works with Bun.

```bash
npm install comfyui-node
```

## Quick Start

```ts
import { ComfyApi, Workflow } from 'comfyui-node';
import BaseWorkflow from './example-txt2img-workflow.json';

const api = await new ComfyApi('http://127.0.0.1:8188').ready();

const wf = Workflow.from(BaseWorkflow)
  .set('6.inputs.text', 'A dramatic cinematic landscape')
  .output('images:9');

const job = await api.run(wf, { autoDestroy: true });
job.on('progress_pct', p => console.log(`${p}%`));

const result = await job.done();
for (const img of (result.images?.images || [])) {
  console.log(api.ext.file.getPathImage(img));
}
```

## MCP Server for Coding Agents

The package includes a [Model Context Protocol](https://modelcontextprotocol.io) server that runs over stdio next to your local ComfyUI. Agents can inspect your installed nodes and models, scaffold or validate a workflow, run it with prompt/seed/size overrides, look at the results (contact sheets, crops, before/after comparisons) and iterate, all without hand-editing graph JSON. It talks only to the ComfyUI URL you give it.

**Claude Code**

```bash
claude mcp add comfyui -- npx -y comfyui-node --url http://127.0.0.1:8188 --workflow-dir /path/to/workflows
```

On native Windows, wrap the command: `claude mcp add comfyui -- cmd /c npx -y comfyui-node …`.

**Codex** (`~/.codex/config.toml`)

```toml
[mcp_servers.comfyui]
command = "npx"
args = ["-y", "comfyui-node", "--url", "http://127.0.0.1:8188", "--workflow-dir", "/path/to/workflows"]
```

**Cursor** (`.cursor/mcp.json`) and **Claude Desktop** (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "comfyui": {
      "command": "npx",
      "args": ["-y", "comfyui-node", "--url", "http://127.0.0.1:8188", "--workflow-dir", "/path/to/workflows"]
    }
  }
}
```

`bunx comfyui-node` works in place of `npx -y comfyui-node`. Options:

| Option | Default | Purpose |
| --- | --- | --- |
| `--url <url>` | `COMFYUI_URL` or `http://127.0.0.1:8188` | ComfyUI server to drive |
| `--workflow-dir <dir>` | `COMFYUI_WORKFLOW_DIR`, else `./workflows` and `./test` | Folder of API-format workflows (repeatable); optional `<name>.sidecar.json` files name editable slots |
| `--debug` | off | Diagnostic logs on stderr |

The server exits when the agent closes it. Tools:

| Tool | What it does |
| --- | --- |
| `comfy_info` | Server reachability, GPU/RAM, queue, installed models, and runnable recipes |
| `comfy_nodes` | Search installed nodes and read exact input/output pin schemas |
| `comfy_recipes` | List known model recipes and scaffold a ready-to-run graph for installed models |
| `comfy_validate` | Check a graph's wiring and types against the live node definitions |
| `comfy_workflows` | List, save, and delete stored workflows with their editable slots |
| `comfy_generate` | Run a stored or raw workflow with overrides, candidate count, seed policy, and attachments |
| `comfy_inspect` | Review results as a contact sheet, a single image, a crop, or a parent/child comparison |
| `comfy_revise` | Branch a new run from a previous one with targeted changes, keeping lineage |
| `comfy_job` | Check, wait on, or cancel a run |

See the **[AI Agent Guide](./docs/agent-workflow-guide.md)** for the full tool reference and workflow tips. To embed the server in your own process, import from `comfyui-node/mcp` (`createComfyMcpServer`, `startComfyMcpStdioServer`).

## Documentation

### Getting Started

- **[Getting Started Guide](./docs/getting-started.md)** – Installation, quick start, core concepts, cheat sheet
- **[Workflow Guide](./docs/workflow-guide.md)** – Complete high-level Workflow API tutorial with progressive typing
- **[PromptBuilder Guide](./docs/prompt-builder.md)** – Lower-level graph construction, validation, serialization

### Multi-Instance Pooling

- **[WorkflowPool Documentation](./docs/workflow-pool.md)** – Production-ready pooling with health checks, profiling, and timeout protection
- **[Event-Based Logging](./docs/logging.md)** – Guide to the new event-based logging system (v1.6.7+)
- **[Connection Stability Guide](./docs/websocket-idle-issue.md)** – WebSocket health check implementation details
- **[Hash-Based Routing Guide](./docs/hash-routing-guide.md)** – Workflow-level failure tracking and intelligent failover
- **[Profiling Guide](./docs/profiling.md)** – Automatic per-node performance profiling (v1.5.0+)
- **[Execution Timeout Guide](./docs/execution-timeout.md)** – Timeout protection for stuck servers and nodes (v1.5.0+)

### Advanced Features

- **[Advanced Usage](./docs/advanced-usage.md)** – Authentication, events, preview metadata, API nodes, image attachments
- **[API Features](./docs/api-features.md)** – Modular `api.ext.*` namespaces (queue, file, system, etc.)

### Model Context Protocol (MCP) Server

- **[AI Agent Guide](./docs/agent-workflow-guide.md)** – Complete guide for AI coding agents to discover, build, validate, manage, and execute ComfyUI workflows over stdio MCP
- **[MCP Server Plan & Spec](./docs/mcp-server-plan.md)** – Design document and architecture for the bundled MCP server

### Help & Migration

- **[Troubleshooting](./docs/troubleshooting.md)** – Common issues, error types, testing, diagnostics
- **[Migration Guide](./docs/migration-guide.md)** – Upgrading from <1.0 to 1.0+ with complete API mappings

## Key Concepts

### Workflow vs PromptBuilder

**Use `Workflow`** for tweaking existing JSON workflows:

```ts
const wf = Workflow.from(baseJson)
  .set('3.inputs.steps', 20)
  .input('SAMPLER', 'cfg', 4)
  .output('images:9');
```

**Use `PromptBuilder`** for programmatic graph construction:

```ts
const builder = new PromptBuilder(base, ['positive', 'seed'], ['images'])
  .setInputNode('positive', '6.inputs.text')
  .validateOutputMappings();
```

See [comparison guide](./docs/workflow-guide.md#choosing-workflow-vs-promptbuilder) for details.

### WorkflowPool

Production-ready multi-instance scheduling with automatic health checks and intelligent hash-based routing:

```ts
import { WorkflowPool, MemoryQueueAdapter, SmartFailoverStrategy } from "comfyui-node";

const pool = new WorkflowPool([
  new ComfyApi("http://localhost:8188"),
  new ComfyApi("http://localhost:8189")
], {
  failoverStrategy: new SmartFailoverStrategy({
    cooldownMs: 60_000,           // Block workflow for 60s after failure
    maxFailuresBeforeBlock: 1     // Block on first failure
  }),
  healthCheckIntervalMs: 30000, // keeps connections alive
  enableProfiling: true,        // NEW: enable automatic performance profiling
  executionStartTimeoutMs: 5000 // NEW: 5s timeout for execution to start
});

// Monitor job completion and view profiling stats
pool.on("job:completed", ev => {
  if (ev.detail.job.profileStats) {
    const { totalDuration, executionTime, summary } = ev.detail.job.profileStats;
    console.log(`Job ${ev.detail.job.jobId} completed in ${totalDuration}ms`);
    console.log(`Slowest nodes:`, summary.slowestNodes);
  }
});

const jobId = await pool.enqueue(workflow, { priority: 10 });
```

Hash-based routing intelligently handles failures at the workflow level (not client level). When a workflow fails on one client, the pool routes it to others while keeping that client available for different workflows.

See [Hash-Based Routing Guide](./docs/hash-routing-guide.md) for details and demos.

### Advanced: `MultiWorkflowPool` for Heterogeneous Clusters

For complex use cases involving a heterogeneous cluster of workers (e.g., some with SDXL models, others for video generation), `MultiWorkflowPool` provides fine-grained control over job routing based on workflow requirements.

It uses an event-driven architecture to manage clients with specific **workflow affinities**, ensuring that jobs are only sent to nodes capable of processing them.

- **Workflow Affinity:** Assign clients to specific workflows. Jobs are automatically routed to the correct client.
- **Dynamic Job Queues:** A separate job queue is created for each workflow type, preventing head-of-line blocking.
- **Event-Driven Architecture:** Zero polling for maximum efficiency and responsiveness.
- **Built-in Monitoring:** Optional real-time monitoring of client and queue states.

**Example:**
```ts
import { MultiWorkflowPool, Workflow } from "comfyui-node";
import SdxlWorkflow from './sdxl-workflow.json';
import VideoWorkflow from './video-workflow.json';

// 1. Define workflows and generate their hash for affinity mapping
const sdxlWF = Workflow.from(SdxlWorkflow).updateHash();
const videoWF = Workflow.from(VideoWorkflow).updateHash();

// 2. Create a new pool
const pool = new MultiWorkflowPool({
  logLevel: "info",
  enableMonitoring: true,
});

// 3. Add clients with workflow affinity
// This client is specialized for SDXL workflows
pool.addClient("http://localhost:8188", { workflowAffinity: [sdxlWF] });

// This client is specialized for Video workflows
pool.addClient("http://localhost:8189", { workflowAffinity: [videoWF] });

// This client is a general-purpose worker
pool.addClient("http://localhost:8190");

// 4. Initialize the pool (connects to all clients)
await pool.init();

// 5. Submit jobs
// The pool automatically routes them to the correct client
const sdxlJobId = await pool.submitJob(sdxlWF);
const videoJobId = await pool.submitJob(videoWF);

// 6. Wait for a job to complete
const results = await pool.waitForJobCompletion(sdxlJobId);
console.log("SDXL Job completed!", results.images);
```

#### Same render, different model per host (`submitToVariants`)

When one *logical* render needs a different graph per host — e.g. the same image
compiled for different GPUs or model quantizations (an `nvfp4` build on one card,
an `int8` build on another) — the variants reference different model files, so
they have different structure hashes and are, to the pool, different workflows.
Register each host's variant, then submit them together with `submitToVariants`:
the pool runs the variant whose host is idle right now, or (if none are idle)
enqueues one so it runs when a capable host frees. Submitting many logical jobs
spreads them across the heterogeneous pool.

```ts
const kreaNvfp4 = Workflow.from(graphNvfp4).updateHash(); // Blackwell filenames
const kreaInt8  = Workflow.from(graphInt8).updateHash();  // Ampere filenames

pool.addClient("http://blackwell:8188", { workflowAffinity: [kreaNvfp4] });
pool.addClient("http://ampere:8188",    { workflowAffinity: [kreaInt8] });
await pool.init();

// Runs on whichever host is free, using that host's own variant.
const jobId = await pool.submitToVariants([kreaNvfp4, kreaInt8]);
const results = await pool.waitForJobCompletion(jobId);
```

> Note: the structure hash covers topology, node types and **model references**
> (checkpoints, LoRAs, VAEs), but not prompts, seeds or dimensions — so the same
> graph with a different prompt routes to the same affinity group, while a
> different model is treated as a different capability.

## What's New

- **v1.11** – Bundled MCP server for coding agents (see [above](#mcp-server-for-coding-agents)). 1.11.1 makes the server exit when its host closes it and report its real version.
- **v1.10.1** – The event WebSocket now recovers from every ComfyUI restart, not just the first, and detects connections that silently died (unanswered heartbeat pings).
- **v1.10** – `MultiWorkflowPool.submitToVariants()` for heterogeneous clusters, per-job `maxAttempts`, bounded job-state retention, and a structural workflow hash.

See [CHANGELOG.md](./CHANGELOG.md) for complete release notes.

## Examples

Check the `scripts/` directory for comprehensive examples:

- **Basic workflows:** `workflow-tutorial-basic.ts`, `test-simple-txt2img.ts`
- **Image editing:** `qwen-image-edit-demo.ts`, `qwen-image-edit-queue.ts`
- **Pooling:** `workflow-pool-demo.ts`, `workflow-pool-debug.ts`
- **Node bypass:** `demo-node-bypass.ts`, `demo-workflow-bypass.ts`
- **API nodes:** `api-node-image-edit.ts` (Comfy.org paid nodes)
- **Image loading:** `image-loading-demo.ts`

Live demo: `demos/recursive-edit/` – recursive image editing server + web client.

## API Reference

### ComfyApi Client

```ts
const api = new ComfyApi('http://127.0.0.1:8188', 'optional-id', {
  credentials: { type: 'basic', username: 'user', password: 'pass' },
  wsTimeout: 60000,
  comfyOrgApiKey: process.env.COMFY_ORG_API_KEY,
  debug: true
});

await api.ready();  // Connection + feature probing
```

### Modular Features (`api.ext`)

```ts
await api.ext.queue.queuePrompt(null, workflow);
await api.ext.queue.interrupt();
const stats = await api.ext.system.getSystemStats();
const checkpoints = await api.ext.node.getCheckpoints();
await api.ext.file.uploadImage(buffer, 'image.png');
const history = await api.ext.history.getHistory('prompt-id');
```

See [API Features docs](./docs/api-features.md) for complete namespace reference.

### Events

```ts
api.on('progress', ev => console.log(ev.detail.value, '/', ev.detail.max));
api.on('b_preview', ev => console.log('Preview:', ev.detail.size));
api.on('executed', ev => console.log('Node:', ev.detail.node));

job.on('progress_pct', pct => console.log(`${pct}%`));
job.on('preview', blob => console.log('Preview:', blob.size));
job.on('failed', err => console.error(err));
```

## Testing

### Unit and Integration Tests

```bash
bun test                        # Unit + integration tests
bun run test:integration        # Run all integration tests
bun run test:integration:simple # Run simple reconnection examples
bun run test:real               # Real server tests (COMFY_REAL=1)
bun run test:full               # Comprehensive tests (COMFY_FULL=1)
bun run coverage                # Coverage report
```

### Integration Tests (v1.6.5+)

The library includes a comprehensive integration test infrastructure that spawns real mock server processes to test reconnection behavior:

```bash
# Run all integration tests
bun test test/integration/

# Run simple examples (recommended first)
bun run test:integration:simple

# Validate the mock server infrastructure
bun test/integration/validate-mock-server.ts

# Debug: Run mock server standalone
bun test/integration/mock-server.ts 8191
```

**What's Tested:**
- Manual and automatic reconnection after server crashes
- Connection state transitions (connecting → connected → disconnected → reconnecting)
- Event emission (`reconnected`, `reconnection_failed`)
- Multiple server restart cycles
- WebSocket message handling across reconnections

**Documentation:**
- `test/integration/README.md` – Comprehensive guide
- `test/integration/QUICKSTART.md` – Developer quick-start with patterns
- `test/integration/SUMMARY.md` – Architecture overview

**Example:**
```ts
// Integration test pattern
const manager = new ServerManager({ port: 8191 });
await manager.startServer(8191);

const api = new ComfyApi("http://localhost:8191");
await initializeClient(api);

// Kill server to simulate crash
await manager.killServer(8191);
await sleep(500);

// Restart server
await manager.startServer(8191);

// Verify reconnection
await api.reconnectWs(true);
await waitForConnection(api);
expect(api.isConnected()).toBe(true);

// Cleanup
api.destroy();
await manager.killAll();
```

See [Troubleshooting docs](./docs/troubleshooting.md#testing--coverage) for details.

## Contributing

Issues and PRs welcome! Please:

- Include tests for new features
- Follow existing code style
- Keep feature surfaces minimal & cohesive
- Run `bun test && bun run coverage` before submitting

## License

MIT – see [LICENSE](./LICENSE)

## Links

- **npm:** [comfyui-node](https://www.npmjs.com/package/comfyui-node)
- **GitHub:** [igorls/comfyui-node](https://github.com/igorls/comfyui-node)
- **ComfyUI:** [comfyanonymous/ComfyUI](https://github.com/comfyanonymous/ComfyUI)
