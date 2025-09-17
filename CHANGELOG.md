# Changelog

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
