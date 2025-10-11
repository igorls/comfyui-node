# Changelog

## Unreleased

Features:

* Introduced `WorkflowPool`, a new event-driven pooling API with pluggable queue adapters and smarter failover heuristics. Jobs receive stable ids, WebSocket events carry the id, and backends such as Redis/BullMQ/RabbitMQ can be integrated by implementing `QueueAdapter`.
* Added `SmartFailoverStrategy` and `MemoryQueueAdapter` reference implementations plus a typed event map covering `job:*` and `client:*` lifecycle notifications.
* Published `docs/workflow-pool.md` with architecture overview, adapter contract, and event reference. Updated README multi-instance section to compare `WorkflowPool` with the legacy `ComfyPool`.
* New demo: `demos/recursive-edit/` showcases a `WorkflowPool`-powered WebSocket server and browser UI that repeatedly applies a Qwen image edit workflow, useful for multi-session stress tests.

Breaking:

* None – `ComfyPool` remains unchanged and continues to be exported for existing consumers.

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
