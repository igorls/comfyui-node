import { ComfyApi, Workflow, WorkflowPool } from "../src/index.ts";
import Graph from "./workflows/T2I-anime-nova-xl.json" assert { type: "json" };

/**
 * Quick smoke test for the T2I Anime Nova XL workflow across two hosts.
 *
 * Defaults:
 *  - Hosts: http://localhost:8188 and http://afterpic-comfy-aero16:8188
 *  - Positive prompt: stylised anime portrait
 *  - Negative prompt: standard quality filters
 *
 * Override via environment variables when needed:
 *  - NOVA_HOST_A / NOVA_HOST_B : custom endpoints
 *  - NOVA_POSITIVE / NOVA_NEGATIVE : prompt text
 *  - NOVA_SEED : fixed numeric seed (use -1 for SDK auto-randomisation)
 *  - NOVA_STEPS / NOVA_CFG : sampler params
 *  - NOVA_WIDTH / NOVA_HEIGHT : latent dimensions
 *  - NOVA_CKPT : checkpoint filename expected on the server(s)
 */

const HOSTS = [
  process.env.NOVA_HOST_A || "http://localhost:8188",
  process.env.NOVA_HOST_B || "http://afterpic-comfy-aero16:8188"
];

const POSITIVE_PROMPT =
  process.env.NOVA_POSITIVE ||
  "anime style portrait of a confident adventurer, intricate clothing details, soft rim lighting, crisp line art, pastel palette";

const NEGATIVE_PROMPT =
  process.env.NOVA_NEGATIVE ||
  "lowres, blurry, bad anatomy, extra limbs, deformed hands, watermark, text, signature, nsfw, jpeg artifacts";

const STEPS = Number(process.env.NOVA_STEPS || 20);
const CFG = Number(process.env.NOVA_CFG || 4.5);
const WIDTH = Number(process.env.NOVA_WIDTH || 1024);
const HEIGHT = Number(process.env.NOVA_HEIGHT || 1024);
const RAW_SEED = process.env.NOVA_SEED;
const SEED = RAW_SEED === undefined ? -1 : Number(RAW_SEED);
const CHECKPOINT = process.env.NOVA_CKPT || "novaAnimeXL_ilV125.safetensors";
const HEALTH_CHECK_INTERVAL = Number(process.env.NOVA_HEALTH_INTERVAL_MS || 30_000);

const RUN_MODE = (process.env.NOVA_MODE || "pool").toLowerCase();

type RunMode = "pool" | "direct" | "both";

function buildWorkflow(seed: number) {
  const wf = Workflow.from(Graph);

  wf.set("3.inputs.width", WIDTH)
    .set("3.inputs.height", HEIGHT)
    .set("10.inputs.steps", STEPS)
    .set("10.inputs.cfg", CFG)
    .set("10.inputs.sampler_name", "euler_ancestral")
    .set("10.inputs.scheduler", "simple")
    .set("6.inputs.ckpt_name", CHECKPOINT)
    .set("1.inputs.value", POSITIVE_PROMPT)
    .set("2.inputs.value", NEGATIVE_PROMPT)
    .set("10.inputs.seed", Number.isFinite(seed) ? seed : -1)
    .output("base_preview", "12");

  return wf;
}

async function runOnce(host: string) {
  console.log(`\n=== Running on ${host} ===`);

  const api = await new ComfyApi(host, undefined, { wsTimeout: 120_000 }).ready();

  const parsedSeed = Number.isFinite(SEED) ? Math.floor(SEED) : NaN;
  const seed = parsedSeed >= 0 ? parsedSeed : -1;
  const wf = buildWorkflow(seed);

  if (seed === -1) {
    console.log("Using SDK auto-randomised seed (-1)");
  } else {
    console.log(`Using fixed seed: ${seed}`);
  }

  console.log("Positive prompt:\n", POSITIVE_PROMPT);
  console.log("Negative prompt:\n", NEGATIVE_PROMPT);

  const job = await api.run(wf, { autoDestroy: true });

  job.on("progress_pct", (pct) => process.stdout.write(`\rprogress ${pct}%   `));
  job.on("preview", () => process.stdout.write(" preview frame   "));
  job.on("failed", (err) => console.error("\nworkflow failed", err));

  const result = await job.done();
  process.stdout.write("\r");

  console.log("Prompt ID:", result._promptId);
  if (result._autoSeeds) {
    const samplerSeed = result._autoSeeds["10"];
    if (samplerSeed !== undefined) {
      console.log("Auto seed applied:", samplerSeed);
    }
  }

  const preview = result.base_preview;
  const records = Array.isArray(preview?.images)
    ? preview.images
    : Array.isArray(preview)
    ? preview
    : preview
    ? [preview]
    : [];

  if (records.length === 0) {
    console.warn("No preview images returned. Check workflow outputs or server logs.");
  } else {
    console.log("Preview outputs:");
    for (const image of records) {
      if (image?.filename) {
        console.log(" -", api.ext.file.getPathImage(image));
      } else {
        console.dir(image, { depth: 1 });
      }
    }
  }
}

