import { ComfyApi, Workflow, WorkflowPool } from "../src/index.ts";
import Graph from "./workflows/T2I-anime-nova-xl.json" assert { type: "json" };
import { delay } from "../src/tools.ts";

/**
 * Sparse usage simulator (WorkflowPool edition)
 *
 * Uses a shared WorkflowPool to keep clients connected while enqueueing jobs at
 * random intervals. Targets multi-hour soak tests for connection stability.
 */

const DEFAULT_HOSTS = ["http://afterpic-comfy-igor:8188", "http://afterpic-comfy-aero16:8188"];

const hosts = process.env.SPARSE_HOSTS
  ? process.env.SPARSE_HOSTS.split(",")
      .map((h) => h.trim())
      .filter(Boolean)
  : DEFAULT_HOSTS;

if (hosts.length === 0) {
  console.error("No hosts configured. Provide SPARSE_HOSTS or ensure defaults are reachable.");
  process.exit(1);
}

const runtimeMs = Number.isFinite(Number(process.env.SPARSE_RUNTIME_MS))
  ? Number(process.env.SPARSE_RUNTIME_MS)
  : 6 * 60 * 60 * 1000; // 6 hours

let minDelayMs = Number.isFinite(Number(process.env.SPARSE_MIN_DELAY_MS))
  ? Number(process.env.SPARSE_MIN_DELAY_MS)
  : 60_000; // 1 minute

let maxDelayMs = Number.isFinite(Number(process.env.SPARSE_MAX_DELAY_MS))
  ? Number(process.env.SPARSE_MAX_DELAY_MS)
  : 5 * 60_000; // 5 minutes

if (minDelayMs > maxDelayMs) {
  console.warn(`Swapping min/max delay: ${minDelayMs} > ${maxDelayMs}`);
  const tmp = minDelayMs;
  minDelayMs = maxDelayMs;
  maxDelayMs = tmp;
}

const seedStrategy = (process.env.SPARSE_SEED_STRATEGY || "random").toLowerCase();

const positivePrompt =
  process.env.SPARSE_POSITIVE || "anime style portrait of a curious explorer, detailed lighting, cinematic tone";

const negativePrompt =
  process.env.SPARSE_NEGATIVE || "lowres, blurry, bad anatomy, extra limbs, watermark, text, signature";

const steps = Number(process.env.SPARSE_STEPS ?? 20);
const cfg = Number(process.env.SPARSE_CFG ?? 4.5);
const width = Number(process.env.SPARSE_WIDTH ?? 1024);
const height = Number(process.env.SPARSE_HEIGHT ?? 1024);
const checkpoint = process.env.SPARSE_CKPT ?? "novaAnimeXL_ilV125.safetensors";
const includeOutputs = (process.env.SPARSE_OUTPUTS || "12")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

let stopRequested = false;
process.on("SIGINT", () => {
  console.log("\nReceived SIGINT, shutting down after in-flight jobs complete...");
  stopRequested = true;
});
process.on("SIGTERM", () => {
  console.log("\nReceived SIGTERM, shutting down after in-flight jobs complete...");
  stopRequested = true;
});

function log(...args: any[]) {
  // eslint-disable-next-line no-console
  console.log(`[${new Date().toISOString()}]`, ...args);
}

function randomInt(min: number, max: number) {
  const floorMin = Math.ceil(min);
  const floorMax = Math.floor(max);
  return Math.floor(Math.random() * (floorMax - floorMin + 1)) + floorMin;
}

function nextSeed(base?: number) {
  if (seedStrategy === "fixed" && Number.isFinite(base)) {
    return Number(base);
  }
  if (seedStrategy === "auto") {
    return -1;
  }
  return randomInt(0, 2_147_483_647);
}

