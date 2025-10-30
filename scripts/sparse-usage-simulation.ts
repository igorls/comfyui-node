import { ComfyApi, Workflow } from "../src/index.ts";
import Graph from "./workflows/T2I-anime-nova-xl.json" assert { type: "json" };
import { delay } from "../src/tools.ts";

/**
 * Sparse usage simulator
 *
 * Keeps long-lived WebSocket connections open and triggers workflow runs at random
 * intervals to emulate real end-user traffic. Designed for soak testing
 * disconnect fixes over multi-hour periods.
 */

const DEFAULT_HOSTS = ["http://afterpic-comfy-aero16:8188"];

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
  : 5_000; // 5 seconds

let maxDelayMs = Number.isFinite(Number(process.env.SPARSE_MAX_DELAY_MS))
  ? Number(process.env.SPARSE_MAX_DELAY_MS)
  : 60_000; // 1 minutes

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
    return -1; // let server randomise
  }
  return randomInt(0, 2_147_483_647);
}

interface ClientStats {
  host: string;
  runs: number;
  successes: number;
  failures: number;
  disconnects: number;
}

async function runForClient(client: ComfyApi, stats: ClientStats, endTime: number, includeOutputs: string[]) {
  log(`Client ready: ${stats.host}`);

  client.on("disconnected", () => {
    stats.disconnects += 1;
    log(`⚠️  Disconnected from ${stats.host}`);
  });
  client.on("reconnected", () => {
    log(`✅ Reconnected to ${stats.host}`);
  });

  while (!stopRequested && Date.now() < endTime) {
    const waitMs = randomInt(minDelayMs, maxDelayMs);
    log(`Waiting ${Math.round(waitMs / 1000)}s before next run on ${stats.host}`);
    await delay(waitMs);
    if (stopRequested || Date.now() >= endTime) break;

    const seed = nextSeed();
    const wf = buildWorkflow(seed);
    stats.runs += 1;
    const label = `${stats.host}::${stats.runs}`;
    log(`▶️  Starting run ${label} (seed=${seed})`);

    try {
      const job = await client.run(wf, { includeOutputs, autoDestroy: false });
      job.on("preview", () => log(`📷 Preview from ${label}`));
      job.on("failed", (err) => log(`❌ Job failed (${label})`, err));
      const result = await job.done();
      stats.successes += 1;
      const promptId = (result as any)?._promptId;
      log(`✅ Completed ${label}${promptId ? ` promptId=${promptId}` : ""}`);
    } catch (error) {
      stats.failures += 1;
      log(`❌ Run ${label} failed`, error);
    }
  }
}

async function main() {
  log("Sparse usage simulator starting", {
    hosts,
    runtimeHours: runtimeMs / 3_600_000,
    minDelayMs,
    maxDelayMs,
    includeOutputs,
    seedStrategy
  });

  const endTime = Date.now() + runtimeMs;

  const clients: ComfyApi[] = [];
  const stats: ClientStats[] = [];

  for (const host of hosts) {
    const client = new ComfyApi(host, undefined, { wsTimeout: maxDelayMs * 2, debug: false });
    await client.ready();
    clients.push(client);
    stats.push({ host, runs: 0, successes: 0, failures: 0, disconnects: 0 });
  }

  try {
    await Promise.all(clients.map((client, idx) => runForClient(client, stats[idx], endTime, includeOutputs)));
  } finally {
    log("Shutting down clients...");
    for (const client of clients) {
      try {
        client.destroy();
      } catch (error) {
        log("Error destroying client", error);
      }
    }
  }

  log("Test complete", stats);
  const totalDisconnects = stats.reduce((acc, s) => acc + s.disconnects, 0);
  const totalFailures = stats.reduce((acc, s) => acc + s.failures, 0);

  if (totalDisconnects > 0 || totalFailures > 0) {
    log("Summary:", { totalDisconnects, totalFailures });
    process.exitCode = 1;
  } else {
    log("Summary: no disconnects detected, all jobs succeeded");
  }
}

main().catch((error) => {
  console.error("Fatal error during sparse usage simulation", error);
  process.exit(1);
});
