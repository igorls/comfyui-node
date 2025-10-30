import { ComfyApi, WorkflowPool, JobRecord, hashWorkflow, WorkflowAffinity } from "../src/index.ts";
import GenerationGraph from "./workflows/T2I-anime-nova-xl.json" assert { type: "json" };
import EditGraph from "./workflows/quick-edit-test.json" assert { type: "json" };
import { delay } from "../src/tools.ts";
import { log, pickRandom, uploadImage, nextSeed, randomInt } from "./simulator/helpers.ts";
import { buildEditWorkflow, buildGenerationWorkflow } from "./simulator/workflows.ts";
import { waitForJob } from "./simulator/pool.ts";

const DEFAULT_HOSTS = [
  "http://afterpic-comfy-igor:8188",
  "http://afterpic-comfy-aero16:8188",
  "http://afterpic-comfy-domi:8188"
];

const GEN_HOST = "http://afterpic-comfy-aero16:8188";
const EDIT_HOSTS = ["http://afterpic-comfy-igor:8188", "http://afterpic-comfy-domi:8188"];

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
  : 0; // 5 seconds

let maxDelayMs = Number.isFinite(Number(process.env.TWO_STAGE_MAX_DELAY_MS))
  ? Number(process.env.TWO_STAGE_MAX_DELAY_MS)
  : 0; // 20 seconds

if (minDelayMs > maxDelayMs) {
  console.warn(`Swapping min/max delay: ${minDelayMs} > ${maxDelayMs}`);
  const tmp = minDelayMs;
  minDelayMs = maxDelayMs;
  maxDelayMs = tmp;
}

const concurrency = Number.isFinite(Number(process.env.TWO_STAGE_CONCURRENCY))
  ? Number(process.env.TWO_STAGE_CONCURRENCY)
  : 2;

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

const seedStrategy = (process.env.TWO_STAGE_SEED_STRATEGY || "random").toLowerCase() as "random" | "auto" | "fixed";

