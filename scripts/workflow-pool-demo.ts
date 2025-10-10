import { ComfyApi, Workflow, WorkflowPool } from "../src/index.ts";
import Txt2ImgWorkflow from "./txt2img-workflow.json" assert { type: "json" };

const COMFY_HOST = process.env.COMFY_HOST || "http://127.0.0.1:8188";

const api = await new ComfyApi(COMFY_HOST).ready();

const pool = new WorkflowPool([api]);
await pool.ready();

const wf = Workflow.from(Txt2ImgWorkflow)
  .set("LOAD_CHECKPOINT.inputs.ckpt_name", "hassakuXLIllustrious_v31.safetensors")
  .set(
    "CLIP_TEXT_ENCODE_POSITIVE.inputs.text",
    "concept art style illustration of a serene forest shrine at dawn, intricate lighting, highly detailed"
  )
  .output("SAVE_IMAGE");

pool.on("job:progress", (ev) => {
  const { value, max } = ev.detail.progress;
  process.stdout.write(`\rprogress ${value ?? 0}/${max ?? 0}`);
});

pool.on("job:preview", () => {
  process.stdout.write(" preview frame received   ");
});

const jobId = await pool.enqueue(wf, {
  includeOutputs: ["SAVE_IMAGE"],
  metadata: { source: "workflow-pool-demo" }
});

console.log(`\nqueued job ${jobId}`);

const { result } = await new Promise<{ result: any }>((resolve, reject) => {
  const offCompleted = pool.on("job:completed", (event) => {
    if (event.detail.job.jobId !== jobId) return;
    offCompleted();
    offFailed();
    resolve({ result: event.detail.job.result });
  });
  const offFailed = pool.on("job:failed", (event) => {
    if (event.detail.job.jobId !== jobId) return;
    offCompleted();
    offFailed();
    reject(event.detail.job.lastError ?? new Error("workflow failed"));
  });
});

await pool.shutdown();

if (!result || !result.SAVE_IMAGE) {
  console.error("No images returned – check your workflow outputs");
  process.exit(1);
}

const outputs = Array.isArray(result.SAVE_IMAGE) ? result.SAVE_IMAGE : [result.SAVE_IMAGE];

console.log("\noutputs:");
for (const output of outputs) {
  if (output?.filename) {
    console.log(` - ${output.filename}`);
  } else {
    console.dir(output, { depth: 1 });
  }
}

console.log("\nDone. Images saved to your ComfyUI output directory.");
