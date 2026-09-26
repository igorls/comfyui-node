# AI Agent Guide: Building, Validating, Managing, and Executing ComfyUI Workflows via MCP

This guide serves as the definitive reference for AI coding and vision agents (Claude Code / Desktop, Cursor, Codex, Copilot, Cline, Antigravity) connecting to the `comfyui-node` Model Context Protocol (MCP) server.

---

## 1. Mental Model & Architecture

The `comfyui-node` MCP server runs locally as a standard input/output (stdio) JSON-RPC process. It bridges directly into your live local ComfyUI instance via WebSocket and REST APIs.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                             AI CODING AGENT                                 │
│  (Claude Code / Desktop, Cursor, Codex, Copilot, Cline, Antigravity IDE)    │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ (MCP JSON-RPC over stdio)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           comfyui-node MCP SERVER                           │
│                                                                             │
│  [Discovery & Building]      [Validation & Storage]     [Multi-Modal Run]   │
│   • comfy_info                • comfy_validate           • comfy_generate   │
│   • comfy_nodes               • comfy_workflows          • comfy_inspect    │
│                                                          • comfy_revise     │
│                                                          • comfy_job        │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ (In-Process WebSocket + REST)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         LOCAL ComfyUI INSTANCE                              │
│  • GPU Engine (CUDA / MPS / ROCm / CPU)   • /object_info live node catalog  │
│  • Model Checkpoints & LoRAs              • WebSocket prompt queue & events │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. The 9 MCP Tools Reference

### 1. `comfy_info`
Confirms connection to the local ComfyUI server, inspects host OS, RAM, GPU device list (VRAM capacity), queue length, installed models (checkpoints, UNETs, CLIPs, VAEs, LoRAs), samplers, schedulers, configured workflow storage directories, and automatically detected **runnable recipe recommendations**.
- **When to use**: Always call first when starting a session to know what hardware, models, and curated model recipes are immediately available.
- **Connection fields**: `reachable` says whether ComfyUI answered over HTTP; `connected` / `connectionState` describe the event WebSocket, which `comfy_info` starts on first use and may still be handshaking. Treat `reachable: false` as "ComfyUI is down"; `reachable: true` with `connected: false` is normal on a first call.

### 2. `comfy_nodes`
Live discovery and pin-level schema inspection across all core and custom nodes installed on the server.
- **Arguments**:
  - `query?: string`: Search keyword (e.g. `"sampler"`, `"hunyuan"`, `"video"`, `"upscale"`, `"lora"`, `"save"`).
  - `classType?: string`: Look up exact pin signature for a node class (e.g. `"KSampler"`, `"CheckpointLoaderSimple"`, `"VHS_VideoCombine"`).
  - `category?: string`: Filter by category (e.g. `"sampling"`, `"loaders"`, `"conditioning"`, `"image"`, `"3d"`, `"audio"`).
  - `outputOnly?: boolean`: List only terminal output nodes that save media.
- **When to use**: Call before writing a workflow graph to inspect exact input names, expected pin data types (`MODEL`, `LATENT`, `CONDITIONING`, `IMAGE`, `INT`, `FLOAT`), default values, and output pin names/indices.

### 3. `comfy_recipes`
Discovers and dynamically scaffolds canonical boilerplate workflows matching installed server models (e.g., Krea 2 Turbo NVFP4, Z-Image Turbo NVFP4, SDXL Base, Flux Schnell).
- **Actions**:
  - `list`: Discovers available recipes with descriptions, required models, categories, default parameters (`steps`, `cfg`, `sampler`, `scheduler`), and checks whether required models are installed.
  - `scaffold`: Builds a complete, validated, pre-wired workflow graph for the chosen recipe, bound to the server's installed model files, with optional automatic persistence (`saveName: "my_recipe.json"`).
- **When to use**: Whenever starting a task with a modern diffusion architecture to get a guaranteed-correct baseline without manually wiring nodes.

### 4. `comfy_validate`
Performs deep graph topology and data-type validation of an API workflow JSON object against live server node definitions.
- **Validates**:
  - Node class existence on target ComfyUI server.
  - Link integrity (`[sourceNodeId, outputPinIndex]` references existing source node).
  - Pin index bounds (`outputPinIndex < sourceDef.output.length`).
  - Pin data-type compatibility (e.g. connecting `MODEL` $\rightarrow$ `MODEL`, `LATENT` $\rightarrow$ `LATENT`).
  - Required inputs completeness.
  - Checkpoint, UNET, CLIP, and VAE model filename availability.
  - Output node presence.
- **Returns**: `{ valid: boolean, errors: string[], warnings: string[], detectedOutputs: string[], repairSuggestions: string[] }`.

