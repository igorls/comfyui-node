/**
 * Published package smoke test (Bun auto-install friendly).
 *
 * Goal: Verify the published comfyui-node package works when consumed in a totally fresh directory
 * using Bun's auto-install / autoimport capability (no manual `bun add` beforehand).
 *
 * Usage (from an empty folder outside the repo):
 *   curl -o published-e2e.ts https://raw.githubusercontent.com/igorls/comfyui-node/main/scripts/published-e2e.ts
 *   # (Optionally fetch a workflow json, but we embed a minimal one here.)
 *   COMFY_HOST=http://localhost:8188 bun run published-e2e.ts
 *
 * Environment Variables:
 *   COMFY_HOST            Base URL to ComfyUI (default http://127.0.0.1:8188)
 *   COMFY_MODEL           Override checkpoint name (default SDXL/sd_xl_base_1.0.safetensors)
 *   COMFY_POSITIVE_PROMPT Positive prompt text override
 *   COMFY_NEGATIVE_PROMPT Negative prompt text override
 *   COMFY_SEED            Force a specific seed (default random)
 *   COMFY_STEPS           Sampling steps (default 8)
 *   COMFY_CFG             CFG scale (default 2)
 *   COMFY_SAMPLER         Sampler name (default dpmpp_sde)
 *   COMFY_SCHEDULER       Scheduler (default sgm_uniform)
 *   COMFY_TIMEOUT_MS      Overall timeout in ms (default 120000)
 *   COMFY_UPSCALE         If set (any value), run an upscale branch (requires RealESRGAN model present)
 *   COMFY_E2E_POOL        If set, run the workflow through a ComfyPool + CallWrapper for streaming previews/progress
 *
 * Exit Codes:
 *   0 success (image generated, optionally upscaled)
 *   1 missing dependency / dynamic import failure
 *   2 timeout
 *   3 workflow enqueue error
 *   4 unknown runtime error
 *   5 strict monitoring error (COMFY_MONITOR_STRICT enabled)
 */

// Use dynamic import so Bun auto-installs on first run OR allow local dev override via COMFY_LOCAL.
// COMFY_LOCAL values:
//   src  -> import from ../src/index.ts (ts-node-esque; requires ts features supported by Bun)
//   dist -> import from ../dist/index.js (built output without publishing)
//   (unset/default) -> import "comfyui-node" (published package / self package name)
let ComfyApi: typeof import("comfyui-node").ComfyApi;
let ComfyPool: typeof import("comfyui-node").ComfyPool;
let CallWrapper: typeof import("comfyui-node").CallWrapper;
let PromptBuilder: typeof import("comfyui-node").PromptBuilder;
let seedFn: typeof import("comfyui-node").seed;
const localMode = process.env.COMFY_LOCAL?.trim();
async function loadLib() {
  if (localMode === 'src') {
    return import(new URL('../src/index.ts', import.meta.url).href);
  } else if (localMode === 'dist') {
    return import(new URL('../dist/index.js', import.meta.url).href);
  }
  try {
    return await import("comfyui-node");
  } catch (e) {
    // If not published yet, try dist then src as progressive fallbacks automatically.
    try {
      return await import(new URL('../dist/index.js', import.meta.url).href);
    } catch {}
    try {
      return await import(new URL('../src/index.ts', import.meta.url).href);
    } catch {}
    throw e;
  }
}
try {
  const lib: any = await loadLib();
  ComfyApi = lib.ComfyApi;
  ComfyPool = lib.ComfyPool;
  CallWrapper = lib.CallWrapper;
  PromptBuilder = lib.PromptBuilder;
  seedFn = lib.seed;
  if (localMode) {
    console.log(`[published-e2e] COMFY_LOCAL=${localMode} using local source`);
  }
} catch (e) {
  console.error("[published-e2e] Failed to resolve comfyui-node library (published or local)");
  console.error(e);
  process.exit(1);
}

function env(name: string, fallback: string): string {
  return process.env[name] && process.env[name]!.trim() !== "" ? process.env[name]! : fallback;
}

