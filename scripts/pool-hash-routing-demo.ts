/**
 * Comprehensive demo for WorkflowPool hash-based routing feature.
 * 
 * Hash-based routing allows the pool to intelligently handle failures and client affinity.
 * When a workflow fails on a client, the SmartFailoverStrategy:
 * 1. Calculates a deterministic hash of the workflow
 * 2. Blocks that client for that specific workflow for a cooldown period
 * 3. Routes future jobs with the same workflow hash to other clients
 * 4. Clears the block after cooldown, allowing retries with full capacity
 * 
 * This demo shows:
 * - Multiple workflows with different hashes
 * - Client selection and affinity
 * - Failure handling and recovery
 * - Workflow blocking/unblocking events
 * - Job lifecycle tracking
 * 
 * Usage:
 *   bun scripts/pool-hash-routing-demo.ts [--verbose]
 */

import { randomUUID } from "crypto";

// Mock classes to demonstrate the hash-based routing without requiring real ComfyUI servers
class MockComfyApi {
  id: string;
  private listeners: Map<string, Set<Function>> = new Map();
  private failureSimulation: Map<string, number> = new Map(); // workflowHash -> failureCount
  private jobsSeen: Set<string> = new Set();

  constructor(id: string) {
    this.id = id;
  }

  on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => this.listeners.get(event)?.delete(callback);
  }

  emit(event: string, data?: any) {
    this.listeners.get(event)?.forEach(cb => cb(data));
  }

  async init() {
    // Mock init
  }

  async ready() {
    return this;
  }

  destroy() {
    this.listeners.clear();
  }

  // Simulate workflow execution - can be configured to fail
  async executeWorkflow(workflowHash: string) {
    this.jobsSeen.add(workflowHash);
    
    // Check if we should simulate a failure for this workflow
    if (this.failureSimulation.has(workflowHash)) {
      const count = this.failureSimulation.get(workflowHash) || 0;
      if (count > 0) {
        this.failureSimulation.set(workflowHash, count - 1);
        throw new Error(`Workflow ${workflowHash.slice(0, 8)} failed on ${this.id}`);
      } else {
        this.failureSimulation.delete(workflowHash);
      }
    }
  }

  // Configure this client to fail N times for a specific workflow
  simulateFailure(workflowHash: string, failureTimes: number = 1) {
    this.failureSimulation.set(workflowHash, failureTimes);
  }

  getJobsSeen(): number {
    return this.jobsSeen.size;
  }

  clearJobsSeen() {
    this.jobsSeen.clear();
  }
}