### 5. `comfy_workflows`
Manages workflows in the server's workflow storage directory (`./workflows` by default).
- **Actions**:
  - `list`: Lists all available stored workflows with their editable slots and output nodes.
  - `inspect`: Deeply introspects a specific workflow's slots, node graph, and topology.
  - `save`: Persists a newly constructed or modified workflow JSON into storage with optional friendly slot mappings (`prompt`, `seed`, etc.).
  - `delete`: Removes a workflow and its companion sidecar from storage.

### 6. `comfy_generate`
Executes any workflow (saved catalog workflow or raw API JSON) and dispatches generation to ComfyUI.
- **Capabilities**:
  - Multi-candidate generation (`count: 1..10`) with configurable seed policies (`random`, `fixed`, `sequential`).
  - Live MCP sampling progress notifications (`notifications/progress`) streamed to the client when passing `_meta: { progressToken: "..." }`.
  - Friendly slot overrides (`prompt`, `negative_prompt`, `seed`, `width`, `height`, `steps`, `cfg`, `ckpt_name`) or explicit dot-notation paths (`"6.inputs.text"`).
  - Local image file attachments (attaches and uploads local images to graph nodes).
  - Multi-modal output collection (images, video/gif, audio, 3D meshes `.glb`/`.gltf`/`.obj`, custom files).
  - Automatic vision review image generation (single image or labeled multi-candidate contact sheet).

### 7. `comfy_inspect`
Performs visual inspection on generated artifacts without re-running the generation.
- **Modes**:
  - `contact_sheet`: Labeled grid of all candidates with seed numbers and candidate indices.
  - `image`: Single candidate image bounded to `maxDimension` (default 1024px).
  - `crop`: Region crop specified by `{ x, y, width, height }` (pixels or normalized 0.0–1.0 coordinates).
  - `compare`: Side-by-side juxtaposition of parent run vs child revision.
  - `original`: Raw local path and metadata.

### 8. `comfy_revise`
Branches a child run from an existing parent run with targeted prompt/slot changes while preserving parent lineage.
- **Arguments**:
  - `runId`: Parent run ID.
  - `prompt?`: Updated positive prompt.
  - `negativePrompt?`: Updated negative prompt.
  - `seedPolicy?`: `"keep"` (re-use exact parent seed), `"new"` (randomize), or specific integer seed.
  - `inputs?`: Additional slot or node overrides.
  - `note?`: Explanation of the revision for provenance.

### 9. `comfy_job`
Queries real-time status, synchronously waits with timeout, or cancels running/queued prompts by run ID or prompt ID.

---

## 3. Step-by-Step Agent Workflow & Verification Plan

Follow this 5-phase procedure when fulfilling creative tasks for the user:

```text
Phase 1: Discover Environment ──► Phase 2: Schema Inspection ──► Phase 3: Build & Validate
                                                                           │
Phase 5: Visual Review & Revise ◄── Phase 4: Save & Execute ───────────────┘
```

### Phase 1: Discover Environment & Storage
1. Call `comfy_info` to verify connection, retrieve GPU VRAM capacity, check installed checkpoints, and see configured workflow directories.
2. Call `comfy_workflows` (action: `list`) to see existing templates.

### Phase 2: Discover Node Schemas
1. If authoring a new workflow or extending an existing one, call `comfy_nodes` with a `query` (e.g. `"sampler"`, `"hunyuan"`, `"video"`, `"upscale"`).
2. Call `comfy_nodes` with `classType: "TargetNodeClass"` to inspect the exact input names, expected pin data types, and output pin indices.

### Phase 3: Construct & Validate Graph JSON
1. Construct the API format workflow graph object where keys are node ID strings (`"1"`, `"2"`, `"3"`...) and each node contains:
   ```json
   {
     "class_type": "KSampler",
     "inputs": {
       "model": ["4", 0],
       "seed": 123456,
       "steps": 20,
       "cfg": 7.0,
       "sampler_name": "euler",
       "scheduler": "normal",
       "positive": ["6", 0],
       "negative": ["7", 0],
       "latent_image": ["5", 0]
     }
   }
   ```
2. Call `comfy_validate` with `{ workflow: customGraph }`.
3. If `valid: false`, check `errors` and `repairSuggestions` and adjust the graph until `valid: true`.

### Phase 4: Persist & Execute
1. (Optional) Call `comfy_workflows` (`action: "save"`, `name: "my_workflow.json"`, `workflow: customGraph`, `slots: { prompt: "6.inputs.text" }`) to store the workflow for reuse.
2. Call `comfy_generate` with the workflow and your prompt/overrides (`count: 1` or `count: 4`).
3. The tool result immediately returns the execution status, candidate URLs, and a vision-ready review image block.

