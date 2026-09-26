# Research: an agent-first MCP server for `comfyui-node`

**Date:** 2026-08-24  
**Status:** Research and architectural recommendations; no implementation  
**Primary question:** How can `comfyui-node` become a more efficient, agent-friendly, and flexible MCP server for ComfyUI?

## Executive conclusion

`comfyui-node` should not copy Comfy's first-party MCP server tool-for-tool. It should use that server as the product benchmark, then exploit this repository's differentiator: it already talks directly to ComfyUI through a typed TypeScript client and already owns resilient WebSocket execution, history recovery, uploads, outputs, capability probing, profiling, failover, and heterogeneous multi-instance routing.

The strongest product shape is:

1. A small, stable set of high-level MCP tools for discovery, validation, submission, job control, and artifact retrieval.
2. MCP resources for large or changing data such as installed node definitions, workflow JSON, job records, logs, and generated assets.
3. MCP prompts for user-invoked recipes such as generate, edit, upscale, batch, and diagnose.
4. A durable internal job coordinator that hides ComfyUI's HTTP/WebSocket quirks and supports both direct clients and pools.
5. Optional adapters for emerging MCP features, especially Tasks, without making them the only way to use long-running jobs.

This would be more efficient than a subprocess-per-tool design, more usable than exposing raw ComfyUI endpoints, and more flexible than binding the MCP contract to one ComfyUI host or one workflow format. The performance benefit of the direct in-process path is an architectural opportunity, not yet a measured claim.

## What Comfy's official MCP establishes

