import { SmartPool } from "../src/pool/SmartPool.js";
import GenerationGraph from "./workflows/T2I-anime-nova-xl.json" with { type: "json" };
import EditGraph from "./workflows/quick-edit-test.json" with { type: "json" };
import { Workflow } from "../src/workflow.js";

const GEN_HOSTS = ["http://afterpic-comfy-aero16:8188"];
const EDIT_HOSTS = ["http://afterpic-comfy-igor:8188", "http://afterpic-comfy-domi:8188"];

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


// Main test loop
let iteration = 0;
while (iteration < 2) {
  iteration += 1;
  console.log(`\n--- Workflow Execution Iteration ${iteration} ---\n`);
  const workflow = Workflow.from(GenerationGraph, { autoHash: false });

  workflow.updateHash();

  // Positive prompt input
  workflow.input("1", "value", "1girl, blonde hair, blue eyes, large eyes, looking back, solo, see-through dress, backlight, windy, detailed background, flower field, moonlit, highres, masterpiece, best quality");
  workflow.input("2", "value", "lowres, bad anatomy, blurry");
  workflow.input("3", "width", 512);
  workflow.input("3", "height", 512);
  workflow.input("10", "steps", 30);
  workflow.input("10", "seed", -1);
  workflow.output("final_image", "12");

  const result = smartPool.executeImmediate(workflow, {
    preferableClientIds: [...GEN_HOSTS]
  });

  result.then(value => {
    console.log("Workflow execution complete", value.imageBlob);
  }).catch(reason => {
    console.error("Workflow execution failed", reason);
  })
}

await new Promise(resolve => {
  setTimeout(resolve, 5000);
})

// // Shutdown the pool
// smartPool.shutdown();
// console.log("Shutdown complete");