### Phase 5: Visual Inspection & Revision Loop
1. Inspect the returned review image using your vision capabilities.
2. To inspect fine details (e.g. hands, faces, text, fine geometry), call `comfy_inspect` with `mode: "crop"` and coordinates (`{ x: 0.3, y: 0.2, width: 0.4, height: 0.4 }`).
3. To test a prompt or parameter tweak while keeping composition intact, call `comfy_revise` with `seedPolicy: "keep"`.
4. `comfy_revise` will return a side-by-side comparison image labeled with parent vs revision.

---

## 4. Canonical API Workflow Graph Examples

### Standard Text-to-Image Workflow

```json
{
  "3": {
    "class_type": "KSampler",
    "inputs": {
      "seed": 424242,
      "steps": 20,
      "cfg": 6.5,
      "sampler_name": "euler_ancestral",
      "scheduler": "karras",
      "denoise": 1.0,
      "model": ["4", 0],
      "positive": ["6", 0],
      "negative": ["7", 0],
      "latent_image": ["5", 0]
    }
  },
  "4": {
    "class_type": "CheckpointLoaderSimple",
    "inputs": {
      "ckpt_name": "sd_xl_base_1.0.safetensors"
    }
  },
  "5": {
    "class_type": "EmptyLatentImage",
    "inputs": {
      "width": 1024,
      "height": 1024,
      "batch_size": 1
    }
  },
  "6": {
    "class_type": "CLIPTextEncode",
    "inputs": {
      "text": "masterpiece, high quality portrait of an astronaut",
      "clip": ["4", 1]
    }
  },
  "7": {
    "class_type": "CLIPTextEncode",
    "inputs": {
      "text": "blurry, low quality, distorted",
      "clip": ["4", 1]
    }
  },
  "8": {
    "class_type": "VAEDecode",
    "inputs": {
      "samples": ["3", 0],
      "vae": ["4", 2]
    }
  },
  "9": {
    "class_type": "SaveImage",
    "inputs": {
      "filename_prefix": "AgentOutput",
      "images": ["8", 0]
    }
  }
}
```

### High-Fidelity Distilled / Turbo Workflow (Z-Image Turbo NVFP4)

> [!IMPORTANT]
> Distilled/Turbo models (like `z_image_turbo_nvfp4.safetensors`) require **`cfg: 1.0`**, **`steps: 8`**, `sampler_name: "res_multistep"`, `scheduler: "simple"`, and **`ConditioningZeroOut`** on the negative conditioning. Higher CFG or step counts will overbake/burn the latents.

```json
{
  "1": {
    "class_type": "UNETLoader",
    "inputs": {
      "unet_name": "z_image_turbo_nvfp4.safetensors",
      "weight_dtype": "default"
    }
  },
  "2": {
    "class_type": "ModelSamplingAuraFlow",
    "inputs": {
      "shift": 3.0,
      "model": ["1", 0]
    }
  },
  "3": {
    "class_type": "CLIPLoader",
    "inputs": {
      "clip_name": "qwen_3_4b.safetensors",
      "type": "lumina2",
      "device": "default"
    }
  },
  "4": {
    "class_type": "VAELoader",
    "inputs": {
      "vae_name": "ae.safetensors"
    }
  },
  "5": {
    "class_type": "CLIPTextEncode",
    "inputs": {
      "text": "Dramatic studio portrait, ultra-realistic...",
      "clip": ["3", 0]
    }
  },
  "6": {
    "class_type": "ConditioningZeroOut",
    "inputs": {
      "conditioning": ["5", 0]
    }
  },
  "7": {
    "class_type": "EmptySD3LatentImage",
    "inputs": {
      "width": 1024,
      "height": 1024,
      "batch_size": 1
    }
  },
  "8": {
    "class_type": "KSampler",
    "inputs": {
      "seed": 314795221153419,
      "steps": 8,
      "cfg": 1.0,
      "sampler_name": "res_multistep",
      "scheduler": "simple",
      "denoise": 1.0,
      "model": ["2", 0],
      "positive": ["5", 0],
      "negative": ["6", 0],
      "latent_image": ["7", 0]
    }
  },
  "9": {
    "class_type": "VAEDecode",
    "inputs": {
      "samples": ["8", 0],
      "vae": ["4", 0]
    }
  },
  "10": {
    "class_type": "SaveImage",
    "inputs": {
      "filename_prefix": "z-image-turbo",
      "images": ["9", 0]
    }
  }
}
```

