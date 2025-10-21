# Troubleshooting

Common issues, diagnostics, and solutions for the ComfyUI SDK.

## Table of Contents

- [Common Issues](#common-issues)
- [Error Types](#error-types)
- [Testing & Coverage](#testing--coverage)
- [Diagnostic Tips](#diagnostic-tips)
- [Published Smoke Test](#published-smoke-test)

## Common Issues

| Symptom | Likely Cause | Fix |
| ------- | ------------ | ---- |
| `progress_pct` never fires | Only listening to raw `progress` (or run finished instantly) | Subscribe to `progress_pct`; ensure workflow isn't trivially cached/instant |
| Empty `images` array | Wrong node id in `.output()` or no `SaveImage` nodes detected | Verify node id in base JSON; omit outputs to let auto-detect run |
| `_autoSeeds` missing | No `seed: -1` inputs present | Set seed field explicitly to `-1` on nodes requiring randomization |
| Autocomplete missing for sampler | Used `Workflow.from(...)` not `fromAugmented` | Switch to `Workflow.fromAugmented(json)` |
| Type not updating after new `.output()` | Captured type alias before adding the call | Recompute `type R = ReturnType<typeof wf.typedResult>` after last output declaration |
| Execution error but no missing outputs | Underlying node error surfaced via `execution_error` event | Listen to `failed` + inspect error/server logs |
| Job hangs waiting for output | Declared non-existent node id | Run with fewer outputs or validate JSON; inspect `_nodes` metadata |
| Random seed not changing between runs | Provided explicit numeric seed | Use `-1` sentinel or generate random seed before `.set()` |
| Preview frames never appear | Workflow lacks preview-capable nodes (e.g. KSampler) | Confirm server emits `b_preview` events for your graph |
| Pool never selects idle client | Mode set to `PICK_LOWEST` with constant queue depth | Switch to `PICK_ZERO` for latency focus |
| High-level run returns immediately | Accessed `await api.run(wf)` only (acceptance barrier) | Await `job.done()` or events to completion |
| Clients constantly disconnecting (idle) | WebSocket inactivity timeout too aggressive | Health checks enabled by default in v1.4.1+; verify not disabled |
| Connection stability issues | Network/firewall dropping idle connections | Ensure `healthCheckIntervalMs` enabled (default 30s) in WorkflowPool |

## Error Types

The SDK raises specialized `Error` subclasses for better debuggability:

| Error | When | Key Extras |
| ----- | ---- | ---------- |
| `EnqueueFailedError` | HTTP `/prompt` (append/queue) failed | `status`, `statusText`, `url`, `method`, `bodyJSON`, `bodyTextSnippet`, `reason` |
| `ExecutionFailedError` | Execution finished but not all mapped outputs arrived | missing outputs context |
| `ExecutionInterruptedError` | Server emitted interruption mid-run | cause carries interruption detail |
| `MissingNodeError` | Declared bypass or output node is absent | `cause` (optional) |
| `WentMissingError` | Job disappeared from queue and no cached output | – |
| `FailedCacheError` | Cached output retrieval failed | – |
| `CustomEventError` | Server emitted execution error event | event payload in `cause` |
| `DisconnectedError` | WebSocket disconnected mid-execution | – |

### Error Codes

Every custom error exposes a stable `code` (enum) for branch logic without string matching:

```ts
import { ErrorCode, EnqueueFailedError } from "comfyui-node";

try {
  await new CallWrapper(api, workflow).run();
} catch (e) {
  if ((e as any).code === ErrorCode.ENQUEUE_FAILED) {
    // inspect structured diagnostics
    const err = e as EnqueueFailedError;
    console.error('Status:', err.status, err.statusText);
    console.error('Reason:', err.reason);
    console.error('Body JSON:', err.bodyJSON);
    console.error('Snippet:', err.bodyTextSnippet);
  }
}
```

### EnqueueFailedError Details

When the server rejects a workflow submission:

```ts
try {
  await new CallWrapper(api, workflow).run();
} catch (e) {
  if (e instanceof EnqueueFailedError) {
    console.error('Status:', e.status, e.statusText);
    console.error('Reason:', e.reason);         // bodyJSON.error || bodyJSON.message || text snippet
    console.error('Body JSON:', e.bodyJSON);     // parsed JSON if available
    console.error('Snippet:', e.bodyTextSnippet); // first 500 chars of response
  }
}
```

`reason` is resolved using (in order):
1. `bodyJSON.error`
2. `bodyJSON.message`
3. Truncated text body (first 500 chars)

This helps identify:
- Mis-shaped prompts
- Missing extensions
- Permission issues
- Model path problems

### Execution Failure vs Interruption

- **`ExecutionFailedError`**: Workflow ran but declared output nodes never produced data (often upstream node error). Check output mappings or inspect per-node errors.
- **`ExecutionInterruptedError`**: Server/user actively interrupted execution. Retrying may succeed if cause was transient.

## Testing & Coverage

This repository uses Bun's built-in test runner.

### Test Scripts

```bash
bun test                 # unit + lightweight integration tests
bun run test:real        # real server tests (COMFY_REAL=1)
bun run test:full        # comprehensive real server tests (COMFY_REAL=1 COMFY_FULL=1)
bun run coverage         # text coverage summary
bun run coverage:lcov    # generate coverage/lcov.info
bun run coverage:enforce # generate LCOV then enforce thresholds
```

### Environment Flags

- `COMFY_REAL=1` – enables `test/real.integration.spec.ts` (expects running ComfyUI at `http://localhost:8188` or `COMFY_HOST`)
- `COMFY_FULL=1` – additionally enables extended `test/real.full.integration.spec.ts` suite
- `COMFY_HOST=http://host:port` – point at non-default instance

### Coverage Thresholds

Enforced by `scripts/coverage-check.ts`:

**Default thresholds:**
- Lines: `>= 25%`
- Functions: `>= 60%`

**Override thresholds:**

```bash
# Unix/macOS
COVERAGE_MIN_LINES=30 COVERAGE_MIN_FUNCTIONS=65 bun run coverage:enforce

# PowerShell
$env:COVERAGE_MIN_LINES=30; $env:COVERAGE_MIN_FUNCTIONS=65; bun run coverage:enforce
```

### Improving Coverage

Current low-coverage areas:
- `src/client.ts` – large surface; extract helpers & add unit tests
- `src/call-wrapper.ts` – test error paths with mocked fetch & events
- Feature modules with toleration logic (`monitoring`, `manager`, `terminal`)

**Incremental strategy:**
1. Extract pure helper functions from monolithic classes
2. Add fine-grained tests for error branches (non-200 responses, malformed JSON)
3. Introduce deterministic mock WebSocket for replay testing
4. Gradually raise thresholds by 5% after meaningful additions

**Before opening PRs:**

```bash
bun test && bun run coverage
```

## Diagnostic Tips

### Enable Verbose Progress

```bash
COMFY_PROGRESS_VERBOSE=1 bun run your-script.ts
```

### Inspect Enqueue Failures

Check `EnqueueFailedError` fields:
- `status` – HTTP status code
- `reason` – extracted error message
- `bodyTextSnippet` – first 500 chars of response

### Verify Alias Mappings

```ts
const result = await job.done();
console.log('Aliases:', result._aliases);
// { images: '9', sampler: '3' }
```

### Check Auto Seeds

```ts
console.log('Auto Seeds:', result._autoSeeds);
// { '3': 1234567 }
```

### Type Staleness

If types feel stale, close & reopen the file – TypeScript sometimes caches deep conditional expansions.

### Connection Issues

Monitor connection state:

```ts
pool.on("client:state", (ev) => {
  console.log(`client ${ev.detail.clientId}: online=${ev.detail.online}, busy=${ev.detail.busy}`);
});
```

Check WebSocket activity:

```ts
api.on('disconnected', () => console.log('WS disconnected'));
api.on('reconnected', () => console.log('WS reconnected'));
```

### Debug Mode

Enable debug logging:

```ts
const api = new ComfyApi('http://localhost:8188', undefined, {
  debug: true  // structured socket + polling logs
});

// or via environment:
// COMFY_DEBUG=1 bun run your-script.ts
```

## Published Smoke Test

The script `scripts/published-e2e.ts` verifies the published npm artifact with **Bun auto-install**.

### Quick Run (Auto-Install)

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
| `COMFY_MODEL` | `SDXL/sd_xl_base_1.0.safetensors` | Checkpoint (must exist) |
| `COMFY_POSITIVE_PROMPT` | scenic base prompt | Positive text |
| `COMFY_NEGATIVE_PROMPT` | `text, watermark` | Negative text |
| `COMFY_SEED` | random | Deterministic seed override |
| `COMFY_STEPS` | `8` | Sampling steps |
| `COMFY_CFG` | `2` | CFG scale |
| `COMFY_SAMPLER` | `dpmpp_sde` | Sampler name |
| `COMFY_SCHEDULER` | `sgm_uniform` | Scheduler name |
| `COMFY_TIMEOUT_MS` | `120000` | Overall timeout (ms) |
| `COMFY_UPSCALE` | unset | If set, adds RealESRGAN upscale |
| `COMFY_MONITOR` | unset | Enable Crystools monitor |
| `COMFY_MONITOR_STRICT` | unset | Fail if no monitor events |

**Exit codes:**
- 0: success
- 1: import failure
- 2: timeout
- 3: enqueue failure
- 4: other error
- 5: monitor strict failure

### Rationale

Ensures published `dist` is coherent and functional in clean consumer environment. Can be wired into CI behind opt-in flag.

## Getting More Help

1. **Check existing documentation:**
   - [Getting Started](./getting-started.md)
   - [Workflow Guide](./workflow-guide.md)
   - [API Features](./api-features.md)
   - [Advanced Usage](./advanced-usage.md)

2. **Search existing issues:** [GitHub Issues](https://github.com/igorls/comfyui-node/issues)

3. **Open a new issue:** Provide:
   - SDK version
   - ComfyUI version
   - Minimal reproducible example
   - Error messages/stack traces
   - Environment (Node/Bun version, OS)

4. **Check ComfyUI logs:** Often node errors appear in server console but not SDK events
