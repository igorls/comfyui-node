/**
 * Demo: Automatic Workflow Profiling with WorkflowPool
 * 
 * This demonstrates the new built-in profiling feature that automatically
 * captures per-node execution metrics without requiring extra developer work.
 * 
 * Just enable `enableProfiling: true` in WorkflowPoolOpts and access stats
 * via `job.profileStats` when the job completes.
 */

import { ComfyApi, Workflow, WorkflowPool } from "../src/index.js";
import fs from "fs";

const COMFY_HOST = "http://localhost:8188";
const WORKFLOW_PATH = "./scripts/simple-txt2img.json";

async function main() {
  console.log("🚀 Demo: Automatic WorkflowPool Profiling\n");

  // Load workflow
  const workflowJson = JSON.parse(fs.readFileSync(WORKFLOW_PATH, "utf-8"));
  const workflow = Workflow.from(workflowJson);

  // Create ComfyUI client
  const client = new ComfyApi(COMFY_HOST, "demo-client");

  // Create WorkflowPool with profiling enabled
  const pool = new WorkflowPool([client], {
    enableProfiling: true  // ✨ This is all you need!
  });

  await pool.ready();

  // Track completion
  let completed = false;
  const completionPromise = new Promise<void>((resolve, reject) => {
    // Listen to job completion event (set up BEFORE enqueuing)
    pool.on("job:completed", (event) => {
      completed = true;
      const { job } = event.detail;
      const stats = job.profileStats;

      if (!stats) {
        console.log("\n⚠️  No profiling stats found!");
        resolve();
        return;
      }
      console.log("\n📊 Execution Profile:");
      console.log("═".repeat(80));
      console.log(`Prompt ID: ${stats.promptId}`);
      console.log(`Total Duration: ${stats.totalDuration}ms`);
      console.log(`Queue Time: ${stats.queueTime}ms`);
      console.log(`Execution Time: ${stats.executionTime}ms`);
      console.log();

      console.log("📈 Summary:");
      console.log(`  Total Nodes: ${stats.summary.totalNodes}`);
      console.log(`  Executed: ${stats.summary.executedNodes}`);
      console.log(`  Cached: ${stats.summary.cachedNodes}`);
      console.log(`  Failed: ${stats.summary.failedNodes}`);
      console.log();

      console.log("🐌 Slowest Nodes:");
      for (const node of stats.summary.slowestNodes) {
        const title = node.title ? ` (${node.title})` : "";
        console.log(`  ${node.nodeId}: ${node.type}${title} - ${node.duration}ms`);
      }
      console.log();

      console.log("⚡ Progress Events Captured:");
      for (const nodeId of stats.summary.progressNodes) {
        const node = stats.nodes.find(n => n.nodeId === nodeId);
        if (node?.progressEvents) {
          const steps = node.progressEvents.map(p => `${p.value}/${p.max}`).join(", ");
          const title = node.title ? ` (${node.title})` : "";
          console.log(`  ${nodeId}: ${node.type}${title} - ${steps}`);
        }
      }
      console.log();

      console.log("📋 All Nodes:");
      console.log("─".repeat(80));
      console.log(
        `${"Node ID".padEnd(10)} | ${"Type".padEnd(25)} | ${"Status".padEnd(10)} | ${"Duration".padEnd(10)}`
      );
      console.log("─".repeat(80));

      const sortedNodes = [...stats.nodes].sort((a, b) => {
        const aStart = a.startedAt || 0;
        const bStart = b.startedAt || 0;
        return aStart - bStart;
      });

      for (const node of sortedNodes) {
        const nodeId = node.nodeId.padEnd(10);
        const type = (node.type || "unknown").padEnd(25);
        const status = node.status.padEnd(10);
        const duration = node.duration !== undefined 
          ? `${node.duration}ms`.padEnd(10) 
          : "N/A".padEnd(10);
        
        console.log(`${nodeId} | ${type} | ${status} | ${duration}`);
      }
      console.log("═".repeat(80));
      
      resolve();
    });

    pool.on("job:failed", (event) => {
      completed = true;
      console.error("\n❌ Job failed:", event.detail.job.lastError);
      reject(event.detail.job.lastError);
    });
  });

  // Enqueue job - profiling happens automatically!
  console.log("Enqueueing job...");
  const jobId = await pool.enqueue(workflow);
  console.log(`Job ${jobId} queued\n`);

  // Wait for completion
  try {
    await completionPromise;
  } catch (error) {
    console.error("Job execution failed:", error);
  }

  if (!completed) {
    console.log("\n⚠️  Job did not complete - timeout or other issue");
  }

  console.log("\n✅ Demo complete!");
  process.exit(0);
}

main().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});
