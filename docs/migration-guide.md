# Migration Guide (v1.0)

Guide for upgrading from <1.0 to 1.0+ with complete deprecated API mappings.

## Overview

Version 1.0.0 removed all legacy `ComfyApi` instance methods after a deprecation window in 0.2.x. All functionality has been moved to modular `api.ext.*` namespaces.

**No runtime warnings remain** – they were stripped with the removals.

## Quick Migration Table

| Deprecated Method | Replacement |
| ----------------- | ----------- |
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

## Migration Examples

### Before (0.x)

```ts
const stats = await api.getSystemStats();
await api.uploadImage(buf, 'a.png');
const checkpoints = await api.getCheckpoints();
const history = await api.getHistory('prompt-123');
await api.interrupt();
```

### After (1.0+)

```ts
const stats = await api.ext.system.getSystemStats();
await api.ext.file.uploadImage(buf, 'a.png');
const checkpoints = await api.ext.node.getCheckpoints();
const history = await api.ext.history.getHistory('prompt-123');
await api.ext.queue.interrupt();
```

## Automated Migration

### Bash (Unix/macOS)

```bash
# Example for getSystemStats
grep -R "api\.getSystemStats" -n src | cut -d: -f1 | xargs sed -i '' 's/api\.getSystemStats()/api.ext.system.getSystemStats()/g'

# Repeat for each method, or use a sed script file
```

### PowerShell (Windows)

```powershell
Get-ChildItem -Recurse -Include *.ts | ForEach-Object {
  (Get-Content $_.FullName) -replace 'api\.getSystemStats\(\)', 'api.ext.system.getSystemStats()' | Set-Content $_.FullName
}

# Add similar lines for each deprecated method
```

### Using Codemod Tools

For large codebases, consider tools like:
- [jscodeshift](https://github.com/facebook/jscodeshift)
- [ts-morph](https://github.com/dsherret/ts-morph)
- IDE refactoring (VSCode, IntelliJ)

## Benefits of Modular Namespaces

- **Better organization** – Related functionality grouped together
- **Tree-shaking** – Unused features can be eliminated by bundlers
- **Discoverability** – IDE autocomplete shows available features per namespace
- **Extensibility** – Easier to add new feature modules without polluting main API surface

## Namespace Overview

| Namespace | Responsibility |
| --------- | -------------- |
| `queue` | Prompt submission, append & interrupt |
| `history` | Execution history retrieval |
| `system` | System stats & memory free |
| `node` | Node defs + sampler/checkpoint/lora helpers |
| `user` | User & settings CRUD |
| `file` | Uploads, image helpers, user data file ops |
| `model` | Experimental model browsing & previews |
| `terminal` | Terminal logs & subscription toggle |
| `misc` | Extensions list, embeddings |
| `manager` | ComfyUI Manager extension integration |
| `monitor` | Crystools monitor events & snapshot |
| `featureFlags` | Server capabilities (`/features`) |

## Still Need Help?

- Check [API Features documentation](./api-features.md) for detailed namespace usage
- Open an issue on [GitHub](https://github.com/igorls/comfyui-node/issues) if you encounter migration problems