```

### Krea2 Turbo NVFP4 Workflow (High-Fidelity Photorealism)

> [!TIP]
> **Krea2 Turbo** excels at organic natural light, photographic color balance, subsurface skin scattering, and complex physical compositions. It uses `qwen3_vl_4b_nvfp4_full.safetensors` (`type: "krea2"`), `ConditioningKrea2Rebalance`, `krea2RealVae_v10.safetensors`, and the specialized `beta57` scheduler with `euler`.

```json
{
  "29": {
    "class_type": "SaveImage",
    "inputs": {
      "filename_prefix": "Krea2_turbo",
      "images": ["57", 0]
    }
  },
  "54": {
    "class_type": "CLIPTextEncode",
    "inputs": {
      "text": "ultra realistic portrait...",
      "clip": ["74", 0]
    }
  },
  "55": {
    "class_type": "EmptyLatentImage",
    "inputs": {
      "width": 1024,
      "height": 1024,
      "batch_size": 1
    }
  },
  "56": {
    "class_type": "KSampler",
    "inputs": {
      "seed": 1018287161243782,
      "steps": 8,
      "cfg": 1.0,
      "sampler_name": "euler",
      "scheduler": "beta57",
      "denoise": 1.0,
      "model": ["58", 0],
      "positive": ["72", 0],
      "negative": ["59", 0],
      "latent_image": ["55", 0]
    }
  },
  "57": {
    "class_type": "VAEDecode",
    "inputs": {
      "samples": ["56", 0],
      "vae": ["75", 0]
    }
  },
  "58": {
    "class_type": "UNETLoader",
    "inputs": {
      "unet_name": "krea2TurboOfficialComfy_krea2TurboNvfp4.safetensors",
      "weight_dtype": "default"
    }
  },
  "59": {
    "class_type": "ConditioningZeroOut",
    "inputs": {
      "conditioning": ["54", 0]
    }
  },
  "72": {
    "class_type": "ConditioningKrea2Rebalance",
    "inputs": {
      "multiplier": 3.0,
      "per_layer_weights": "1.0,1.0,1.0,1.0,1.0,1.0,1.0,2.5,5.0,1.1,4.0,1.0",
      "conditioning": ["54", 0]
    }
  },
  "74": {
    "class_type": "CLIPLoader",
    "inputs": {
      "clip_name": "qwen3_vl_4b_nvfp4_full.safetensors",
      "type": "krea2",
      "device": "default"
    }
  },
  "75": {
    "class_type": "VAELoader",
    "inputs": {
      "vae_name": "krea2RealVae_v10.safetensors"
    }
  }
}
```

---

## 5. Model Architecture & Quality Comparison: Z-Image vs Krea2

| Feature / Trait | **Z-Image Turbo NVFP4** | **Krea2 Turbo NVFP4** |
| :--- | :--- | :--- |
| **Aesthetic Strength** | Dramatic studio lighting, high-contrast chiaroscuro, editorial fashion, black & white portraits | Natural daylight, warm photographic color grading, soft subsurface skin scattering, complex multi-subject interactions |
| **Model UNET** | `z_image_turbo_nvfp4.safetensors` | `krea2TurboOfficialComfy_krea2TurboNvfp4.safetensors` |
| **Sampling Adapter** | `ModelSamplingAuraFlow` (`shift: 3.0`) | Native UNET flow (no shift adapter needed) |
| **Text Encoder (CLIP)** | `qwen_3_4b.safetensors` (`type: "lumina2"`) | `qwen3_vl_4b_nvfp4_full.safetensors` (`type: "krea2"`) |
| **Conditioning** | Direct text conditioning + `ConditioningZeroOut` | `ConditioningKrea2Rebalance` (layerwise attention scaling) + `ConditioningZeroOut` |
| **Scheduler & Sampler** | `res_multistep` with `simple` scheduler | `euler` with `beta57` scheduler |
| **VAE** | `ae.safetensors` (16-channel SD3/Flux latent space) | `krea2RealVae_v10.safetensors` with `EmptyLatentImage` |
| **Optimal Settings** | `steps: 8`, `cfg: 1.0`, `denoise: 1.0` | `steps: 8`, `cfg: 1.0`, `denoise: 1.0` |

---

## 6. Agent Best Practices & Rules

1. **API Prompt Format Only**: Always produce API format JSON (node IDs as keys with `class_type` and `inputs`). Never output UI format JSON (with `nodes` and `links` arrays).
2. **Never Guess Node Names**: Custom node names vary between ComfyUI installations. Use `comfy_nodes` with `query` to find the exact class name and input names.
3. **Verify Link Indices**: Links are represented as `[sourceNodeIdString, outputIndexInt]`. Output indices are 0-based.
4. **Distilled Model Guidance Rule**: For distilled NVFP4 / Turbo models, **always keep `cfg: 1.0`** and use `ConditioningZeroOut` to prevent guidance burn and overbaked contrast.
5. **Scheduler Matching**: Match the exact scheduler (`beta57` for Krea2, `simple` for Z-Image AuraFlow) for artifact-free 8-step sampling.
6. **Use Fixed Seeds for Targeted Tweaks**: Use `comfy_revise` with `seedPolicy: "keep"` when iterating prompts.
7. **Inspect Crops Before Re-Generating**: Use `comfy_inspect` (`mode: "crop"`) to inspect fine textures before re-running.
