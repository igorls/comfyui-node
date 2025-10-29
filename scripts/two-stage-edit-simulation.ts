import { Blob } from "buffer";
import { ComfyApi, Workflow } from "../src/index.ts";
import GenerationGraph from "./workflows/T2I-anime-nova-xl.json" assert { type: "json" };
import EditGraph from "./workflows/quick-edit-test.json" assert { type: "json" };
import { delay } from "../src/tools.ts";

/**
 * Two-stage workflow simulation:
 *  1. Generate an image with the Anime Nova workflow using a random prompt.
 *  2. Upload the result and run the Quick Edit workflow with a random edit instruction.
 *
 * Designed to stress heterogeneous clusters: if a host cannot run the generation
 * workflow (missing models, etc.), it is skipped for future generation runs but
 * still participates in edit runs if possible.
 */

const DEFAULT_HOSTS = [
  "http://afterpic-comfy-igor:8188",
  "http://afterpic-comfy-aero16:8188",
  "http://afterpic-comfy-domi:8188"
];

const hosts = process.env.TWO_STAGE_HOSTS
  ? process.env.TWO_STAGE_HOSTS.split(",")
      .map((h) => h.trim())
      .filter(Boolean)
  : DEFAULT_HOSTS;

if (hosts.length === 0) {
  console.error("No hosts configured. Provide TWO_STAGE_HOSTS or ensure defaults are reachable.");
  process.exit(1);
}

const runtimeMs = Number.isFinite(Number(process.env.TWO_STAGE_RUNTIME_MS))
  ? Number(process.env.TWO_STAGE_RUNTIME_MS)
  : 6 * 60 * 60 * 1000; // 6 hours

let minDelayMs = Number.isFinite(Number(process.env.TWO_STAGE_MIN_DELAY_MS))
  ? Number(process.env.TWO_STAGE_MIN_DELAY_MS)
  : 5_000; // 5 seconds

let maxDelayMs = Number.isFinite(Number(process.env.TWO_STAGE_MAX_DELAY_MS))
  ? Number(process.env.TWO_STAGE_MAX_DELAY_MS)
  : 1 * 60_000; // 4 minutes

if (minDelayMs > maxDelayMs) {
  console.warn(`Swapping min/max delay: ${minDelayMs} > ${maxDelayMs}`);
  const tmp = minDelayMs;
  minDelayMs = maxDelayMs;
  maxDelayMs = tmp;
}

const generationPrompts = (process.env.TWO_STAGE_GEN_PROMPTS || "")
  .split("||")
  .map((s) => s.trim())
  .filter(Boolean);

if (generationPrompts.length === 0) {
  generationPrompts.push(
    "cinematic portrait of a spacefarer gazing at a nebula, vibrant color arcs, anime shading",
    "lush forest clearing at dawn with crystalline waterfalls and ethereal wildlife, anime art",
    "retro-futuristic city skyline at sunset, hovering ships and neon reflections, anime style",
    "battle-ready mage summoning luminous glyphs, dramatic pose, detailed anime illustration"
  );
}

const generationNegatives = (process.env.TWO_STAGE_GEN_NEGATIVES || "")
  .split("||")
  .map((s) => s.trim())
  .filter(Boolean);

if (generationNegatives.length === 0) {
  generationNegatives.push(
    "lowres, blurry, bad anatomy, extra limbs, watermark, text, signature",
    "poor lighting, washed out colors, distorted perspective, nsfw",
    "cropped face, missing fingers, artifacts, posterization"
  );
}

const editPrompts = (process.env.TWO_STAGE_EDIT_PROMPTS || "")
  .split("||")
  .map((s) => s.trim())
  .filter(Boolean);

if (editPrompts.length === 0) {
  editPrompts.push(
    "Shift to a nighttime scene with glowing lanterns and gentle rain, add reflective puddles",
    "Transform into a winter landscape with snowfall and frosted trees, keep main subject",
    "Reimagine as a bustling cyberpunk alley filled with holographic signs and neon rain",
    "Convert the environment to a tranquil seaside at sunrise with warm golden lighting"
  );
}