// Configuration from env
const HOST = env("COMFY_HOST", "http://127.0.0.1:8188");
const MODEL = env("COMFY_MODEL", "oneObsession_17RED.safetensors");
const POSITIVE = env("COMFY_POSITIVE_PROMPT", "perfect crystal ball with galaxy inside, intricate, detailed, sharp focus, vibrant colors, artstation");
const NEGATIVE = env("COMFY_NEGATIVE_PROMPT", "text, watermark, error, blurry, deformed, ugly, duplicate, morbid, mutilated, mutation, mutated, out of frame, extra fingers, multiple faces, multiple body, fused fingers, too many fingers, long neck, ugly eyes, bad proportions, cloned face, disfigured, gross proportions, malformed limbs, missing arms, missing legs, extra arms, extra legs, fused limbs, mutated hands and fingers");
const SAMPLER = env("COMFY_SAMPLER", "dpmpp_sde");
const SCHEDULER = env("COMFY_SCHEDULER", "sgm_uniform");
const TIMEOUT_MS = parseInt(env("COMFY_TIMEOUT_MS", "120000"), 10);
const STEPS = parseInt(env("COMFY_STEPS", "8"), 20);
const CFG = parseFloat(env("COMFY_CFG", "2"));
const FORCE_SEED = process.env.COMFY_SEED ? BigInt(process.env.COMFY_SEED) : null;
const DO_UPSCALE = !!process.env.COMFY_UPSCALE;
const MONITOR_ENABLE = !!process.env.COMFY_MONITOR; // if true attempt to enable monitoring feature
const MONITOR_STRICT = !!process.env.COMFY_MONITOR_STRICT; // if true, treat missing events as failure (exit 5)
// Extend monitoring env configuration
const MONITOR_GRACE_MS = parseInt(env("COMFY_MONITOR_GRACE_MS", "3000"), 10); // wait after outputs for late events
const MONITOR_FORCE = !!process.env.COMFY_MONITOR_FORCE; // treat unsupported as failure when monitor requested
const USE_POOL = !!process.env.COMFY_E2E_POOL; // route execution through ComfyPool + CallWrapper

// Build workflow similar to repo test/example but allow overrides.
// Node IDs are arbitrary; we keep them stable for easier debugging.
function buildWorkflow(seed: bigint): Record<string, any> {
  const wf: Record<string, any> = {
    "3": {
      "inputs": {
        seed: Number(seed % BigInt(Number.MAX_SAFE_INTEGER)),
        steps: STEPS,
        cfg: CFG,
        sampler_name: SAMPLER,
        scheduler: SCHEDULER,
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0]
      },
      "class_type": "KSampler"
    },
    "4": {
      "inputs": { ckpt_name: MODEL },
      "class_type": "CheckpointLoaderSimple"
    },
    "5": {
      "inputs": { width: 512, height: 512, batch_size: 1 },
      "class_type": "EmptyLatentImage"
    },
    "6": {
      "inputs": { text: POSITIVE, clip: ["4", 1] },
      "class_type": "CLIPTextEncode"
    },
    "7": {
      "inputs": { text: NEGATIVE, clip: ["4", 1] },
      "class_type": "CLIPTextEncode"
    },
    "8": {
      "inputs": { samples: ["3", 0], vae: ["4", 2] },
      "class_type": "VAEDecode"
    },
    "9": {
      "inputs": { filename_prefix: "ComfyUI", images: ["8", 0] },
      "class_type": "SaveImage"
    }
  };

  if (DO_UPSCALE) {
    // Add upscale branch replicating example nodes 10-12
    wf["10"] = {
      inputs: { model_name: "RealESRGAN_x4plus.safetensors" },
      class_type: "UpscaleModelLoader"
    };
    wf["11"] = {
      inputs: { upscale_model: ["10", 0], image: ["8", 0] },
      class_type: "ImageUpscaleWithModel"
    };
    wf["12"] = {
      inputs: { filename_prefix: "ComfyUI", images: ["11", 0] },
      class_type: "SaveImage"
    };
  }

  return wf;
}

function hr(ms: number) { return `${(ms/1000).toFixed(2)}s`; }