async function runPool(hosts: string[]) {
  console.log("\n=== WorkflowPool run ===");

  const clients: ComfyApi[] = [];
  const clientMap = new Map<string, ComfyApi>();
  for (const [index, host] of hosts.entries()) {
    console.log(`Preparing client ${index + 1}/${hosts.length}: ${host}`);
    const api = new ComfyApi(host, `nova-${index}`, { wsTimeout: 120_000 });
    await api.ready();
    clients.push(api);
    clientMap.set(api.id, api);
  }

  const pool = new WorkflowPool(clients, {
    healthCheckIntervalMs: Number.isFinite(HEALTH_CHECK_INTERVAL) ? HEALTH_CHECK_INTERVAL : 30_000
  });

  pool.on("pool:ready", (ev) => {
    console.log("WorkflowPool ready with clients:", ev.detail.clientIds.join(", "));
  });

  pool.on("client:state", (ev) => {
    const { clientId, online, busy, lastError } = ev.detail;
    const stamp = new Date().toISOString();
    console.log(`[${stamp}] client:state -> ${clientId} online=${online} busy=${busy}${lastError ? ` lastError=${String(lastError)}` : ""}`);
  });

  pool.on("job:progress", (ev) => {
    const { jobId, clientId, progress } = ev.detail;
    const pct = progress?.value && progress?.max ? ((progress.value / progress.max) * 100).toFixed(1) : "?";
    process.stdout.write(`\r[pool] job ${jobId} on ${clientId} progress ${progress?.value ?? "?"}/${progress?.max ?? "?"} (${pct}%)   `);
  });

  pool.on("job:preview", (ev) => {
    process.stdout.write(` preview from ${ev.detail.clientId}   `);
  });

  const seed = (() => {
    const parsedSeed = Number.isFinite(SEED) ? Math.floor(SEED) : NaN;
    return parsedSeed >= 0 ? parsedSeed : -1;
  })();

  const wf = buildWorkflow(seed);
  const jobId = await pool.enqueue(wf, {
    includeOutputs: ["12"],
    metadata: { source: "t2i-anime-nova-xl-demo", mode: "pool" }
  });

  console.log("\nqueue id:", jobId);

  const completed = await new Promise<{ jobId: string; job: any }>((resolve, reject) => {
    const offCompleted = pool.on("job:completed", (event) => {
      if (event.detail.job.jobId !== jobId) return;
      cleanup();
      resolve({ jobId, job: event.detail.job });
    });
    const offFailed = pool.on("job:failed", (event) => {
      if (event.detail.job.jobId !== jobId) return;
      cleanup();
      reject(event.detail.job.lastError ?? new Error("pool job failed"));
    });
    const cleanup = () => {
      offCompleted();
      offFailed();
    };
  });

  process.stdout.write("\r");

  const result = completed.job.result;

  if (!result) {
    console.warn("Pool result missing - inspect server logs");
  } else {
    console.log("Pool job prompt:", result._promptId);
    if (result._autoSeeds) {
      const samplerSeed = result._autoSeeds["10"];
      if (samplerSeed !== undefined) {
        console.log("Pool auto seed:", samplerSeed);
      }
    }

    const preview = result.base_preview ?? result["12"];
    const records = Array.isArray(preview?.images)
      ? preview.images
      : Array.isArray(preview)
      ? preview
      : preview
      ? [preview]
      : [];

    if (records.length === 0) {
      console.warn("No preview outputs collected from pool run");
    } else {
      console.log("Pool preview outputs:");
      const producerId = completed.job.clientId;
      const producer = producerId ? clientMap.get(producerId) : null;
      for (const image of records) {
        if (image?.filename) {
          const helper = producer ?? clients[0];
          console.log(" -", helper.ext.file.getPathImage(image));
        } else {
          console.dir(image, { depth: 1 });
        }
      }
    }
  }

//   await pool.shutdown();
//   for (const client of clients) {
//     try {
//       client.destroy();
//     } catch (err) {
//       console.warn(`Error destroying client ${client.id}:`, err);
//     }
//   }

}

async function main() {
  const mode = (RUN_MODE === "direct" || RUN_MODE === "both" || RUN_MODE === "pool")
    ? (RUN_MODE as RunMode)
    : "pool";

  if (mode === "direct" || mode === "both") {
    for (const host of HOSTS) {
      try {
        await runOnce(host);
      } catch (err) {
        console.error(`\n✖ Failed on ${host}:`, err);
      }
    }
  }

  if (mode === "pool" || mode === "both") {
    try {
      await runPool(HOSTS);
    } catch (err) {
      console.error("\n✖ WorkflowPool run failed:", err);
    }
  }
}

main().catch((err) => {
  console.error("\nFatal error:", err);
  process.exit(1);
});