The marketing page promises generation across images, video, audio, and 3D; ecosystem search; real workflow submission; batches; reusable workflows; and local or cloud execution. It emphasizes that generations remain reproducible workflows rather than opaque one-off model calls ([Comfy MCP overview](https://comfy.org/mcp/)).

The implementation and product documentation reveal a more useful benchmark:

- The official cloud flow is **discover -> run -> wait -> retrieve**. Agents search templates/models/nodes, prefer a matching template, run it or submit raw workflow JSON, wait on a job, then retrieve outputs ([cloud MCP typical flow and tools](https://docs.comfy.org/agent-tools/mcp#what-your-agent-can-do)).
- Cloud exposes template schemas and slot application, custom workflow submission, file upload, job/batch control, saved/versioned/shared workflows, and links back to Canvas or App Mode ([cloud MCP tool catalog](https://docs.comfy.org/agent-tools/mcp#cloud-mcp-tools)).
- The first-party local server is open source, runs over stdio, and wraps `comfy-cli`. It has 40 tools covering execution, monitoring, discovery, validation, workflow editing, downloads, and local ComfyUI lifecycle management ([official `comfy-mcp` README](https://github.com/Comfy-Org/comfy-mcp/blob/main/README.md)).
- The local server's agent path is `server_info -> run_workflow -> fetch_outputs`; async submission returns a `prompt_id`, while job tools poll, wait, watch, cancel, and diagnose ([local MCP tools](https://docs.comfy.org/agent-tools/mcp#tools)).
- Live local discovery is a first-class differentiator: it sees the actual core nodes, custom nodes, models, and LoRAs installed on the target machine, and validates workflows against that live environment ([local MCP connection](https://docs.comfy.org/agent-tools/mcp#local-comfy-mcp-connection)).

The official product also exposes useful limitations to improve upon:

- Cloud output retrieval currently returns a signed URL plus a shell command, so clients without filesystem/shell access have a weaker artifact experience.
- Complex graph construction still depends on agent accuracy.
- Submitted outputs may not retain enough workflow metadata to reopen the originating graph.
- Client-dependent upload limits and OAuth support affect interoperability.

These limitations are explicitly documented by Comfy ([uploads, downloads, and known limitations](https://docs.comfy.org/agent-tools/mcp#uploads-and-downloads)).

## ComfyUI constraints the MCP layer must hide

### Execution is asynchronous and split across protocols

ComfyUI validates and queues an entire API-format graph through `POST /prompt`, returning a `prompt_id` and queue number or validation errors. `/ws` then emits execution and queue events; `/history/{prompt_id}` supplies durable completed outputs; `/view` retrieves artifacts. The server also exposes node definitions, models, features, system stats, uploads, queue control, interruption, and memory release ([ComfyUI server routes](https://docs.comfy.org/development/comfyui-server/comms_routes)).

Important correctness details:

- Every JSON execution event that has a `prompt_id` must be correlated to the correct job.
- `executed` is not a generic "node completed" event; it is emitted only when a node returns a UI update.
- `executing` with `node: null` signals completion in the classic protocol.
- `execution_cached`, `execution_error`, `execution_interrupted`, and recovery through history all matter to the terminal result.
- Binary WebSocket frames can carry previews.

The official message reference documents these semantics ([ComfyUI WebSocket messages](https://docs.comfy.org/development/comfyui-server/comms_messages)). Agents should never need to reason about them directly.

### A queued graph is a snapshot

ComfyUI receives the whole workflow when it is queued; subsequent editor changes do not alter that run ([server overview](https://docs.comfy.org/development/comfyui-server/comms_overview)). Therefore every MCP submission result should identify the exact normalized graph revision/hash, applied overrides, chosen seed, target server, and output selection.

### There are two workflow representations

Executable **API format** is a node-ID-keyed graph whose nodes contain `class_type` and `inputs`. Editor Workflow JSON is a versioned schema that also carries canvas/layout/state data. Comfy's official local MCP accepts API format or a UI export, but conversion and validation remain distinct concerns ([ComfyUI API examples](https://docs.comfy.org/development/comfyui-server/api-examples), [Workflow JSON schema](https://docs.comfy.org/specs/workflow_json), [official local MCP README](https://github.com/Comfy-Org/comfy-mcp/blob/main/README.md)).

The server should therefore:

- Detect the format explicitly rather than guessing after a failed run.
- Retain editor JSON for round-trip reproducibility when supplied.
- Convert to a normalized API graph before validation/submission.
- Return an actionable unsupported-format or conversion error when safe conversion is unavailable.

### Node schemas are live, large, and extensible

`/object_info` reports the target installation's real core and custom node classes and their inputs/options. Current ComfyUI also defines a versioned Node Definition JSON schema, including typed inputs, defaults, constraints, outputs, descriptions, categories, deprecation, and experimental markers ([Node Definition JSON v2](https://docs.comfy.org/specs/nodedef_json)).

This catalog can be expensive and can change after installing custom nodes or restarting ComfyUI. It should be indexed and cached per target identity/capability fingerprint, then invalidated on reconnect, version change, or explicit refresh. Do **not** turn every installed ComfyUI node into an MCP tool: thousands of dynamic tools would inflate discovery context, destabilize prompt caching, and make tool choice worse. Instead expose `search_nodes`, `get_node`, graph queries, and validation over the live catalog.

## What this repository already provides

The proposed MCP layer can stay thin because the repository already contains most of the difficult ComfyUI integration work:

| Existing capability | Local evidence | MCP consequence |
| --- | --- | --- |
| Typed client, basic/bearer/custom auth, capability probing, WebSocket reconnect | `src/client.ts` | One reusable gateway for local, remote, and cloud-compatible targets |
| Workflow mutation, output aliases, uploads, seed handling, progress, previews, typed completion | `src/workflow.ts` | High-level workflow run tools need little transport logic |
| Cancellation, history recovery, queue-loss handling, structured execution errors | `src/call-wrapper.ts` | Durable MCP jobs can reuse battle-tested completion semantics |
| Live node definitions and model helpers | `src/features/node.ts` | Search/schema/validation can derive from the actual target |
| Modern Jobs API probing, listing, status, cancellation, interruption | `src/features/jobs.ts` | Use modern job endpoints when available and fall back to queue/history |
| Asset listing/upload/content-addressed references | `src/features/assets.ts` | Map outputs and inputs to MCP resources instead of shell commands |
| Health checks, workflow hashing, profiling, priority, retry, and smart failover | `src/pool/WorkflowPool.ts` | MCP can offer reliable multi-GPU scheduling without exposing topology |
| Affinity routing, workflow variants, progress and preview listeners | `src/multipool/multi-workflow-pool.ts` | One logical workflow can target heterogeneous hosts/models |

There is one critical isolation warning in the current code: classic binary preview frames do not include `prompt_id` and are scoped to a connection (`src/call-wrapper.ts`, preview handling). Metadata-bearing previews are filtered when a `prompt_id` is present, but a multi-tenant MCP server must not assume all previews can be safely demultiplexed. Use an isolated ComfyUI connection per authorization context or per active preview job, or disable unscoped previews in shared mode.

## Recommended MCP product surface

The goal is a paved path with expert escape hatches, not a mirror of every SDK method.

### Tools: actions and mutations

A practical first surface is about 12 focused tools:

| Tool | Purpose | Key output |
| --- | --- | --- |
| `server.describe` | Capabilities, target identity, health, queue/pool summary | Capability fingerprint and supported operations |
| `workflow.search` | Find configured/local templates and saved workflows | Compact ranked matches |
| `workflow.get` | Fetch normalized workflow metadata and exposed slots | Workflow resource link and slot schema |
| `workflow.validate` | Validate format, nodes, types/options, models, and target fit | Structured errors/warnings with repair suggestions |
| `workflow.patch` | Apply typed slot/path/semantic overrides without running | New immutable workflow revision/resource |
| `workflow.run` | Submit one workflow or template asynchronously | Durable job handle immediately |
| `workflow.run_batch` | Submit parameter sets/variants efficiently | Batch handle plus child jobs |
| `node.search` | Search the live node index by text/category/input/output | Compact matches, not full definitions |
| `node.get` | Get one or a few complete live node definitions | Typed definitions and wiring hints |
| `model.search` | Search models available on eligible targets | Model identity, type, host eligibility |
| `job.get` / `job.wait` | Inspect or wait with bounded timeout | Typed state, progress, failure, artifacts |
| `job.cancel` | Cancel a queued/running job with precise scope | Final cancellation disposition |

Exact naming can be refined during implementation, but arguments should remain uniform (`workflow_id`, `job_id`, `target_id`, `artifact_id`, `overrides`) and IDs should be opaque. Each result should include a short human summary and stable `structuredContent`.

Keep a raw expert tool (`workflow.run` with API JSON or a workflow resource URI), but make template/slot execution the preferred path. The official MCP already demonstrates that template-first routing tends to be faster and more reliable for agents ([Comfy MCP typical flow](https://docs.comfy.org/agent-tools/mcp#what-your-agent-can-do)).

### Resources: context and artifacts

MCP resources are URI-addressed, pageable, and optionally subscribable; they can return text or binary data and can be linked from tool results ([MCP resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources)). Recommended URI families:

```text
comfy://servers/{server_id}
comfy://servers/{server_id}/nodes/{class_type}
comfy://workflows/{workflow_id}/revisions/{revision}
comfy://jobs/{job_id}
comfy://jobs/{job_id}/events
comfy://artifacts/{artifact_id}
comfy://profiles/{job_id}
```

Use resource templates for parameterized access. Publish list/resource change notifications when servers reconnect, catalogs refresh, jobs transition, or artifacts become available. Full images, video, audio, and 3D outputs should normally be resource links with MIME type, size, checksum, and provenance; only bounded previews should be inlined.

This avoids the official cloud MCP's shell-download dependency while avoiding huge base64 payloads in ordinary tool results.

### Prompts: user-controlled recipes

MCP prompts are explicitly user-controlled and parameterized, making them a good fit for recipes rather than low-level capabilities ([MCP prompts](https://modelcontextprotocol.io/specification/2025-11-25/server/prompts)). Initial prompts could be:

- `generate-image`
- `edit-image`
- `upscale-image`
- `generate-video`
- `batch-variants`
- `diagnose-workflow`
- `choose-model-for-target`

Prompts should steer the model through discovery -> validation -> submission -> retrieval, but should not hide the underlying tool and resource contracts.

### Tool schemas and errors

MCP tools support JSON Schema inputs, optional output schemas, structured results, inline image/audio, embedded resources, and resource links. Recoverable input/business errors belong in a tool result with `isError: true`, so the model can self-correct; malformed protocol requests remain JSON-RPC errors ([MCP tools and error handling](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)).

Generate schemas from stable domain contracts, not directly from arbitrary node definitions. Node definitions may contain custom types and very large option lists; expose those through resources and targeted `node.get` results. For template runs, compile a bounded schema from declared slots and validate it both at MCP ingress and again against live `object_info` before submission.

## Async jobs, progress, and cancellation

### Stable baseline

The baseline contract should work on ordinary MCP clients without experimental features:

1. `workflow.run` validates and submits, then returns an opaque `job_id` immediately.
2. `job.get` returns normalized state (`queued`, `running`, `completed`, `failed`, `cancelled`, `lost`), target, queue position, current node, monotonic progress, timestamps, failure diagnostics, and artifact links.
3. `job.wait` waits only up to a caller-bounded timeout and returns the current or terminal state.
4. `job.cancel` maps precisely to queue deletion, modern job cancellation, or interruption. It must not interrupt another user's running job.
5. Job resources and optional subscriptions provide durable observation across MCP requests or reconnects.

For a long non-task request, bridge ComfyUI WebSocket progress into rate-limited MCP `notifications/progress` only when the caller supplied a progress token. MCP requires progress to increase monotonically and stop after completion ([MCP progress](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress)).

Distinguish cancellation of the current MCP request from cancellation of the durable ComfyUI job. MCP request cancellation is fire-and-forget and may race with completion; a submitted job should continue unless the contract explicitly says request cancellation also cancels it ([MCP cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation)).

### Optional MCP Tasks

MCP Tasks are a natural conceptual match for Comfy jobs, but they are not a safe mandatory foundation yet. Tasks were experimental in the 2025-11-25 core specification, and the 2026-07-28 release-candidate work moves them into a separately negotiated extension with a changed lifecycle ([MCP 2026-07-28 release candidate](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/), [current Tasks extension](https://tasks.extensions.modelcontextprotocol.io/specification/draft/tasks)).

Implement Tasks as a negotiated adapter over the internal job coordinator. Preserve ordinary job tools and handles for clients that do not advertise the extension. Do not leak MCP session IDs or ComfyUI prompt IDs as the authorization boundary.

## Performance and efficiency

### Eliminate avoidable process and context overhead

The official local MCP shells out to `comfy --where local --json` for every tool call ([official local server architecture](https://github.com/Comfy-Org/comfy-mcp/blob/main/README.md#tools)). `comfyui-node` can call its in-process client, workflow, and pool objects directly. That removes process startup and JSON-envelope layers from the design, though benchmarks are required before claiming a measured latency improvement.

Other concrete efficiency measures:

- Keep the tool list small, deterministic, and stable; put dynamic catalogs behind resources/search.
- Cache `/object_info` by server fingerprint with explicit invalidation and bounded TTL.
- Fetch one node definition through `/object_info/{node_class}` when possible instead of the whole catalog.
- Use cursor pagination and projection/summary modes for nodes, models, jobs, and assets.
- Return resource links instead of base64 media by default.
- Coalesce/rate-limit progress and preview updates.
- Deduplicate uploads and outputs with hashes where the Assets API is supported.
- Preserve workflow structure hashes so pools can reuse affinity/failure/profiling knowledge across prompt variations.
- Submit batches through the pool rather than serial MCP calls, with backpressure and declared concurrency.
- Keep WebSocket connections warm and reuse existing reconnect/history recovery rather than polling each job independently.

The current MCP draft/RC adds cache metadata and emphasizes deterministic lists for caching, but these should be progressive enhancements rather than baseline requirements until client adoption is clear ([2026-07-28 MCP tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), [2026-07-28 MCP resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources)).

## Extensibility architecture

```text
MCP transports (stdio, Streamable HTTP)
              |
MCP tools / resources / prompts / optional Tasks adapter
              |
Policy + authorization + quotas + audit
              |
JobCoordinator ---- ArtifactProvider ---- WorkflowCatalog
              |              |                  |
      ComfyApi / Workflow / Jobs / Assets / live object_info
              |
WorkflowPool or MultiWorkflowPool
              |
Local ComfyUI, remote ComfyUI, heterogeneous GPU fleet
```

Responsibilities:

- **WorkflowCatalog:** detects/converts formats, versions immutable revisions, compiles bounded slot schemas, indexes live nodes/models, validates target compatibility.
- **JobCoordinator:** creates opaque job IDs, maps them to Comfy prompt/pool IDs, normalizes states, bridges events, handles history recovery, retention, cancellation, and idempotency keys.
- **ArtifactProvider:** normalizes output metadata and content, enforces size/type policy, supplies MCP resources or signed/authorized links.
- **TargetRegistry:** represents one client, a homogeneous pool, or a heterogeneous pool behind the same capability contract.
- **Policy layer:** owns authorization scopes, filesystem roots, spend approval, concurrency/VRAM quotas, and audit. Tool descriptions and annotations are UX hints, not enforcement.

Extension points should be explicit registries for workflow sources, target selection, artifact storage, validators, and policy hooks. Avoid letting plugins register arbitrary top-level MCP tools by default; require namespaced tools or resource providers so the core list remains predictable.

## Security and permissions

A ComfyUI workflow is effectively a program executed inside the ComfyUI/custom-node trust domain. Validation can catch missing nodes, incompatible inputs, and policy violations, but cannot make untrusted custom-node code safe. Comfy's own MCP security guidance warns that arbitrary workflows and unsandboxed file tools can cause code execution, data exposure, or resource exhaustion ([official `comfy-mcp` security policy](https://github.com/Comfy-Org/comfy-mcp/blob/main/SECURITY.md)).

Required controls:

- Separate scopes such as `comfy:discover`, `comfy:run`, `comfy:files`, `comfy:manage`, and `comfy:spend`.
- Bind every job, batch, artifact, and resource URI to the authorization context that created or owns it.
- Enforce per-principal concurrency, queue, upload, output, TTL, and GPU/VRAM budgets.
- Allowlist workflow nodes, custom-node packages, remote endpoints, file roots, MIME types, and maximum sizes where the deployment requires it.
- Resolve and validate filesystem paths against configured roots; never accept arbitrary output paths in remote/shared mode.
- Require explicit, per-call approval for paid partner nodes, publishing/sharing, model/custom-node installation, updates, stopping servers, freeing shared GPU memory, and other destructive or externally visible actions.
- Keep credentials in environment/secret providers, redact them from errors/logs, and never forward MCP access tokens to ComfyUI or partner APIs.
- Treat workflow notes, node descriptions, model metadata, and third-party template prose as untrusted data, not agent instructions.
- Audit tool name, principal, target, workflow hash, job ID, outcome, resource usage, and approval decision without logging secret values or unnecessary media.

For stdio, credentials should come from the environment rather than MCP OAuth. For Streamable HTTP, follow MCP's OAuth resource-server model and validate token audience and scopes ([MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)). Streamable HTTP servers must validate `Origin`, bind local-only deployments to loopback, and authenticate exposed connections to prevent DNS-rebinding attacks ([MCP transport security](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#streamable-http)).

The official local MCP's consent posture is a good precedent: paid and destructive actions fail closed, and elicitation asks the user for each exact operation when supported ([official consent model](https://github.com/Comfy-Org/comfy-mcp/blob/main/README.md#confirmation-prompts-on-clients-that-cant-show-them)).

## Compatibility strategy

Support should be capability-driven on both sides:

- **ComfyUI:** probe `/features`, modern Jobs API, Assets API, preview metadata, upload limits, and individual endpoints. Prefer modern APIs but retain queue/history fallbacks.
- **Workflow schemas:** version editor JSON and node-definition parsers; retain unknown extension fields; validate against the target rather than a bundled universal catalog.
- **MCP clients:** baseline stdio and Streamable HTTP; negotiate tools/resources/prompts; expose Tasks and newer caching/schema features only when supported.
- **Protocol versions:** use a maintained MCP SDK's negotiation rather than hand-rolling JSON-RPC. Test at least the broadly deployed 2025-11-25 behavior and the current 2026-07-28 draft/RC compatibility path.
- **Artifacts:** return structured metadata everywhere, resource links where clients support them, and bounded inline previews as a fallback.

Streamable HTTP replaced the older HTTP+SSE transport, and the specification documents a dual-era fallback for older clients ([MCP transports and backwards compatibility](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#backwards-compatibility)). Do not make a new remote server depend only on draft-era behavior.

## Recommended validation experiments before implementation

1. Measure direct in-process submission versus a `comfy-cli` subprocess for cold and warm discovery, validation, submit, and status calls.
2. Measure `/object_info` size/latency on a minimal install and a heavily extended install; validate per-node fetching and cache invalidation.
3. Prove one complete local flow through an MCP inspector: discover template -> validate -> submit -> progress -> image resource -> cancel race.
4. Prove the same MCP contract against one `ComfyApi`, `WorkflowPool`, and `MultiWorkflowPool` target.
5. Exercise API-format and editor-format inputs, preserving enough metadata to reopen or reproduce a run.
6. Test two concurrent principals and verify jobs, history, previews, artifacts, and cancellation cannot cross authorization boundaries.
7. Test stdio plus Streamable HTTP against multiple real clients, including a client without OAuth, resources, Tasks, or elicitation.
8. Stress bounded batches, reconnect/history recovery, slow/stuck jobs, queue loss, and output-size limits.

## Suggested delivery order

1. **Core coordinator and paved path:** target description, live discovery, API-format validation, async run, job status/wait/cancel, artifact resources, stdio.
2. **Agent-grade workflow UX:** templates, declared slots, immutable patching, editor-format conversion, prompts, model/node wiring search.
3. **Fleet and performance:** `WorkflowPool`/`MultiWorkflowPool`, batches, idempotency, catalog caching, profiling resources, backpressure.
4. **Remote/shared server:** Streamable HTTP, OAuth/scopes, tenant isolation, quotas, signed resources, audit.
5. **Progressive protocol features:** negotiated Tasks, resource subscriptions, current draft/RC caching, richer artifact presentation or MCP Apps where clients support them.

## Decision summary

The best strategic position is not "another local Comfy MCP." It is a TypeScript-native ComfyUI execution gateway whose MCP interface is compact, schema-driven, resource-oriented, fleet-aware, and secure enough for shared agents. Comfy's official servers define the expected user journey; `comfyui-node` can differentiate on direct integration, typed contracts, resilient jobs, artifact-native results, and multi-instance orchestration.
