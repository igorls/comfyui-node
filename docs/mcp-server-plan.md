# Bundled Local MCP Server Plan

## Product

`comfyui-node` remains one TypeScript library and additionally ships one local
MCP stdio executable. Users run it from their existing coding agent with
`npx` or `bunx`; the MCP server connects directly to their existing ComfyUI.

```text
vision-capable coding agent
          |
      MCP over stdio
          |
 npx/bunx comfyui-node
          |
    existing ComfyApi
          |
     local ComfyUI
```

The product is not a hosted service and does not contain another agent. The
user's coding agent owns the creative reasoning loop:

```text
idea -> generate -> inspect pixels -> revise -> generate -> accept
```

The bundled server makes those steps fast and reliable. It executes workflows,
returns review-friendly images, preserves enough iteration context to compare
results, and exposes focused controls for the next attempt.

## Non-goals

The first product does **not** need:

- Streamable HTTP or any network-facing MCP transport;
- OAuth, users, tenants, accounts, or remote authentication;
- a database or durable cross-session task system;
- cloud generation or partner-model integrations;
- a plugin/provider framework;
- a second internal vision model or reviewer agent;
- MCP Tasks, app hosting, or administration of ComfyUI installations;
- a separate package, daemon, gateway, control plane, or deployment guide.

Generated files and ComfyUI history remain the durable record. The MCP process
may keep lightweight run/iteration state in memory for the life of the coding
agent session.

## Command and Packaging

Add an executable to the existing package:

```json
{
  "bin": {
    "comfyui-node": "./dist/bin/comfyui-node.js"
  }
}
```

The executable starts the stdio MCP server by default. Accepting an optional
`mcp` word is convenient but should not be required:

```bash
npx -y comfyui-node --url http://127.0.0.1:8188
bunx comfyui-node --url http://127.0.0.1:8188

# Also acceptable for discoverability
npx -y comfyui-node mcp --url http://127.0.0.1:8188
```

Configuration stays small:

- `--url` or `COMFYUI_URL`, default `http://127.0.0.1:8188`;
- `--workflow-dir` or `COMFYUI_WORKFLOW_DIR`, repeatable if needed;
- existing library authentication options for users whose local endpoint
  already requires them;
- `--debug`, writing diagnostics to stderr only.

Stdout is reserved exclusively for MCP JSON-RPC. Importing `comfyui-node` as a
library must never start the server or load the MCP SDK as a side effect.

The package should export the server factory for embedding and tests:

```ts
import { createComfyMcpServer } from "comfyui-node/mcp";
```

## The Deep Module

Add one `McpGenerationSession` module at the seam between MCP tools and the
existing library. It hides workflow preparation, uploads, job correlation,
WebSocket progress, output collection, contact-sheet creation, and iteration
lineage behind a small interface.

```ts
interface McpGenerationSession {
  generate(input: GenerateInput): Promise<GenerationResult>;
  inspect(input: InspectInput): Promise<InspectionResult>;
  revise(input: ReviseInput): Promise<GenerationResult>;
  job(input: JobInput): Promise<JobResult>;
}
```

The existing `ComfyApi`, `Workflow`, `CallWrapper`, and file/history features
remain the implementation. Do not create generic backend, store, artifact,
policy, or routing interfaces until a second real implementation requires a
seam.

The process-local session registry records:

- run ID and ComfyUI prompt ID;
- source workflow and structure hash;
- applied inputs, prompt, seed, and output nodes;
- generated artifact paths/URLs;
- parent run ID for revisions;
- review renditions already created.

If the MCP process restarts, the agent can still inspect a known ComfyUI prompt
ID through history, but creative lineage across the old process is not a v1
requirement.

## MCP Tool Surface

Ship six tools. Their names and schemas remain stable; dynamic ComfyUI nodes do
not become MCP tools.

> **As built:** the server ships nine tools. The six below plus `comfy_nodes`
> (live node schemas), `comfy_recipes` (scaffold graphs for installed models),
> and `comfy_validate` (check a graph against live node definitions) were added
> during implementation so agents can build workflows without guessing pin
> names. `docs/agent-workflow-guide.md` documents the shipped surface.