const seedStrategy = (process.env.TWO_STAGE_SEED_STRATEGY || "random").toLowerCase();

function log(...args: any[]) {
  // eslint-disable-next-line no-console
  console.log(`[${new Date().toISOString()}]`, ...args);
}

function randomInt(min: number, max: number) {
  const floorMin = Math.ceil(min);
  const floorMax = Math.floor(max);
  return Math.floor(Math.random() * (floorMax - floorMin + 1)) + floorMin;
}

function pickRandom<T>(list: T[]): T {
  return list[randomInt(0, list.length - 1)];
}

function nextSeed() {
  if (seedStrategy === "auto") return -1;
  if (seedStrategy === "fixed") return 42;
  return randomInt(0, 2_147_483_647);
}

function clone<T>(obj: T): T {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(obj);
  }
  return JSON.parse(JSON.stringify(obj));
}

function buildGenerationWorkflow(prompt: string, negative: string, seed: number) {
  const wf = Workflow.from(clone(GenerationGraph));
  wf.set("1.inputs.value", prompt)
    .set("2.inputs.value", negative)
    .set("10.inputs.seed", seed)
    .output("base_preview", "12");
  return wf;
}

function buildEditWorkflow(imageName: string, editPrompt: string, seed: number) {
  const wf = Workflow.from(clone(EditGraph));
  wf.set("91.inputs.prompt", editPrompt).set("51.inputs.seed", seed).set("97.inputs.image", imageName).output("207");
  return wf;
}

interface HostStats {
  host: string;
  client: ComfyApi;
  generationCapable: boolean;
  generationRuns: number;
  generationSuccess: number;
  editRuns: number;
  editSuccess: number;
  failures: number;
  disconnects: number;
}

