import { SmartPool } from "../src/pool/SmartPool.js";
import GenerationGraph from "./workflows/T2I-anime-nova-xl.json" with { type: "json" };
import EditGraph from "./workflows/quick-edit-test.json" with { type: "json" };
import { Workflow } from "../src/workflow.js";
import sharp from "sharp";

const GEN_HOSTS = ["http://afterpic-comfy-aero16:8188"];
const EDIT_HOSTS = ["http://afterpic-comfy-igor:8188", "http://afterpic-comfy-domi:8188"];

// Resolution pool for truly random aspect ratios
const RESOLUTIONS = [
  { w: 256, h: 256 },
  { w: 512, h: 384 },
  { w: 768, h: 512 },
  { w: 1024, h: 256 },
  { w: 512, h: 768 },
  { w: 384, h: 512 }
];

function pickRandomResolution() {
  return RESOLUTIONS[Math.floor(Math.random() * RESOLUTIONS.length)];
}

// Create an instance of SmartPool
const smartPool = new SmartPool([
  ...GEN_HOSTS,
  ...EDIT_HOSTS
]);

// Configure affinities
smartPool.setAffinity(GenerationGraph, { preferredClientIds: GEN_HOSTS });
smartPool.setAffinity(EditGraph, { preferredClientIds: EDIT_HOSTS });

// Pool event listeners
smartPool.hooks.any = (event => {
  console.log(`[Pool Event] ${event.type}`, event);
});

// Connect to all clients in the pool
await smartPool.connect();
console.log("Connected");


// Main test loop - track results for summary
let iteration = 0;
const promises: Promise<any>[] = [];
const results: Array<{ iteration: number; expected: string; actual: string; passed: boolean }> = [];

while (iteration < 6) {
  iteration += 1;
  console.log(`\n--- Workflow Execution Iteration ${iteration} ---\n`);
  const workflow = Workflow.from(GenerationGraph, { autoHash: false });

  workflow.updateHash();

  // Positive prompt input
  workflow.input("1", "value", "1girl, blonde hair, blue eyes, large eyes, looking back, solo, see-through dress, backlight, windy, detailed background, flower field, moonlit, highres, masterpiece, best quality");
  workflow.input("2", "value", "lowres, bad anatomy, blurry");
  
  // Randomize resolution for each iteration
  const { w: width, h: height } = pickRandomResolution();
  workflow.input("3", "width", width);
  workflow.input("3", "height", height);
  workflow.input("10", "steps", 5);
  workflow.input("10", "seed", -1);
  workflow.output("final_image", "12");

  console.log(`[Iteration ${iteration}] Submitting workflow with dimensions: ${width}x${height}`);

  const promise = smartPool.executeImmediate(workflow, {
    preferableClientIds: [...GEN_HOSTS]
  });

  // Capture iteration in closure to avoid reference issue
  const currentIteration = iteration;
  const expectedWidth = width;
  const expectedHeight = height;
  
  promise.then(async (value) => {
    const images = value.images || [];
    const imageBlob = value.imageBlob;
    console.log(`[Iteration ${currentIteration}] Workflow execution complete - Got ${images.length} image(s)`);
    if (imageBlob) {
      console.log(`[Iteration ${currentIteration}] Image size: ${imageBlob.size} bytes, type: ${imageBlob.type}`);
      // Use sharp to read image dimensions
      const buffer = Buffer.from(await imageBlob.arrayBuffer());
      const metadata = await sharp(buffer).metadata();
      console.log(`[Iteration ${currentIteration}] Image dimensions: ${metadata.width}x${metadata.height}`);
      
      // Verify this is the expected size
      const isCorrect = metadata.width === expectedWidth && metadata.height === expectedHeight;
      const expected = `${expectedWidth}x${expectedHeight}`;
      const actual = `${metadata.width}x${metadata.height}`;
      
      results.push({
        iteration: currentIteration,
        expected,
        actual,
        passed: isCorrect
      });
      
      if (isCorrect) {
        console.log(`[Iteration ${currentIteration}] ✓ CORRECT dimensions received`);
      } else {
        console.log(`[Iteration ${currentIteration}] ✗ WRONG dimensions! Expected ${expected}, got ${actual}`);
      }
    }
  }).catch(reason => {
    console.error(`[Iteration ${currentIteration}] Workflow execution failed`, reason.message);
    results.push({
      iteration: currentIteration,
      expected: `${expectedWidth}x${expectedHeight}`,
      actual: "FAILED",
      passed: false
    });
  });

  promises.push(promise);
  
  // Stagger job submissions by 200ms
  await new Promise(resolve => setTimeout(resolve, 200));
}

// Wait for all promises to settle before shutdown
await Promise.allSettled(promises);

// Small delay to ensure all cleanup is done
await new Promise(resolve => setTimeout(resolve, 1000));

smartPool.shutdown();
console.log("Shutdown complete");

// Print final summary
console.log("\n" + "=".repeat(70));
console.log("TEST SUMMARY");
console.log("=".repeat(70));
console.log(`Total Iterations: ${results.length}`);
console.log(`Passed: ${results.filter(r => r.passed).length}`);
console.log(`Failed: ${results.filter(r => !r.passed).length}`);
console.log("");

if (results.length > 0) {
  console.log("Detailed Results:");
  console.log("-".repeat(70));
  for (const result of results) {
    const status = result.passed ? "✓ PASS" : "✗ FAIL";
    console.log(`  [Iteration ${result.iteration}] ${status} | Expected: ${result.expected} | Got: ${result.actual}`);
  }
  console.log("-".repeat(70));
  
  const passRate = ((results.filter(r => r.passed).length / results.length) * 100).toFixed(1);
  console.log(`Pass Rate: ${passRate}%`);
}
console.log("=".repeat(70) + "\n");

// Exit with appropriate code
process.exit(results.every(r => r.passed) ? 0 : 1);