| Tool | Purpose |
| --- | --- |
| `comfy_info` | Confirm the local server, capabilities, models, queue, and configured workflow directories |
| `comfy_workflows` | List or inspect local workflow JSON files and their editable inputs/output nodes |
| `comfy_generate` | Run a workflow with prompt/input overrides and optional candidate count |
| `comfy_inspect` | Return a contact sheet, one image, crop, or previous/current comparison for vision review |
| `comfy_revise` | Create a child run from a previous run with targeted overrides while preserving lineage |
| `comfy_job` | Get status, wait, cancel, or recover outputs by run ID/prompt ID |

This is enough for the existing coding agent to implement the creative loop. We
should not encode subjective review or prompt rewriting inside the server.

### `comfy_generate`

Accept:

- a workflow name/path from configured workflow directories, or inline
  API-format JSON for expert use;
- typed input overrides by stable slot name or explicit node/input path;
- candidate count with a conservative maximum;
- optional seed or seed policy;
- optional input images from paths the coding agent already has access to;
- selected output node IDs or aliases.

Return immediately after submission with a run ID, then allow `comfy_job` to
wait. If a short wait completes within the caller's timeout, the result may
include the review packet directly.

### `comfy_inspect`

This is the differentiating tool for vision-capable coding agents. It performs
no generation and supports:

- `contact_sheet`: labeled thumbnails for all candidates in a run;
- `image`: one candidate at bounded review resolution;
- `crop`: an exact normalized or pixel-coordinate crop;
- `compare`: previous/current images side by side;
- `original`: the local artifact path plus metadata.

Use `sharp`, already in the package, to produce temporary review renditions.
Return bounded MCP image content so the coding agent can see it immediately,
plus structured metadata containing candidate ID, dimensions, seed, workflow
hash, and original path. Do not inline every full-resolution original.

### `comfy_revise`

Accept a previous run ID and targeted changes:

- prompt or negative-prompt changes;
- seed policy (`keep`, `new`, or explicit);
- named workflow slot overrides;
- candidate count;
- optional textual review note for provenance.

Clone the previous run's workflow and inputs, apply only the requested changes,
and submit a child run. The agent can then call `comfy_inspect` with `compare`
to review whether the revision improved the result.

## Workflow Usability

No universal generated workflow will work across every local ComfyUI install.
Keep v1 deterministic:

1. Users point the server at directories containing workflows they already
   know work locally.
2. `comfy_workflows` detects API-format workflows and indexes them.
3. A small optional sidecar file exposes stable slot names such as `prompt`,
   `negative_prompt`, `seed`, `width`, and `height`.
4. Without a sidecar, the agent may use explicit `node_id.input_name` paths.

Example sidecar:

```json
{
  "workflow": "sdxl.json",
  "slots": {
    "prompt": "6.text",
    "negative_prompt": "7.text",
    "seed": "3.seed",
    "width": "5.width",
    "height": "5.height"
  },
  "outputs": {
    "images": "9"
  }
}
```

The first release should validate the workflow against live `/object_info`
before submitting it and give the agent actionable missing-node/model/input
errors. UI-format conversion and automatic workflow synthesis can wait.

## Local Privacy

Privacy is simple because the process is local and stdio-only:

- make no outbound requests from the MCP implementation;
- connect only to the explicitly configured ComfyUI URL;
- never download models, templates, or custom nodes;
- never send telemetry;
- do not expose lifecycle, shell, package-install, or arbitrary URL tools;
- resolve workflow and input paths locally and reject paths outside configured
  roots where the server itself performs file reads;
- return local output paths and bounded image content to the calling agent;
- keep prompts and images out of logs unless `--debug` explicitly requests
  diagnostic detail, and redact credentials even then.

Workflows and installed custom nodes execute with the user's ComfyUI privileges.
The server should state that fact, but v1 does not need a multi-tenant sandbox.