async function main() {
  log("Two-stage edit simulation starting", {
    hosts,
    runtimeHours: runtimeMs / 3_600_000,
    minDelayMs,
    maxDelayMs,
    seedStrategy
  });

  const endTime = Date.now() + runtimeMs;
  const stats: HostStats[] = [];

  for (const host of hosts) {
    const client = new ComfyApi(host, undefined, { wsTimeout: maxDelayMs * 2, debug: false });
    await client.ready();
    const entry: HostStats = {
      host,
      client,
      generationCapable: true,
      generationRuns: 0,
      generationSuccess: 0,
      editRuns: 0,
      editSuccess: 0,
      failures: 0,
      disconnects: 0
    };
    client.on("disconnected", () => {
      entry.disconnects += 1;
      log(`⚠️  Disconnected: ${host}`);
    });
    client.on("reconnected", () => {
      log(`✅ Reconnected: ${host}`);
    });
    stats.push(entry);
  }

  try {
    let triggerImmediateNextCycle = true;
    while (Date.now() < endTime) {
      if (stats.every((s) => !s.generationCapable)) {
        log("No generation-capable hosts remaining. Exiting early.");
        break;
      }

      if (!triggerImmediateNextCycle) {
        const waitMs = randomInt(minDelayMs, maxDelayMs);
        log(`Waiting ${Math.round(waitMs / 1000)}s before next cycle`);
        await delay(waitMs);
        if (Date.now() >= endTime) break;
      } else {
        log("Starting first cycle immediately");
      }

      triggerImmediateNextCycle = false;

      const hostEntry = pickRandom(stats.filter((s) => s.generationCapable));
      const client = hostEntry.client;
      const genPrompt = pickRandom(generationPrompts);
      const genNegative = pickRandom(generationNegatives);
      const genSeed = nextSeed();

      hostEntry.generationRuns += 1;
      log(`▶️  [${hostEntry.host}] Generation run #${hostEntry.generationRuns} seed=${genSeed}`);

      let imageRecord: { filename?: string; subfolder?: string; type?: string } | undefined;
      try {
        const genWorkflow = buildGenerationWorkflow(genPrompt, genNegative, genSeed);
        const job = await client.run(genWorkflow, { includeOutputs: ["12"], autoDestroy: false });
        job.on("failed", (err) => log(`❌ Generation failed (event) on ${hostEntry.host}`, err));
        const result = await job.done();
        const preview = (result as any).base_preview ?? (result as any)["12"];
        const records = Array.isArray(preview?.images)
          ? preview.images
          : Array.isArray(preview)
            ? preview
            : preview
              ? [preview]
              : [];
        if (!records.length) {
          throw new Error("Generation workflow returned no images");
        }
        imageRecord = records[0];
        hostEntry.generationSuccess += 1;
        const promptId = (result as any)?._promptId;
        log(`✅ [${hostEntry.host}] Generation succeeded promptId=${promptId ?? "n/a"}`);
      } catch (error: any) {
        hostEntry.failures += 1;
        const message = String(error?.message || error);
        const detailBlob = JSON.stringify(error?.bodyJSON ?? error ?? {});
        const missingModel =
          /model/i.test(message) ||
          /checkpoint/i.test(message) ||
          /not found/i.test(message) ||
          /value_not_in_list/i.test(detailBlob) ||
          /ckpt_name/i.test(detailBlob);
        if (missingModel) {
          hostEntry.generationCapable = false;
          log(`⚠️  Marking ${hostEntry.host} as generation-incapable (${message})`);
        } else {
          log(`❌ Generation error on ${hostEntry.host}`, error);
        }
        triggerImmediateNextCycle = true;
        continue; // Skip edit stage on failure
      }

      if (!imageRecord?.filename) {
        log(`⚠️  Missing filename in generation output for ${hostEntry.host}, skipping edit.`);
        triggerImmediateNextCycle = true;
        continue;
      }

      const imageUrl = hostEntry.client.ext.file.getPathImage(imageRecord as any);
      const uploadName = `two-stage-${Date.now()}-${Math.random().toString(16).slice(2)}.png`;
      try {
        const fetchFn = globalThis.fetch?.bind(globalThis);
        if (!fetchFn) {
          throw new Error("fetch is not available in this runtime");
        }
        const response = await fetchFn(imageUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch generated image: ${response.status} ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const blob = new Blob([arrayBuffer]);
        await hostEntry.client.ext.file.uploadImage(blob, uploadName, { overwrite: true });
        log(`⬆️  Uploaded generated image to ${uploadName} for edit step`);
      } catch (uploadError) {
        hostEntry.failures += 1;
        log(`❌ Failed to prepare image for edit on ${hostEntry.host}`, uploadError);
        triggerImmediateNextCycle = true;
        continue;
      }

      const editPrompt = pickRandom(editPrompts);
      const editSeed = nextSeed();
      hostEntry.editRuns += 1;
      log(`✏️  [${hostEntry.host}] Edit run #${hostEntry.editRuns} seed=${editSeed}`);

      try {
        const editWorkflow = buildEditWorkflow(uploadName, editPrompt, editSeed);
        const job = await hostEntry.client.run(editWorkflow, { includeOutputs: ["207"], autoDestroy: false });
        job.on("failed", (err) => log(`❌ Edit failed (event) on ${hostEntry.host}`, err));
        const result = await job.done();
        hostEntry.editSuccess += 1;
        const promptId = (result as any)?._promptId;
        log(`✅ [${hostEntry.host}] Edit succeeded promptId=${promptId ?? "n/a"}`);
      } catch (error) {
        hostEntry.failures += 1;
        log(`❌ Edit error on ${hostEntry.host}`, error);
        triggerImmediateNextCycle = true;
      }
    }
  } finally {
    log("Shutting down clients...");
    for (const entry of stats) {
      try {
        entry.client.destroy();
      } catch (error) {
        log(`Error destroying client for ${entry.host}`, error);
      }
    }
  }

  log(
    "Two-stage simulation complete",
    stats.map(({ client, ...rest }) => rest)
  );
  const totalFailures = stats.reduce((sum, s) => sum + s.failures, 0);
  const totalDisconnects = stats.reduce((sum, s) => sum + s.disconnects, 0);

  if (totalFailures > 0 || totalDisconnects > 0) {
    log("Summary:", { totalFailures, totalDisconnects });
    process.exitCode = 1;
  } else {
    log("Summary: no disconnects detected and all runs succeeded");
  }
}

main().catch((error) => {
  console.error("Fatal error during two-stage simulation", error);
  process.exit(1);
});
