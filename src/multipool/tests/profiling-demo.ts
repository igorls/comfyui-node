/**
 * Profiling Demo for MultiWorkflowPool
 * 
 * Demonstrates the integrated JobProfiler functionality
 */

import { MultiWorkflowPool } from "../multi-workflow-pool.js";
import { Workflow } from "../workflow.js";
import GenerationGraph from "../../../scripts/workflows/T2I-one-obsession.json" with { type: "json" };

const GEN_HOST = "http://localhost:8188";

// Create pool with profiling enabled
const pool = new MultiWorkflowPool({
  enableProfiling: true,
  logLevel: "info"
});

const genWorkflow = Workflow.fromAugmented(GenerationGraph);

pool.addClient(GEN_HOST, {
  workflowAffinity: [genWorkflow],
  priority: 1
});

console.log("\n" + "=".repeat(80));
console.log("PROFILING DEMO - MultiWorkflowPool");
console.log("=".repeat(80));
console.log(`Generation Host: ${GEN_HOST}`);
console.log(`Profiling: ENABLED`);
console.log("=".repeat(80) + "\n");

await pool.init();

// Run a single generation job with profiling
const workflow = Workflow.fromAugmented(GenerationGraph)
  .input("1", "value", "1girl, anime style, beautiful landscape, high quality, vibrant colors")
  .input("2", "value", "ugly, blurry, low quality")
  .input("10", "steps", 30)
  .input("10", "seed", -1);

console.log("Submitting job with profiling enabled...\n");

const jobId = await pool.submitJob(workflow);
const result = await pool.waitForJobCompletion(jobId);

console.log("\n" + "=".repeat(80));
console.log("JOB COMPLETED - PROFILING RESULTS");
console.log("=".repeat(80));

if (result.profileStats) {
  const stats = result.profileStats;
  
  console.log(`\n📊 Execution Summary:`);
  console.log(`  Total Duration:     ${stats.totalDuration}ms`);
  console.log(`  Queue Time:         ${stats.queueTime}ms`);
  console.log(`  Execution Time:     ${stats.executionTime}ms`);
  console.log(`  Prompt ID:          ${stats.promptId}`);
  
  console.log(`\n📈 Node Statistics:`);
  console.log(`  Total Nodes:        ${stats.summary.totalNodes}`);
  console.log(`  Executed:           ${stats.summary.executedNodes}`);
  console.log(`  Cached:             ${stats.summary.cachedNodes}`);
  console.log(`  Failed:             ${stats.summary.failedNodes}`);
  console.log(`  Progress Tracked:   ${stats.summary.progressNodes.length}`);
  
  if (stats.summary.slowestNodes.length > 0) {
    console.log(`\n🐌 Slowest Nodes (Top ${Math.min(5, stats.summary.slowestNodes.length)}):`);
    stats.summary.slowestNodes.forEach((node, i) => {
      const title = node.title ? ` (${node.title})` : '';
      console.log(`  ${i + 1}. Node ${node.nodeId}${title}: ${node.duration}ms`);
      console.log(`     Type: ${node.type || 'unknown'}`);
    });
  }
  
  if (stats.summary.progressNodes.length > 0) {
    console.log(`\n⏱️  Nodes with Progress Tracking:`);
    stats.summary.progressNodes.forEach(nodeId => {
      const nodeProfile = stats.nodes.find(n => n.nodeId === nodeId);
      if (nodeProfile?.progressEvents) {
        console.log(`  Node ${nodeId} (${nodeProfile.type || 'unknown'}): ${nodeProfile.progressEvents.length} progress events`);
      }
    });
  }
  
  // Show detailed node execution timeline
  console.log(`\n📅 Execution Timeline (All Nodes):`);
  const executedNodes = stats.nodes
    .filter(n => n.duration !== undefined)
    .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
  
  executedNodes.forEach(node => {
    const status = node.cached ? '⚡ CACHED' : '✓ EXECUTED';
    const title = node.title ? ` (${node.title})` : '';
    const duration = node.cached ? '0ms' : `${node.duration}ms`;
    console.log(`  ${status} | Node ${node.nodeId}${title} | ${node.type || 'unknown'} | ${duration}`);
  });
  
  console.log("\n" + "=".repeat(80));
} else {
  console.log("\n⚠️  No profiling data available (profiling may be disabled)");
}

await pool.shutdown();

console.log("\n✅ Profiling demo completed, exiting...");
process.exit(0);