## Agent Instructions

Keep server instructions short and operational:

1. Call `comfy_info` once.
2. Use `comfy_workflows` to select a known local workflow.
3. Call `comfy_generate` with two to four candidates.
4. Call `comfy_job` with `wait` if the run is not complete.
5. Call `comfy_inspect` with `contact_sheet` and visually assess the results.
6. If needed, inspect a candidate or crop, then call `comfy_revise` with
   targeted changes and compare it with its parent.
7. Stop when the user's request is satisfied or ask the user when artistic
   intent is ambiguous. Do not iterate indefinitely.

The coding agent supplies the visual judgment. The server supplies pixels,
metadata, reproducibility, and precise controls.

## Implementation Layout

Keep the code inside the existing package:

```text
src/mcp/
  index.ts                  # public createComfyMcpServer export
  server.ts                 # MCP registration and stdio startup
  generation-session.ts     # deep module
  workflow-catalog.ts       # configured local workflows + sidecars
  review-images.ts          # contact sheets, crops, comparisons
  schemas.ts                # stable tool input/output schemas
src/bin/
  comfyui-node.ts           # npx/bunx executable
test/mcp/
  server.spec.ts
  generation-session.spec.ts
  review-images.spec.ts
  stdio.integration.spec.ts
```

Use the official TypeScript MCP SDK. Keep all ComfyUI behavior in the existing
library modules; the MCP registration should only validate schemas, call the
deep module, and translate results into MCP content blocks.

## Delivery Plan

### Slice 1: bundled stdio server

- Add the MCP SDK, package export, and executable.
- Implement `comfy_info`, `comfy_generate`, and `comfy_job`.
- Reuse the existing mock ComfyUI integration infrastructure.
- Document copy-paste configuration for Codex, Claude Code/Desktop, and Cursor
  using `npx -y comfyui-node` or `bunx comfyui-node`.

Exit gate: a coding agent can launch the package, run one configured local
workflow, wait through WebSocket progress, and receive the output path.

### Slice 2: vision review loop

- Implement `comfy_inspect` contact sheets, images, and crops.
- Implement `comfy_revise` with parent/child lineage and seed policy.
- Return MCP image content at bounded review resolution.
- Add side-by-side comparison.

Exit gate: a vision-capable coding agent generates candidates, sees a contact
sheet, requests one detailed crop, revises the prompt, compares iterations, and
selects a satisfactory local result.

### Slice 3: workflow usability

- Implement `comfy_workflows` indexing and sidecar slots.
- Add live node/model/input validation.
- Add attachments through configured local roots.
- Polish errors and concise server instructions using real coding-agent runs.

Exit gate: the same tool interface works across several existing local
workflows without the agent editing raw graph JSON for ordinary prompt/seed/
dimension changes.

## Acceptance Criteria

- Both `npx -y comfyui-node` and `bunx comfyui-node` start a valid stdio MCP
  server from the published package.
- Normal library imports remain side-effect free.
- The default MCP context contains a fixed, focused tool set (nine as built;
  see the note under MCP Tool Surface).
- A generation uses the existing WebSocket connection and does not poll while
  events are healthy.
- A completed multi-candidate run returns one labeled contact sheet under the
  configured image/payload limit.
- The agent can request an exact crop or parent/current comparison without a new
  generation.
- A revision records its parent, workflow hash, overrides, seed policy, and
  output paths.
- The MCP implementation makes zero unexpected outbound network requests.
- Missing ComfyUI, workflow, node, model, and output errors are concise and
  actionable to an agent.
- Focused unit/integration tests and one opt-in real ComfyUI creative-loop test
  pass before publishing.

## Primary References