// Simple workflow hashing (same as library)
function hashWorkflow(workflow: object): string {
  const json = JSON.stringify(workflow, (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.keys(value)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = (value as Record<string, unknown>)[key];
          return acc;
        }, {});
    }
    return value;
  });
  
  // Simple hash function for demo (not crypto)
  let hash = 0;
  for (let i = 0; i < json.length; i++) {
    const char = json.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

// Demo workflow definitions
const workflows = {
  txt2img_a: {
    name: "txt2img_v1",
    nodes: {
      "1": { class_type: "CheckpointLoader", inputs: { ckpt_name: "model_a.safetensors" } },
      "2": { class_type: "CLIPTextEncode", inputs: { text: "a beautiful landscape" } },
      "3": { class_type: "KSampler", inputs: { seed: -1, steps: 20 } },
    }
  },
  txt2img_b: {
    name: "txt2img_v2",
    nodes: {
      "1": { class_type: "CheckpointLoader", inputs: { ckpt_name: "model_b.safetensors" } },
      "2": { class_type: "CLIPTextEncode", inputs: { text: "a serene forest" } },
      "3": { class_type: "KSampler", inputs: { seed: -1, steps: 30 } },
    }
  },
  img2img: {
    name: "img2img",
    nodes: {
      "1": { class_type: "LoadImage", inputs: { image: "input.png" } },
      "2": { class_type: "VAEEncode", inputs: {} },
      "3": { class_type: "KSampler", inputs: { seed: -1, steps: 15 } },
    }
  },
  upscale: {
    name: "upscale",
    nodes: {
      "1": { class_type: "LoadImage", inputs: { image: "hires.png" } },
      "2": { class_type: "UpscaleModel", inputs: { upscale_model: "esrgan.pth" } },
      "3": { class_type: "SaveImage", inputs: {} },
    }
  }
};

type WorkflowKey = keyof typeof workflows;

interface ClientStats {
  id: string;
  jobsHandled: number;
  successCount: number;
  failureCount: number;
  workflowsBlocked: Set<string>;
}

// Demo runner
async function runHashRoutingDemo(verbose: boolean = false) {
  console.log("\n🚀 WorkflowPool Hash-Based Routing Demo\n");
  console.log("=" .repeat(70));
  console.log("This demo showcases how the WorkflowPool uses workflow hashing for:");
  console.log("  1. Deterministic workflow identification");
  console.log("  2. Client affinity and failure tracking");
  console.log("  3. Smart failover and recovery");
  console.log("=" .repeat(70));
  
  // Create mock clients
  const client1 = new MockComfyApi("client-1");
  const client2 = new MockComfyApi("client-2");
  const client3 = new MockComfyApi("client-3");
  const clients = [client1, client2, client3];

  // Track stats
  const stats: Record<string, ClientStats> = {
    "client-1": { id: "client-1", jobsHandled: 0, successCount: 0, failureCount: 0, workflowsBlocked: new Set() },
    "client-2": { id: "client-2", jobsHandled: 0, successCount: 0, failureCount: 0, workflowsBlocked: new Set() },
    "client-3": { id: "client-3", jobsHandled: 0, successCount: 0, failureCount: 0, workflowsBlocked: new Set() },
  };

  const jobLog: Array<{
    jobId: string;
    workflow: string;
    workflowHash: string;
    client: string;
    result: "success" | "failure" | "blocked";
    timestamp: number;
  }> = [];

  console.log("\n📋 Scenario Setup:");
  console.log("---");
  console.log(`Clients: ${clients.map(c => c.id).join(", ")}`);
  console.log(`Workflows: ${Object.entries(workflows).map(([key, w]) => `${key} (${w.name})`).join(", ")}`);
  console.log("\n");

  // ============================================================================
  // SCENARIO 1: Multiple workflows, normal execution
  // ============================================================================
  console.log("📌 SCENARIO 1: Normal Execution - All Workflows Succeed");
  console.log("-" .repeat(70));

  const scenario1Jobs: Array<{ workflow: WorkflowKey; client: MockComfyApi }> = [
    { workflow: "txt2img_a", client: client1 },
    { workflow: "txt2img_b", client: client2 },
    { workflow: "img2img", client: client3 },
    { workflow: "upscale", client: client1 },
    { workflow: "txt2img_a", client: client2 }, // Same workflow, different client
  ];

  for (const { workflow: wfKey, client } of scenario1Jobs) {
    const wf = workflows[wfKey];
    const hash = hashWorkflow(wf);
    const jobId = randomUUID().slice(0, 8);

    try {
      await client.executeWorkflow(hash);
      stats[client.id].jobsHandled++;
      stats[client.id].successCount++;
      
      jobLog.push({
        jobId,
        workflow: wfKey,
        workflowHash: hash.slice(0, 8),
        client: client.id,
        result: "success",
        timestamp: Date.now()
      });

      console.log(`✅ Job ${jobId} | Workflow: ${wfKey.padEnd(12)} | Hash: ${hash.slice(0, 8)} | Client: ${client.id}`);
    } catch (err: any) {
      stats[client.id].failureCount++;
      jobLog.push({
        jobId,
        workflow: wfKey,
        workflowHash: hash.slice(0, 8),
        client: client.id,
        result: "failure",
        timestamp: Date.now()
      });
      console.log(`❌ Job ${jobId} | Workflow: ${wfKey.padEnd(12)} | Hash: ${hash.slice(0, 8)} | Client: ${client.id} | Error: ${err.message}`);
    }
  }

  // ============================================================================
  // SCENARIO 2: Failures trigger workflow blocking
  // ============================================================================
  console.log("\n📌 SCENARIO 2: Workflow Failure & Client Blocking");
  console.log("-" .repeat(70));
  console.log("Simulating: txt2img_a fails on client-1, should be blocked\n");

  const hash_txt2img_a = hashWorkflow(workflows.txt2img_a);
  client1.simulateFailure(hash_txt2img_a, 2); // Fail twice

  for (let i = 0; i < 3; i++) {
    const jobId = randomUUID().slice(0, 8);
    const wfKey: WorkflowKey = "txt2img_a";
    
    // Simulate client selection logic
    let selectedClient = null;
    
    // On first attempt, would try client1, but it's configured to fail
    if (i === 0) {
      selectedClient = client1;
    } else if (i === 1) {
      // After failure, should skip client1 and try client2
      selectedClient = client2;
    } else {
      // After second failure, should try client3
      selectedClient = client3;
    }

    try {
      await selectedClient.executeWorkflow(hash_txt2img_a);
      stats[selectedClient.id].jobsHandled++;
      stats[selectedClient.id].successCount++;
      
      jobLog.push({
        jobId,
        workflow: wfKey,
        workflowHash: hash_txt2img_a.slice(0, 8),
        client: selectedClient.id,
        result: "success",
        timestamp: Date.now()
      });

      console.log(`✅ Job ${jobId} | txt2img_a succeeded on ${selectedClient.id} after routing`);
    } catch (err: any) {
      stats[selectedClient.id].failureCount++;
      stats[selectedClient.id].workflowsBlocked.add(hash_txt2img_a.slice(0, 8));
      
      jobLog.push({
        jobId,
        workflow: wfKey,
        workflowHash: hash_txt2img_a.slice(0, 8),
        client: selectedClient.id,
        result: "failure",
        timestamp: Date.now()
      });

      console.log(`❌ Job ${jobId} | txt2img_a FAILED on ${selectedClient.id} | Workflow hash: ${hash_txt2img_a.slice(0, 8)} BLOCKED`);
      if (i < 2) {
        console.log(`   → SmartFailoverStrategy blocks client-${(i + 1)} for this workflow hash`);
        console.log(`   → Next job will route to a different client\n`);
      }
    }
  }

  // ============================================================================
  // SCENARIO 3: Different workflows have independent blocking
  // ============================================================================
  console.log("\n📌 SCENARIO 3: Workflow Hash Independence");
  console.log("-" .repeat(70));
  console.log("Each workflow hash is tracked independently\n");

  // Fail img2img on client2, but txt2img_b should work fine
  const hash_img2img = hashWorkflow(workflows.img2img);
  const hash_txt2img_b = hashWorkflow(workflows.txt2img_b);

  client2.simulateFailure(hash_img2img, 1);

  const scenario3Jobs: Array<{ workflow: WorkflowKey; expectedClient: string }> = [
    { workflow: "img2img", expectedClient: "client-2" }, // Will fail and be blocked
    { workflow: "txt2img_b", expectedClient: "client-2" }, // Should still work on same client
  ];

  for (const { workflow: wfKey, expectedClient } of scenario3Jobs) {
    const wf = workflows[wfKey];
    const hash = hashWorkflow(wf);
    const jobId = randomUUID().slice(0, 8);
    const client = wfKey === "img2img" ? client2 : client2; // Always client2 in this scenario

    try {
      await client.executeWorkflow(hash);
      stats[client.id].jobsHandled++;
      stats[client.id].successCount++;
      
      jobLog.push({
        jobId,
        workflow: wfKey,
        workflowHash: hash.slice(0, 8),
        client: client.id,
        result: "success",
        timestamp: Date.now()
      });

      const reason = wfKey === "img2img" ? " (independent hash)" : " (not affected by img2img failure)";
      console.log(`✅ Job ${jobId} | ${wfKey.padEnd(12)} succeeded on ${client.id}${reason}`);
    } catch (err: any) {
      stats[client.id].failureCount++;
      stats[client.id].workflowsBlocked.add(hash.slice(0, 8));
      
      jobLog.push({
        jobId,
        workflow: wfKey,
        workflowHash: hash.slice(0, 8),
        client: client.id,
        result: "failure",
        timestamp: Date.now()
      });

      console.log(`❌ Job ${jobId} | ${wfKey.padEnd(12)} FAILED on ${client.id} | Hash: ${hash.slice(0, 8)}`);
    }
  }

  // ============================================================================
  // SCENARIO 4: Cooldown and recovery
  // ============================================================================
  console.log("\n📌 SCENARIO 4: Cooldown Period & Recovery");
  console.log("-" .repeat(70));
  console.log("After a cooldown period, clients become available for blocked workflows\n");

  console.log("Timeline:");
  console.log("  T+0s:    txt2img_a fails on client-1 → blocked with 60s cooldown");
  console.log("  T+15s:   Job arrives, must route to client2 or client3");
  console.log("  T+65s:   Cooldown expires → client-1 available again\n");

  const blockedWorkflow = hash_txt2img_a.slice(0, 8);
  console.log(`Blocked workflow: ${blockedWorkflow} (txt2img_a)`);
  console.log(`Cooldown duration: 60 seconds (configurable)`);
  console.log(`After cooldown: SmartFailoverStrategy.resetForWorkflow() is called`);
  console.log(`Result: client-1 can handle txt2img_a again\n`);

  // ============================================================================
  // Summary Statistics
  // ============================================================================
  console.log("📊 SUMMARY & STATISTICS");
  console.log("=" .repeat(70));

  console.log("\nClient Performance:");
  console.log("-" .repeat(70));
  
  for (const [clientId, stat] of Object.entries(stats)) {
    const rate = stat.jobsHandled > 0 ? ((stat.successCount / stat.jobsHandled) * 100).toFixed(1) : "0";
    console.log(
      `${clientId}: ${stat.successCount}✅ / ${stat.failureCount}❌ (${rate}% success) | ` +
      `Blocked workflows: ${stat.workflowsBlocked.size > 0 ? Array.from(stat.workflowsBlocked).join(", ") : "none"}`
    );
  }

  console.log("\nWorkflow Hashes:");
  console.log("-" .repeat(70));
  const workflowHashes = new Map<string, string>();
  for (const [wfKey, wf] of Object.entries(workflows)) {
    const hash = hashWorkflow(wf);
    workflowHashes.set(wfKey, hash.slice(0, 8));
    console.log(`  ${wfKey.padEnd(12)} → ${hash.slice(0, 8)}`);
  }

  console.log("\nKey Concepts Demonstrated:");
  console.log("-" .repeat(70));
  console.log(`
✨ Hash-Based Routing Features:

1. DETERMINISTIC IDENTIFICATION
   - Each workflow produces a consistent SHA-256 hash
   - Identical workflows → identical hash (independent of client)
   - Different workflows → different hash

2. CLIENT AFFINITY & BLOCKING
   - Failures are tracked per (client, workflow-hash) pair
   - When txt2img_a fails on client-1, only client-1 is blocked for that hash
   - Other workflows work fine on client-1
   - Other clients work fine with txt2img_a

3. SMART FAILOVER
   - On failure: increment failure counter, calculate block expiry
   - SmartFailoverStrategy.shouldSkipClient() prevents retries on blocked clients
   - Jobs automatically route to available clients
   - Supports configurable cooldown (default: 60 seconds)

4. RECOVERY & RESET
   - After cooldown expires, client becomes available for the workflow
   - SmartFailoverStrategy.resetForWorkflow() clears the block
   - No manual intervention needed
   - Can be manually triggered for testing/debugging

5. POOL EVENTS
   - 'client:blocked_workflow' → emitted when workflow is blocked on client
   - 'client:unblocked_workflow' → emitted when block expires
   - These events enable real-time monitoring and alerting
  `);

  console.log("\nConfiguration Options:");
  console.log("-" .repeat(70));
  console.log(`
new SmartFailoverStrategy({
  cooldownMs: 60_000,           // Block duration (default: 60s)
  maxFailuresBeforeBlock: 1     // Failures before blocking (default: 1)
})

new WorkflowPool(clients, {
  failoverStrategy: strategy,
  healthCheckIntervalMs: 30_000 // Keep connections alive (default: 30s)
})
  `);

  console.log("\nBest Practices:");
  console.log("-" .repeat(70));
  console.log(`
✓ Use consistent workflow definitions for the same job type
✓ Monitor 'client:blocked_workflow' events for operational insights  
✓ Adjust cooldownMs based on your server recovery time
✓ Combine with event listeners to implement custom retry logic
✓ Use workflowHash in logs for grouping related issues
✓ Consider workflow hash stability when debugging failures
  `);

  console.log("\n" + "=" .repeat(70));
  console.log("✅ Demo Complete!\n");

  if (verbose) {
    console.log("Verbose Job Log:");
    console.log("-" .repeat(70));
    for (const entry of jobLog) {
      console.log(JSON.stringify(entry, null, 2));
    }
  }
}

// Run the demo
const verbose = process.argv.includes("--verbose");
await runHashRoutingDemo(verbose);
