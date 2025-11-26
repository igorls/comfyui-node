/**
 * Event Forwarding Demo for MultiWorkflowPool
 * 
 * Demonstrates that all ComfyUI client events are forwarded through PoolEventManager
 */

import { MultiWorkflowPool } from "../multi-workflow-pool.js";
import { Workflow } from "../workflow.js";
import GenerationGraph from "../../../scripts/workflows/T2I-one-obsession.json" with { type: "json" };

const GEN_HOST = "http://localhost:8188";

// Create pool
const pool = new MultiWorkflowPool({});

const genWorkflow = Workflow.fromAugmented(GenerationGraph);

pool.addClient(GEN_HOST, {
  workflowAffinity: [genWorkflow],
  priority: 1
});

console.log("\n" + "=".repeat(80));
console.log("EVENT FORWARDING DEMO - MultiWorkflowPool");
console.log("=".repeat(80));
console.log(`Generation Host: ${GEN_HOST}`);
console.log("Testing: All client events forwarded through PoolEventManager");
console.log("=".repeat(80) + "\n");

// Track all events received
const eventLog: Array<{ type: string; clientName: string; eventType: string }> = [];

// Attach event hooks for various client events
const trackedEvents = [
  "client:status",
  "client:progress", 
  "client:executing",
  "client:execution_cached",
  "client:executed",
  "client:execution_success",
  "client:b_preview_meta"
];

trackedEvents.forEach(eventType => {
  pool.attachEventHook(eventType, (event) => {
    eventLog.push({
      type: event.type,
      clientName: event.payload.clientName,
      eventType: event.payload.eventType
    });
    console.log(`[Event Hook] ${event.type} from ${event.payload.clientName}`);
  });
});

console.log(`✅ Attached event hooks for: ${trackedEvents.join(", ")}\n`);

await pool.init();

console.log("\n📤 Submitting job to trigger events...\n");

// Run a simple generation job
const workflow = Workflow.fromAugmented(GenerationGraph)
  .input("1", "value", "test image, simple")
  .input("10", "steps", 5)  // Low steps for faster execution
  .input("10", "seed", 42);

const jobId = await pool.submitJob(workflow);
await pool.waitForJobCompletion(jobId);

console.log("\n" + "=".repeat(80));
console.log("JOB COMPLETED - EVENT LOG SUMMARY");
console.log("=".repeat(80));

console.log(`\n📊 Total Events Captured: ${eventLog.length}\n`);

// Group events by type
const eventsByType = new Map<string, number>();
eventLog.forEach(log => {
  eventsByType.set(log.type, (eventsByType.get(log.type) || 0) + 1);
});

console.log("Event Type Breakdown:");
eventsByType.forEach((count, type) => {
  console.log(`  ${type}: ${count} events`);
});

// Verify critical events were captured
const criticalEvents = ["client:status", "client:execution_success"];
const missingEvents = criticalEvents.filter(e => !eventsByType.has(e));

if (missingEvents.length > 0) {
  console.log(`\n⚠️  WARNING: Missing critical events: ${missingEvents.join(", ")}`);
} else {
  console.log("\n✅ All critical events were forwarded successfully!");
}

// Show detailed event timeline
console.log("\n📅 Event Timeline:");
eventLog.forEach((log, i) => {
  console.log(`  ${i + 1}. ${log.type} (${log.eventType}) from ${log.clientName}`);
});

console.log("\n" + "=".repeat(80));

await pool.shutdown();

console.log("\n✅ Event forwarding demo completed, exiting...");
process.exit(0);