- [Comfy MCP product page](https://comfy.org/mcp/)
- [Comfy MCP documentation](https://docs.comfy.org/agent-tools/mcp)
- [Comfy MCP source](https://github.com/Comfy-Org/comfy-mcp)
- [ComfyUI source](https://github.com/Comfy-Org/ComfyUI)
- [MCP tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [MCP resources specification](https://modelcontextprotocol.io/specification/2025-11-25/server/resources)
- [MCP progress specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress)

## Appendix: Implementation Findings & Open Questions

Pre-execution notes. Findings are verified against the current repo and the
installed dependencies; questions list decisions the implementation must make.
Proposed defaults are given so execution can proceed without re-deciding.

### A. Verified findings (repo + dependency state)

1. **Dependencies already installed.** `@modelcontextprotocol/sdk@1.30.0` and
   `zod@4.4.3` are present; `sharp@^0.34.5` and `ws@8.19.0` were already
   dependencies. `zod` is a direct dependency (required because schemas import
   it directly). No network install step needed at execution time.
2. **MCP SDK high-level API.** `McpServer` is exported from
   `@modelcontextprotocol/sdk/server` and takes `(serverInfo: Implementation,
   options?: ServerOptions)`. Tools are registered with
   `server.registerTool(name, { description, inputSchema, outputSchema,
   annotations }, cb)` where `inputSchema`/`outputSchema` are a plain
   **Zod raw shape** (`Record<string, ZodType>`) or a full object schema. The
   legacy `tool(...)` overloads are deprecated in 1.30.0 — use
   `registerTool`. `registerTool` returns a `RegisteredTool` handle with
   `enable`/`disable`/`remove`/`update` for runtime management.
3. **Zod v4 + JSON-schema compatibility is handled by the SDK.** The SDK's
   `zod-compat` module defines `AnySchema = z3.ZodTypeAny | z4.$ZodType` and
   `ZodRawShapeCompat = Record<string, AnySchema>`, and converts schemas via
   `zod-to-json-schema`. So zod v4 shapes are accepted as-is. **Caveat:**
   output schemas are converted with `zodToJsonSchema`; use only broadly
   supported schema constructs in `outputSchema` (avoid `z.any()` fields that
   map to `additionalProperties: true` ambiguities — prefer
   `z.record(z.unknown())` or `z.string()` for open-ended fields).
4. **Output validation is real.** `McpServer.validateToolOutput` runs
   `structuredContent` against `outputSchema` and throws `McpError
   (InvalidParams)` if a declared output schema has no
   `structuredContent`. So any tool that declares an `outputSchema` **must**
   return `structuredContent` matching it. Tools that return image content but
   no structured payload must therefore either omit `outputSchema` or include
   a `structuredContent` object.
5. **Stdio + in-memory transports confirmed.** `StdioServerTransport` is at
   `@modelcontextprotocol/sdk/server/stdio.js`; `InMemoryTransport` with
   `static createLinkedPair(): [InMemoryTransport, InMemoryTransport]` is at
   the package root (`@modelcontextprotocol/sdk/inMemory.js`). Both are
   available for the stdio server and for tests.
6. **Server `instructions` — verify at execution.** The MCP spec carries
   `instructions` in the `initialize` result. Confirm the installed SDK's
   `ServerOptions`/`Implementation` path forwards `instructions` to the client;
   if the SDK does not surface it, fall back to embedding the short agent
   instructions in each tool description (the plan's 7-step loop) rather than
   blocking on `instructions`.
7. **`package.json` gates the implementation.** Current state:
   - `"type": "module"`, `"main": "dist/index.js"`, `"sideEffects": false`
     (already declared — good for the side-effect-free acceptance criterion).
   - `"files": ["dist", "!dist/.tsbuildinfo", "!dist/**/tests/**", ...]` —
     `dist/bin/` is inside `dist`, so the bin is included by `files`; verify
     with `npm pack --dry-run` (or `bun pm pack --dry-run`).
   - Scripts of note: `test`/`test:unit` use the glob
     `./test/*.spec.ts` (see finding 8); `check:all` = `build` + `test` +
     `typecov:strict` + `dist:fresh`; `prepublishOnly` = `check:all`.
   - No `bin` field yet — add `{ "comfyui-node": "./dist/bin/comfyui-node.js" }`.
   - `engines.node >=22`; keep that floor (Node ESM + `fetch`/`WebSocket`
     globals relied on by the library).
8. **Test-runner glob does not cross directory boundaries.** Confirmed:
   `bun test "./test/i*.spec.ts"` reports "no matches" (a bare pattern matches
   only the top-level `test/` directory, not `test/integration/` or
   `test/mcp/`). The plan's `test/mcp/*.spec.ts` will therefore **not** run
   under the existing `test`/`test:unit` globs. **Required change:** extend
   `test` and `test:unit` to include `./test/mcp/*.spec.ts` (e.g.
   `bun test --bail 10 ./test/*.spec.ts ./test/mcp/*.spec.ts
   ./src/multipool/tests/*.spec.ts`). `test:all` (`bun test`) already picks up
   subdirectories.
9. **`dist:fresh` gate.** `dist:fresh` rebuilds and fails if
   `git diff --name-only -- dist` is non-empty, i.e. `dist/` is git-tracked and
   must be committed in sync with `src/`. Adding `src/mcp/` and `src/bin/` adds
   compiled output under `dist/mcp/` and `dist/bin/` that must be built and
   committed. This is a workflow constraint, not a code problem — but it means
   the build must run on a clean tree before `check:all`.
10. **Type-coverage gate.** `check:all` enforces `typecov:strict`
    (`type-coverage --at-least 90`). New `src/mcp/` and `src/bin/` code must
    meet 90% type coverage; `type-coverage.json` and any `--ignore`/path config
    may need the new paths handled. This is a real risk for the deep module's
    dynamic `WorkflowResult`/`any`-typed seams — keep `any` usage minimal and
    localized.
11. **Shebang under `tsc`.** A first-line `#!/usr/bin/env node` shebang in
    `src/bin/comfyui-node.ts` is emitted verbatim into `dist/bin/comfyui-node.js`
    under ESM. Node executes the shebang for a `.js` ESM bin; Bun also honors
    it. Keep the shebang on line 1 with no leading blank line, and add a test
    that spawns `node dist/bin/comfyui-node.js` (and `bun dist/bin/comfyui-node.js`)
    with an `initialize` handshake to prove the bin starts.
12. **Library logging goes to `console.*`.** `ComfyApi` debug logging uses
    `console.debug`/`console.log` (e.g. `client.ts`, `call-wrapper.ts`'s
    `isDebug`), and `Workflow.output` uses `console.warn`. Because the MCP
    server's stdout is reserved for JSON-RPC, the server must redirect
    `console.log/warn/error/info/debug` to **stderr** at startup (and honor
    `--debug`). This is a server-side concern; the library itself is left
    unchanged.

### B. Open questions (with proposed defaults)

1. **`comfy_job.wait` blocking semantics.** A tool call that blocks for minutes
   can exceed client timeouts. Decide: does `wait` block the single MCP call
   until completion (with an internal cap), or return a partial `{ status,
   progress, outputs? }` snapshot so the agent can re-poll?
   - *Proposed default:* `wait` blocks up to `timeoutMs` (default 60_000 ms,
     hard cap e.g. 5 min), returning `{ status, progress, outputs? }`. If not
     complete by the cap, return `{ status: "in_progress" }` so the agent can
     re-issue `wait`. Non-blocking `status` reads stay available. This keeps
     the loop simple without an unbounded single call.
2. **`generate` return timing (deep-module contract).** The interface shows
   `generate(input): Promise<GenerationResult>`, but `comfy_generate` "returns
   immediately after submission with a run ID" and may include a review packet
   if a short wait completes. Clarify: does `generate` resolve on **submit**
   (run ID) or on **completion** (outputs)?
   - *Proposed default:* `generate` resolves on **accept/pending** with
     `{ runId, promptId, structureHash }` plus an optional short inline result
     if it completes within a small `waitMs` (default 0 for immediate, set by
     the tool's "short wait" budget). Full outputs come from `comfy_job`
     `wait`/`done`. The session tracks the in-flight `WorkflowJob` so
     `comfy_job` can attach to the same correlation.
3. **ComfyUI connection timing.** Eager connect at MCP startup delays
   `initialize`; a missing ComfyUI would also break server start.
   - *Proposed default:* **lazy connect** — the first tool that needs ComfyUI
     (typically `comfy_info`) calls `await api.ready()` (idempotent init +
     `waitForReady`). `comfy_info` reports connected/ready state. The MCP
     `initialize` handshake always succeeds regardless of ComfyUI health.
4. **`object_info` fetch + cache.** Validating workflows against live
   `/object_info` before submit requires that endpoint.
   - *Proposed default:* fetch once after connect and cache with a TTL
     (e.g. 5 min) and a `refresh` affordance in `comfy_info`. Confirm the exact
     route via `api.fetchApi("/object_info")` at execution (the client exposes
     `fetchApi(route)` and `ext.node.getNodeDefs()` for a scoped variant).
5. **Candidate count.** Multiple candidates = same workflow run N times with
   distinct seeds.
   - *Proposed default:* default 2, max 6 (conservative). The session stores a
     `candidates[]` list on the run (each with its own promptId/seed) so
     `contact_sheet` and per-candidate `inspect` can address them by index.
6. **Seed policy semantics.** The library auto-randomizes seed inputs set to
   `-1` on `run`.
   - *Proposed default:* `keep` = reuse the parent run's recorded seed; `new`
     = set the seed input to `-1` (let the library randomize) and record the
     chosen value from the result's `_autoSeeds`; `explicit` = set the provided
     integer. Record the resolved seed per candidate in the registry.
7. **Review-render budgets.** `comfy_inspect` must return bounded image
   content.
   - *Proposed default:* per-image long edge ≤ 1024 px; contact sheet grid
     max 4 per row, cell long edge ≤ 384 px; JPEG quality 80; total payload
     target ≤ ~512 KB per response. `crop` operates on normalized (0..1) or
     absolute pixel coordinates and is clamped to the source bounds. These are
     tunables, not hard spec — expose them as internal constants.
8. **`compare` "previous" resolution.** `compare` needs a previous/current
   pair.
   - *Proposed default:* if a `parentRunId`/`previous` argument is omitted, use
     the child run's recorded `parentRunId` (lineage). Accept an explicit
     `previous: { runId, candidateIndex }` to compare arbitrary runs.
9. **Artifact materialization (local paths).** ComfyUI serves images via
   `/view?filename=...&subfolder=...&type=...` (HTTP), not local disk.
   - *Proposed default:* **do not** download full originals by default;
   return the artifact **URL + metadata** in the structured result, and only
   fetch an image into memory when a `contact_sheet`/`image`/`crop`/`compare`
   rendition requires it. If a stable local path is desired, materialize under
   `os.tmpdir()/comfyui-node-mcp/<runId>/` on demand. Decision point: URL-only
   (simplest, no disk writes) vs. materialize-to-temp. *Leaning:* URL-only for
   v1, temp materialization only for renditions.
10. **Review renditions storage.**
    - *Proposed default:* in-memory `Buffer`/Blob for the returned image
      content (MCP image blocks carry base64 inline). Avoid temp files for
      renditions so there is no path to leak and no cleanup burden.
11. **Session registry bounds.** In-memory, per-process.
    - *Proposed default:* store metadata only (runId, promptId, structureHash,
      inputs/seed/outputs, artifact paths/URLs, parentRunId, renditions created)
      — never full image bytes. Cap the registry (e.g. 200 runs) with an LRU
      eviction, and note in `comfy_info` that lineage survives only for the
      life of the MCP process (restart ⇒ recover via ComfyUI history/promptId).
12. **Error translation.** Map the library `CallWrapperError`/`ErrorCode`
    hierarchy to MCP `CallToolResult { isError: true }` with concise,
    actionable text plus a machine-readable `code` field in
    `structuredContent`. Missing-node/model/input validation errors should name
    the exact node id + class_type and the missing model/input so the agent can
    self-correct without raw graph JSON.
13. **Path security (local roots).** `--workflow-dir` roots and input-image
    paths must be resolved and confined to configured roots when **the server**
    performs the read.
    - *Proposed default:* resolve with `path.resolve`, require the resolved
      path to be inside a configured root (canonical prefix check after
      resolving symlinks), and reject `..` escapes and non-root paths. Inline
      API-format JSON workflows are expert use — their referenced image inputs
      are still resolved locally by the server and subject to the same root
      confinement when the server reads them.
14. **`sharp` is a hard dependency for the vision loop.** `sharp` is required
    for `contact_sheet`/`crop`/`compare`.
    - *Proposed default:* keep `sharp` as a hard dependency (it already is).
      Open risk: on some platforms `npx -y comfyui-node` could trigger a
      `sharp` install/build. Accept the risk for v1; if it proves flaky, make
      `comfy_inspect` renditions degrade gracefully (return the original image
      content without a contact sheet) while `comfy_generate`/`comfy_job`
      remain fully functional. This is a fallback, not the default.
15. **Publishing for `npx` acceptance.** `npx -y comfyui-node` requires the
    package to be on npm. For local dev/CI, the executable is exercised via
    `node dist/bin/comfyui-node.js` / `bun dist/bin/comfyui-node.js` and the
    in-memory transport. No `publishConfig`/access changes are needed in the
    plan beyond `bin` + `exports`.
16. **`test:real` creative-loop test.** The plan calls for "one opt-in real
    ComfyUI creative-loop test."
    - *Proposed default:* add `test/mcp/creative-loop.real.spec.ts` gated by
      `COMFY_REAL=1` (mirroring the existing `test:real`/`test:full` env-gate
      pattern), and wire a `test:real:mcp` script. Keep it out of the default
      `test`/`check:all` path.
17. **MCP server identity.** The `Implementation` passed to `McpServer` needs a
    `name` and `version`.
    - *Proposed default:* `name: "comfyui-node-mcp"`, `version:` read from
      `package.json` (bump the package version, not a separate one).
18. **Side-effect guard.** Keep `src/index.ts` free of any `src/mcp` import so
    the `sideEffects: false` declaration holds. Add a lightweight test
    asserting the main entry module does not transitively import the MCP entry
    (a grep/import-assertion is sufficient for v1).
19. **Tool descriptions are the agent-facing spec.** Because the coding agent
    drives the creative loop, the six tool descriptions (and `instructions`
    where available) must carry the 7-step operational loop from the plan's
    "Agent Instructions" section. Draft these strings as part of the schemas
    module so they are reviewed with the tool surface.

### C. Suggested execution order (refined)

1. Update `package.json` (`bin`, `exports["./mcp"]`, test-script glob for
   `test/mcp`, version bump) — finding 7/8/11/15.
2. `src/mcp/schemas.ts` — six stable tool input/output zod shapes +
   descriptions (question 19).
3. `src/mcp/generation-session.ts` — deep module + process-local registry
   (questions 2/5/6/11).
4. `src/mcp/workflow-catalog.ts` — workflow dirs, sidecar slots, `object_info`
   validation (questions 3/4/13).
5. `src/mcp/review-images.ts` — sharp renditions (questions 7/8/9/10/14).
6. `src/mcp/server.ts` — `McpServer` + `registerTool` × 6 + stdio startup +
   config parsing + stdout→stderr console redirect (findings 2/5/6/12).
7. `src/mcp/index.ts` — `createComfyMcpServer` export (finding 18).
8. `src/bin/comfyui-node.ts` — shebang executable (finding 11).
9. `test/mcp/*` — in-memory transport + existing mock ComfyUI helpers;
   stdio handshake via spawned `dist/bin` (questions 1/2/16).
10. Docs: copy-paste MCP config for Codex/Claude Code/Cursor.
11. `check:all` (build + test + typecov:strict + dist:fresh) and commit `dist/`
    in sync (findings 9/10).