function buildWorkflow(seed: number) {
  const wf = Workflow.from(Graph);
  wf.set("3.inputs.width", width)
    .set("3.inputs.height", height)
    .set("10.inputs.steps", steps)
    .set("10.inputs.cfg", cfg)
    .set("10.inputs.sampler_name", "euler_ancestral")
    .set("10.inputs.scheduler", "simple")
    .set("6.inputs.ckpt_name", checkpoint)
    .set("1.inputs.value", positivePrompt)
    .set("2.inputs.value", negativePrompt)
    .set("10.inputs.seed", seed)
    .output("base_preview", "12");

  return wf;
}

interface PoolStats {
  jobsEnqueued: number;
  jobsCompleted: number;
  jobsFailed: number;
  disconnects: number;
}

async function main() {
  log("Sparse WorkflowPool simulator starting", {
    hosts,
    runtimeHours: runtimeMs / 3_600_000,
    minDelayMs,
    maxDelayMs,
    includeOutputs,
    seedStrategy
  });

  const endTime = Date.now() + runtimeMs;

  const clients: ComfyApi[] = [];
  for (const host of hosts) {
    const client = new ComfyApi(host, undefined, { wsTimeout: maxDelayMs * 2, debug: false });
    client.on("disconnected", () => log(`⚠️  Disconnected: ${client.id} (${host})`));
    client.on("reconnected", () => log(`✅ Reconnected: ${client.id} (${host})`));
    await client.ready();
    clients.push(client);
  }

  const pool = new WorkflowPool(clients, {
    healthCheckIntervalMs: maxDelayMs
  });

  const stats: PoolStats = {
    jobsEnqueued: 0,
    jobsCompleted: 0,
    jobsFailed: 0,
    disconnects: 0
  };

  pool.on("job:completed", (ev) => {
    stats.jobsCompleted += 1;
    const { job } = ev.detail;
    log(`✅ job completed promptId=${job.promptId ?? "n/a"}`);
  });
  pool.on("job:failed", (ev) => {
    stats.jobsFailed += 1;
    log("❌ job failed", ev.detail.job.lastError);
  });
  pool.on("client:state", (ev) => {
    if (!ev.detail.online) {
      stats.disconnects += 1;
    }
    log(
      `ℹ️  client:state ${ev.detail.clientId} online=${ev.detail.online} busy=${ev.detail.busy}${
        ev.detail.lastError ? ` lastError=${String(ev.detail.lastError)}` : ""
      }`
    );
  });

  await pool.ready();
  log("WorkflowPool ready");

  try {
    while (!stopRequested && Date.now() < endTime) {
      const waitMs = randomInt(minDelayMs, maxDelayMs);
      log(`Waiting ${Math.round(waitMs / 1000)}s before enqueueing next job`);
      await delay(waitMs);
      if (stopRequested || Date.now() >= endTime) break;

      const seed = nextSeed();
      const wf = buildWorkflow(seed);
      stats.jobsEnqueued += 1;
      log(`▶️  enqueue job #${stats.jobsEnqueued} seed=${seed}`);
      try {
        await pool.enqueue(wf, {
          includeOutputs,
          metadata: { source: "sparse-usage-pool", run: stats.jobsEnqueued, seed }
        });
      } catch (error) {
        stats.jobsFailed += 1;
        log("❌ Failed to enqueue job", error);
      }
    }

    log("Run loop finished, waiting for in-flight jobs...");
    // Wait a short grace period for any pending jobs to finish
    await delay(10_000);
  } finally {
    log("Shutting down pool...");
    await pool.shutdown();
    for (const client of clients) {
      try {
        client.destroy();
      } catch (error) {
        log("Error destroying client", error);
      }
    }
  }

  log("Pool simulation complete", stats);
  if (stats.disconnects > 0 || stats.jobsFailed > 0) {
    log("Summary:", stats);
    process.exitCode = 1;
  } else {
    log("Summary: no disconnects detected, all jobs completed successfully");
  }
}

main().catch((error) => {
  console.error("Fatal error during sparse WorkflowPool simulation", error);
  process.exit(1);
});