async function main() {
  const seedVal = FORCE_SEED ?? BigInt(seedFn());
  console.log(`[published-e2e] Using seed: ${seedVal}`);
  console.log(`[published-e2e] Host: ${HOST}`);
  console.log(`[published-e2e] Model: ${MODEL}`);
  if (DO_UPSCALE) console.log(`[published-e2e] Upscale branch ENABLED`);

  const api = new ComfyApi(HOST, undefined, { listenTerminal: false });

  const timeoutAbort = new AbortController();
  const timeout = setTimeout(() => {
    timeoutAbort.abort();
  }, TIMEOUT_MS);

  const start = Date.now();
  try {
    await api.init();
    await api.waitForReady();
  } catch (e) {
    console.error("[published-e2e] Failed to init client", e);
    process.exit(4);
  }
  console.log(`[published-e2e] Client ready in ${hr(Date.now() - start)}`);

  // Listen to status events for progress summary
  let lastStatus: any = null;
  api.on("status", (ev) => {
    lastStatus = ev.detail;
  });

  // Distinguish between two kinds of "monitoring":
  // 1) System monitoring (Crystools extension) => COMFY_MONITOR / *_STRICT flags below (CPU/GPU stats)
  // 2) Job progress monitoring (native ComfyUI executing/progress events) => always enabled; optional verbose logging via COMFY_PROGRESS_VERBOSE
  //
  // System monitoring events
  let monitorEvents = 0;
  if (MONITOR_ENABLE) {
    if (api.ext.monitor && (api.ext.monitor as any).supported) {
      try {
        await api.ext.monitor.switch(true);
      } catch { /* ignore */ }
      api.ext.monitor.on("system_monitor" as any, (ev: any) => {
        monitorEvents++;
        if (monitorEvents === 1) {
          console.log(`[published-e2e] Received first system_monitor event:`, {
            cpu: ev.detail.cpu_utilization,
            ram_used_percent: ev.detail.ram_used_percent,
            gpus: ev.detail.gpus?.length || 0
          });
        }
      });
    } else {
      console.warn("[published-e2e] Monitoring feature not supported on server (Crystools extension absent?)");
    }
  }

  const workflow = buildWorkflow(seedVal);

  // Job progress + preview tracking (common fields)
  const progressVerbose = !!process.env.COMFY_PROGRESS_VERBOSE;
  let progressUpdates = 0;
  let lastPctLogged = -1;
  let previewFrames = 0;
  let outputs: any = null;
  let promptId: string | null = null;

  if (!USE_POOL) {
    // Direct enqueue + poll mode (legacy baseline)
    try {
      const enqueueResp: any = await api.ext.queue.appendPrompt(workflow);
      promptId = (enqueueResp && (enqueueResp.prompt_id || enqueueResp.promptId)) ?? null;
      console.log(`[published-e2e] Enqueued prompt id: ${promptId}`);
    } catch (e: any) {
      console.error("[published-e2e] Failed to enqueue workflow", e);
      process.exit(3);
    }
    if (!promptId) {
      console.error("[published-e2e] No prompt id returned");
      process.exit(3);
    }
    api.on("progress", (ev: any) => {
      if (!promptId || ev.detail.prompt_id !== promptId) return;
      progressUpdates++;
      if (typeof ev.detail.value === "number" && typeof ev.detail.max === "number" && ev.detail.max > 0) {
        const pct = Math.floor((ev.detail.value / ev.detail.max) * 100);
        if (progressVerbose || pct !== lastPctLogged) {
          console.log(`[published-e2e] progress: ${ev.detail.value}/${ev.detail.max} (${pct}%)`);
          lastPctLogged = pct;
        }
      } else if (progressVerbose) {
        console.log(`[published-e2e] progress event`, ev.detail);
      }
    });
    api.on("b_preview", () => { previewFrames++; });

    // Wait loop for completion
    const pollStart = Date.now();
    const POLL_INTERVAL = 1500;
    while (!timeoutAbort.signal.aborted) {
      try {
        const histEntry: any = await api.ext.history.getHistory(promptId);
        if (histEntry && histEntry.outputs) {
          outputs = histEntry.outputs;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    }
    clearTimeout(timeout);
    if (!outputs) {
      console.error(`[published-e2e] Timeout after ${hr(Date.now() - pollStart)} waiting for outputs`);
      process.exit(2);
    }
  } else {
    console.log('[published-e2e] Pool mode ENABLED (COMFY_E2E_POOL)');
    // Build PromptBuilder for CallWrapper mapping
    const builder = new PromptBuilder(workflow, [], [DO_UPSCALE ? 'final_out' : 'primary_out']);
    // Map primary save node (9) to output key; if upscale branch used, also map 12
    builder.setOutputNode(DO_UPSCALE ? 'primary_out' : 'primary_out', DO_UPSCALE ? '9' : '9');
    if (DO_UPSCALE) builder.setOutputNode('final_out', '12');

    const pool = new ComfyPool([api]);
    // Wait a short grace so pool registers client status
    await new Promise(r => setTimeout(r, 50));

    let finished = false;
    let wrapperPromptId: string | undefined;
    const wrapper = new CallWrapper(api as any, builder)
      .onProgress((info, pid) => {
        wrapperPromptId = pid;
        progressUpdates++;
        if (typeof info.value === 'number' && typeof info.max === 'number' && info.max > 0) {
          const pct = Math.floor((info.value / info.max) * 100);
          if (progressVerbose || pct !== lastPctLogged) {
            console.log(`[published-e2e] progress: ${info.value}/${info.max} (${pct}%)`);
            lastPctLogged = pct;
          }
        }
      })
      .onPreview(() => { previewFrames++; })
      .onPending((pid) => { promptId = pid || null; console.log(`[published-e2e] Pending prompt id: ${promptId}`); })
      .onStart((pid) => { if (pid) console.log(`[published-e2e] Started execution: ${pid}`); })
      .onOutput((key, data) => { /* could log node outputs incrementally if verbose */ })
      .onFinished((data, pid) => { finished = true; outputs = data._raw || {}; promptId = pid || promptId; })
      .onFailed((err) => { console.error('[published-e2e] Pool/Wrapper failure', err); process.exit(3); });

    // Execute via pool.run for symmetry / future multi-client extension
    try {
      await pool.run(async () => {
        await wrapper.run();
      });
    } finally {
      pool.destroy();
    }
    clearTimeout(timeout);
    if ((!outputs || Object.keys(outputs).length === 0) && promptId) {
      // Fallback: fetch history outputs (some servers may not emit executed output for SaveImage immediately)
      try {
        const hist = await api.ext.history.getHistory(promptId);
        if (hist?.outputs) {
          outputs = hist.outputs;
        }
      } catch {}
    }
    if (!finished || !outputs || Object.keys(outputs).length === 0) {
      console.error('[published-e2e] Wrapper did not produce outputs');
      process.exit(2);
    }
  }

  // Extract image file names
  const imageFiles: string[] = [];
  for (const nodeId of Object.keys(outputs)) {
    const arr = outputs[nodeId]?.images;
    if (Array.isArray(arr)) {
      for (const img of arr) {
        if (img?.filename) imageFiles.push(img.filename);
      }
    }
  }

  console.log(`[published-e2e] Generated ${imageFiles.length} image(s)`);
  console.log(`[published-e2e] Job progress updates: ${progressUpdates}, preview frames: ${previewFrames}${USE_POOL ? ' (pool mode)' : ''}`);
  imageFiles.forEach((f) => {
    const url = `${HOST}/view?filename=${encodeURIComponent(f)}&type=output`;
    console.log(`  - ${f}`);
    console.log(`    ${url}`);
  });

  if (lastStatus) {
    console.log(`[published-e2e] Final queue status:`, {
      queue_remaining: lastStatus.exec_info?.queue_remaining,
      queue_running: lastStatus.exec_info?.queue_running
    });
  }

  if (MONITOR_ENABLE) {
    if (!(api.ext.monitor && (api.ext.monitor as any).supported)) {
      const msg = "[published-e2e] Monitoring unsupported on server";
      if (MONITOR_FORCE || MONITOR_STRICT) {
        console.error(msg + " (force/strict -> failing)");
        process.exit(5);
      } else {
        console.warn(msg + " (continuing)");
      }
    } else {
      // If no events yet, allow a short grace window.
      if (monitorEvents === 0 && MONITOR_GRACE_MS > 0) {
        console.log(`[published-e2e] Awaiting monitor events up to ${MONITOR_GRACE_MS}ms grace...`);
        const graceStart = Date.now();
        while (Date.now() - graceStart < MONITOR_GRACE_MS && monitorEvents === 0) {
          await new Promise(r => setTimeout(r, 250));
        }
      }
      if (monitorEvents === 0) {
        const msg = "[published-e2e] No system_monitor events received";
        if (MONITOR_STRICT) {
          console.error(msg + " (strict mode -> failing)");
          process.exit(5);
        } else {
          console.warn(msg + " (non-strict -> continuing)");
        }
      } else {
        console.log(`[published-e2e] system_monitor events received: ${monitorEvents}`);
      }
    }
  }

  console.log(`[published-e2e] Success in ${hr(Date.now() - start)}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[published-e2e] Uncaught error", e);
  process.exit(4);
});

// Make this file a module for top-level await in TypeScript strict mode
export {};
