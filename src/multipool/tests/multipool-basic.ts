import { MultiWorkflowPool } from "src/multipool/multi-workflow-pool.js";
import GenerationGraph from "../../../scripts/workflows/T2I-anime-nova-xl.json" with { type: "json" };
import GenerationGraph2 from "../../../scripts/workflows/T2I-one-obsession.json" with { type: "json" };
import { Workflow } from "src/multipool/workflow.js";
import { animeXLPromptGenerator, promptGenerator } from "src/multipool/tests/prompt-generator.js";

const NEGATIVE_PROMPT = `
lowres, bad anatomy, error body, error arm, error hand, error fingers,
error legs, error feet, missing fingers, extra digit, fewer digits, cropped,
worst quality, low quality, jpeg artifacts, ugly, duplicate, morbid, mutilated,
out of frame, worst quality, low quality, naked, watermark, text, error, nsfw, nude
`;

const pool = new MultiWorkflowPool();

const w1 = Workflow.fromAugmented(GenerationGraph);
console.log(`Workflow 1 Hash: ${w1.structureHash}`);

const w2 = Workflow.fromAugmented(GenerationGraph2);
console.log(`Workflow 2 Hash: ${w2.structureHash}`);

// Set affinity mapping
pool.addClient("http://afterpic-comfy-igor:8188", {
  workflowAffinity: [w1, w2],
  priority: 1
});

pool.addClient("http://afterpic-comfy-domi:8188", {
  workflowAffinity: [],
  priority: 1
});

pool.addClient("http://afterpic-comfy-aero16:8188", {
  workflowAffinity: [w1],
  priority: 1
});

await pool.init();

async function generateImage1(prompt: string): Promise<string[]> {
  const workflow = Workflow.fromAugmented(GenerationGraph)
    .input("1", "value", prompt)
    .input("2", "value", NEGATIVE_PROMPT)
    .input("10", "steps", 30)
    .input("10", "seed", -1);
  const jobId = await pool.submitJob(workflow);
  if (!jobId) {
    throw new Error("Failed to submit job to pool.");
  }
  console.log(`[T2I-anime-nova-xl.json] Submitted job ${jobId} for prompt: "${prompt.substring(0, 30)}..."`);

  // pool.attachJobProgressListener(jobId, (progress) => {
  //   console.log(`[T2I-anime-nova-xl.json] Job ${jobId} Progress: ${JSON.stringify(progress)}`);
  // });
  //
  // pool.attachJobPreviewListener(jobId, (preview) => {
  //   console.log(`[T2I-anime-nova-xl.json] Job ${jobId} Preview Image Available: ${preview.blob.size}`);
  // });

  // // 25% chance to simulate a user cancelling the job
  // if (Math.random() < 0.25) {
  //   await delay(2000); // wait a bit before cancelling
  //   console.log(`[T2I-anime-nova-xl.json] Simulating cancellation of job ${jobId}`);
  //   await pool.cancelJob(jobId);
  //   return [];
  // }

  const results = await pool.waitForJobCompletion(jobId);

  switch (results.status) {
    case "completed": {
      console.log(`[T2I-anime-nova-xl.json] Job ${jobId} completed successfully.`);
      return results.images;
    }
    case "canceled": {
      console.log(`[T2I-anime-nova-xl.json] Job ${jobId} was cancelled.`);
      return [];
    }
    case "failed": {
      console.log(`[T2I-anime-nova-xl.json] Job ${jobId} failed with error: ${results.error.error.message}`);
      console.dir(results.error, { depth: Infinity, colors: true });
      return [];
    }
  }
}

async function generateImage2(prompt: string): Promise<string[]> {
  const workflow = Workflow.fromAugmented(GenerationGraph2)
    .input("1", "value", prompt)
    .input("2", "value", NEGATIVE_PROMPT)
    .input("10", "steps", 20)
    .input("10", "seed", -1);
  const jobId = await pool.submitJob(workflow);
  if (!jobId) {
    throw new Error("Failed to submit job to pool.");
  }
  console.log(`[T2I-one-obsession.json] Submitted job ${jobId} for prompt: "${prompt.substring(0, 30)}..."`);

  const results = await pool.waitForJobCompletion(jobId);

  switch (results.status) {
    case "completed": {
      console.log(`[T2I-one-obsession.json] Job ${jobId} completed successfully.`);
      return results.images;
    }
    case "canceled": {
      console.log(`[T2I-one-obsession.json] Job ${jobId} was cancelled.`);
      return [];
    }
    case "failed": {
      console.log(`[T2I-one-obsession.json] Job ${jobId} failed with error: ${results.error.error.message}`);
      console.dir(results.error, { depth: Infinity, colors: true });
      return [];
    }
  }
}

export class SimulatedUser {

  promptGenerator: (() => string) | null;
  modelFunction: (prompt: string) => Promise<string[]> = generateImage1;
  shouldGenerate: boolean = true;
  totalImages: number = 10;
  collectedImages: number = 0;

  constructor(
    generator: (() => string) | null = null,
    modelFunction: (prompt: string) => Promise<string[]> = generateImage1,
    totalImages: number = 10
  ) {
    this.modelFunction = modelFunction;
    this.promptGenerator = generator;
    this.totalImages = totalImages;
  }

  stop() {
    this.shouldGenerate = false;
  }

  start() {
    this.shouldGenerate = true;
    this.generateImages(this.totalImages).catch(reason => {
      console.error("Error generating images:", reason);
    });
  }

  async generateImages(count: number) {
    for (let i = 0; i < count; i++) {
      const prompt = this.promptGenerator ? this.promptGenerator() : `default prompt ${i}`;
      const images = await this.modelFunction(prompt);
      this.collectedImages += images.length;
      console.log(`Simulated user generated ${images.length} images for prompt: "${prompt.substring(0, 30)}..." Total collected: ${this.collectedImages}`);
      if (!this.shouldGenerate) {
        break;
      }
      await new Promise(resolve => {
        const randomDelay = Math.floor(Math.random() * 3000) + 1000;
        setTimeout(() => {
          resolve(null);
        }, randomDelay);
      });
    }
    console.log(`Simulated user finished generating images ${this.collectedImages} total.`);
  }
}

// const user1 = new SimulatedUser(animeXLPromptGenerator, generateImage1, 3);
// user1.start();
//

const user2 = new SimulatedUser(promptGenerator, generateImage1, 1);
user2.start();

const user3 = new SimulatedUser(animeXLPromptGenerator, generateImage1, 1);
user3.start();

const user4 = new SimulatedUser(animeXLPromptGenerator, generateImage2, 1);
user4.start();