interface HostStats {
  host: string;
  clientId: string;
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
    seedStrategy,
    concurrency
  });

  const stats = new Map<string, HostStats>();
  const clients = hosts.map((host, i) => {
    const clientId = `host-${i}`;
    stats.set(clientId, {
      host,
      clientId,
      generationCapable: true,
      generationRuns: 0,
      generationSuccess: 0,
      editRuns: 0,
      editSuccess: 0,
      failures: 0,
      disconnects: 0
    });
    const client = new ComfyApi(host, clientId, { wsTimeout: maxDelayMs * 2, debug: false });
    client.on("disconnected", () => {
      const s = stats.get(clientId)!;
      s.disconnects += 1;
      log(`⚠️  Disconnected: ${s.host}`);
    });
    client.on("reconnected", () => {
      const s = stats.get(clientId)!;
      log(`✅ Reconnected: ${s.host}`);
    });
    return client;
  });

  await Promise.all(clients.map((c) => c.ready()));

  const genClientIds = Array.from(stats.values())
    .filter((s) => s.host === GEN_HOST)
    .map((s) => s.clientId);
  const editClientIds = Array.from(stats.values())
    .filter((s) => EDIT_HOSTS.includes(s.host))
    .map((s) => s.clientId);

  if (genClientIds.length === 0) {
    log(`❌ Generation host ${GEN_HOST} not found in the available hosts.`);
    process.exit(1);
  }
  if (editClientIds.length === 0) {
    log(`❌ No edit hosts found in the available hosts.`);
    process.exit(1);
  }

  const generationWorkflowHash = hashWorkflow(GenerationGraph);
  const editWorkflowHash = hashWorkflow(EditGraph);

  const affinities: WorkflowAffinity[] = [
    { workflowHash: generationWorkflowHash, preferredClientIds: genClientIds },
    { workflowHash: editWorkflowHash, preferredClientIds: editClientIds }
  ];

  // WorkflowPool uses selectivity-based job matching for optimal throughput:
  // - Jobs with fewer compatible clients (more selective) are assigned first
  // - This prevents idle clients in heterogeneous clusters
  // - Priority can also be set per job to override selectivity ordering
  const pool = new WorkflowPool(clients, { workflowAffinities: affinities });

  pool.on('job:completed', async (ev) => {
    const stats = await pool.getQueueStats();
    console.log('Queue stats after job completed:', stats);
  });

  log("WorkflowPool created with clients:", clients.map((c) => c.id));

  log("Affinities:", pool.getAffinities());

  const endTime = Date.now() + runtimeMs;

  try {
    const runWorker = async (workerId: number) => {
      log(`[Worker ${workerId}] Started`);
      let triggerImmediateNextCycle = true;

      while (Date.now() < endTime) {
        if (!triggerImmediateNextCycle) {
          const waitMs = randomInt(minDelayMs, maxDelayMs);
          log(`[Worker ${workerId}] Waiting ${Math.round(waitMs / 1000)}s before next cycle`);
          await delay(waitMs);
          if (Date.now() >= endTime) break;
        } else {
          log(`[Worker ${workerId}] Starting first cycle immediately`);
        }
        triggerImmediateNextCycle = false;

        // Generation Stage
        const genPrompt = pickRandom(generationPrompts);
        const genNegative = pickRandom(generationNegatives);
        const genSeed = nextSeed(seedStrategy);
        const genWorkflow = buildGenerationWorkflow(genPrompt, genNegative, genSeed);

        let imageRecord: { filename?: string; subfolder?: string; type?: string } | undefined;
        let genClient: ComfyApi | undefined;
        let genJobId: string;

        try {
          genJobId = await pool.enqueue(genWorkflow, { includeOutputs: ["12"] });
          const completedJob = await waitForJob(pool, genJobId);
          const clientId = completedJob.clientId;
          if (!clientId) throw new Error("Job completed without a client ID");

          genClient = clients.find((c) => c.id === clientId);
          if (!genClient) throw new Error(`Client ${clientId} not found`);

          const s = stats.get(clientId)!;
          s.generationRuns += 1;
          s.generationSuccess += 1;
          const promptId = (completedJob.result as any)?._promptId;
          log(`✅ [Worker ${workerId}] [${s.host}] Generation succeeded promptId=${promptId ?? "n/a"}`);

          const preview = (completedJob.result as any).base_preview ?? (completedJob.result as any)["12"];
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
        } catch (failedJob: any) {
          const clientId = (failedJob as JobRecord).clientId;
          if (clientId) {
            const s = stats.get(clientId)!;
            s.generationRuns += 1;
            s.failures += 1;
            log(`❌ [Worker ${workerId}] [${s.host}] Generation failed`, (failedJob as JobRecord).lastError);
          }
          triggerImmediateNextCycle = true;
          continue;
        }

        if (!imageRecord?.filename || !genClient) {
          log(`⚠️  [Worker ${workerId}] Missing filename or client from generation output, skipping edit.`);
          triggerImmediateNextCycle = true;
          continue;
        }

        // Edit Stage
        const targetEditClientId = pickRandom(editClientIds);
        const targetEditClient = clients.find((c) => c.id === targetEditClientId);

        if (!targetEditClient) {
          log(`⚠️  [Worker ${workerId}] Could not find an edit client to run on.`);
          triggerImmediateNextCycle = true;
          continue;
        }

        const imageUrl = genClient.ext.file.getPathImage(imageRecord as any);
        const uploadName = `two-stage-${Date.now()}-${Math.random().toString(16).slice(2)}.png`;
        try {
          await uploadImage(imageUrl, uploadName, targetEditClient);
          log(
            `⬆️  [Worker ${workerId}] Uploaded generated image to ${uploadName} for edit step to ${targetEditClient.id}`
          );
        } catch (uploadError) {
          const s = stats.get(targetEditClient.id)!;
          s.failures += 1;
          log(`❌ [Worker ${workerId}] Failed to prepare image for edit on ${s.host}`, uploadError);
          triggerImmediateNextCycle = true;
          continue;
        }

        const editPrompt = pickRandom(editPrompts);
        const editSeed = nextSeed(seedStrategy);
        const editWorkflow = buildEditWorkflow(uploadName, editPrompt, editSeed);
        // Enqueue with affinity to the specific edit client we uploaded the image to.
        const editJobId = await pool.enqueue(editWorkflow, {
          includeOutputs: ["207"],
          preferredClientIds: [targetEditClientId]
        });

        try {
          const completedJob = await waitForJob(pool, editJobId);
          const clientId = completedJob.clientId;
          if (!clientId) throw new Error("Job completed without a client ID");

          const s = stats.get(clientId)!;
          s.editRuns += 1;
          s.editSuccess += 1;
          const promptId = (completedJob.result as any)?._promptId;
          log(`✅ [Worker ${workerId}] [${s.host}] Edit succeeded promptId=${promptId ?? "n/a"}`);
        } catch (failedJob: any) {
          const clientId = (failedJob as JobRecord).clientId;
          if (clientId) {
            const s = stats.get(clientId)!;
            s.editRuns += 1;
            s.failures += 1;
            log(`❌ [Worker ${workerId}] [${s.host}] Edit failed`, (failedJob as JobRecord).lastError);
          }
          triggerImmediateNextCycle = true;
        }
      }
      log(`[Worker ${workerId}] Stopped`);
    };

    const workers = Array.from({ length: concurrency }, (_, i) => runWorker(i + 1));
    await Promise.all(workers);
  } finally {
    log("Shutting down clients...");
    pool.shutdown();
  }

  log("Two-stage simulation complete", Array.from(stats.values()));
  const totalFailures = Array.from(stats.values()).reduce((sum, s) => sum + s.failures, 0);
  const totalDisconnects = Array.from(stats.values()).reduce((sum, s) => sum + s.disconnects, 0);

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
