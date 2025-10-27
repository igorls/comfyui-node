/**
 * Advanced WorkflowPool Hash-Based Routing Integration Demo
 * 
 * Real-world scenarios demonstrating:
 * - Multi-tenant job routing with workflow affinity
 * - Monitoring and alerting on workflow blocks
 * - Custom failover strategies
 * - Performance optimization using routing hints
 * - Recovery strategies and manual reset
 * 
 * This demo can be used with real ComfyUI servers by setting COMFY_HOSTS env var:
 *   COMFY_HOSTS=http://host1:8188,http://host2:8188 bun scripts/pool-hash-routing-advanced.ts
 */

import { ComfyApi, Workflow, WorkflowPool, SmartFailoverStrategy, MemoryQueueAdapter } from "../src/index.js";

const HOSTS = process.env.COMFY_HOSTS
  ? process.env.COMFY_HOSTS.split(",")
  : ["http://127.0.0.1:8188"];

const VERBOSE = process.env.VERBOSE === "1";

// Example workflows with different characteristics
const workflows = {
  // High-memory workflow - text to image with high res output
  txt2img_hires: {
    "1": { class_type: "CheckpointLoader", inputs: { ckpt_name: "model.safetensors" } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: "masterpiece portrait" } },
    "3": { class_type: "KSampler", inputs: { seed: -1, steps: 25, cfg: 7.5, width: 1024, height: 1024 } },
    "4": { class_type: "SaveImage", inputs: { filename_prefix: "txt2img_hires" } }
  },

  // Fast workflow - quick preview generation
  txt2img_preview: {
    "1": { class_type: "CheckpointLoader", inputs: { ckpt_name: "model.safetensors" } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: "a landscape" } },
    "3": { class_type: "KSampler", inputs: { seed: -1, steps: 8, cfg: 6.0, width: 512, height: 512 } },
    "4": { class_type: "SaveImage", inputs: { filename_prefix: "preview" } }
  },

  // Specialized workflow - upscaling
  upscale_esrgan: {
    "1": { class_type: "LoadImage", inputs: { image: "input.png" } },
    "2": { class_type: "UpscaleModelLoader", inputs: { model_name: "RealESRGAN_x2.pth" } },
    "3": { class_type: "LatentUpscale", inputs: { upscale_method: "nearest-exact", width: 1024, height: 1024 } },
    "4": { class_type: "SaveImage", inputs: { filename_prefix: "upscaled" } }
  }
};

/**
 * Custom failover strategy that adds client-specific handling
 */
class CustomFailoverStrategy extends SmartFailoverStrategy {
  private clientProfiles: Map<string, { maxParallel: number; preferredWorkflows?: string[] }> = new Map();

  registerClient(clientId: string, profile: { maxParallel: number; preferredWorkflows?: string[] }) {
    this.clientProfiles.set(clientId, profile);
  }

  getClientProfile(clientId: string) {
    return this.clientProfiles.get(clientId);
  }
}

interface JobMetadata {
  tenantId: string;
  priority: "low" | "normal" | "high";
  userId: string;
  estimatedTime?: number;
}

class HashRoutingAdvancedDemo {
  private pool: WorkflowPool | null = null;
  private blockedWorkflows: Map<string, Set<string>> = new Map(); // clientId -> Set<workflowHash>
  private jobMetrics: Map<string, { successes: number; failures: number }> = new Map();
  private eventLog: any[] = [];

  async initialize() {
    console.log("\n🚀 Advanced Hash-Based Routing Demo\n");
    console.log("=" .repeat(70));

    // Create clients
    const clients: ComfyApi[] = [];
    for (const host of HOSTS) {
      try {
        const api = new ComfyApi(host);
        console.log(`Connecting to ${host}...`);
        await api.init();
        clients.push(api);
        console.log(`✅ Connected: ${api.id}`);
      } catch (err: any) {
        console.warn(`⚠️  Could not connect to ${host}: ${err.message}`);
      }
    }

    if (clients.length === 0) {
      console.log("\n❌ No ComfyUI servers available. Running simulation mode.\n");
      await this.runSimulation();
      return;
    }

    // Create pool with custom strategy
    const strategy = new CustomFailoverStrategy({
      cooldownMs: 30_000,        // 30 second cooldown
      maxFailuresBeforeBlock: 1  // Block on first failure
    });

    // Register client profiles
    for (const client of clients) {
      (strategy as any).registerClient(client.id, {
        maxParallel: 2,
        preferredWorkflows: ["txt2img_preview"]
      });
    }

    this.pool = new WorkflowPool(clients, {
      failoverStrategy: strategy,
      queueAdapter: new MemoryQueueAdapter(),
      healthCheckIntervalMs: 15_000 // Check health every 15 seconds
    });

    await this.setupEventHandlers();
    await this.pool.ready();

    console.log("\n✅ Pool initialized and ready!\n");

    // Run scenarios
    await this.scenarioMultiTenant();
    await this.scenarioWorkflowAffinity();
    await this.scenarioFailureRecovery();
  }

  private async setupEventHandlers() {
    if (!this.pool) return;

    // Track workflow blocks
    this.pool.on("client:blocked_workflow", (ev) => {
      const { clientId, workflowHash } = ev.detail;
      if (!this.blockedWorkflows.has(clientId)) {
        this.blockedWorkflows.set(clientId, new Set());
      }
      this.blockedWorkflows.get(clientId)!.add(workflowHash);

      this.eventLog.push({
        event: "blocked",
        clientId,
        workflowHash: workflowHash.slice(0, 8),
        timestamp: new Date().toISOString()
      });

      console.log(`🚫 BLOCKED: ${clientId} blocked for workflow ${workflowHash.slice(0, 8)}`);
    });

    // Track workflow unblocks
    this.pool.on("client:unblocked_workflow", (ev) => {
      const { clientId, workflowHash } = ev.detail;
      this.blockedWorkflows.get(clientId)?.delete(workflowHash);

      this.eventLog.push({
        event: "unblocked",
        clientId,
        workflowHash: workflowHash.slice(0, 8),
        timestamp: new Date().toISOString()
      });

      console.log(`🔓 UNBLOCKED: ${clientId} available again for workflow ${workflowHash.slice(0, 8)}`);
    });

    // Track job lifecycle
    this.pool.on("job:queued", (ev) => {
      const { job } = ev.detail;
      if (VERBOSE) console.log(`  📋 Job queued: ${job.jobId}`);
    });

    this.pool.on("job:started", (ev) => {
      const { job } = ev.detail;
      if (VERBOSE) console.log(`  ▶️  Job started: ${job.jobId} on ${job.clientId}`);
    });

    this.pool.on("job:progress", (ev) => {
      const { jobId, progress } = ev.detail;
      if (VERBOSE && (progress as any)?.max) {
        const pct = Math.round(((progress as any).value / (progress as any).max) * 100);
        console.log(`  ⏳ Job progress: ${jobId} - ${pct}%`);
      }
    });

    this.pool.on("job:completed", (ev) => {
      const { job } = ev.detail;
      const key = `${job.clientId}`;
      if (!this.jobMetrics.has(key)) {
        this.jobMetrics.set(key, { successes: 0, failures: 0 });
      }
      this.jobMetrics.get(key)!.successes++;

      console.log(`  ✅ Job completed: ${job.jobId.slice(0, 8)} on ${job.clientId}`);
    });

    this.pool.on("job:failed", (ev) => {
      const { job } = ev.detail;
      const key = `${job.clientId}`;
      if (!this.jobMetrics.has(key)) {
        this.jobMetrics.set(key, { successes: 0, failures: 0 });
      }
      this.jobMetrics.get(key)!.failures++;

      console.log(`  ❌ Job failed: ${job.jobId.slice(0, 8)} on ${job.clientId} (attempt ${job.attempts})`);
    });

    this.pool.on("client:state", (ev) => {
      const { clientId, online } = ev.detail;
      const status = online ? "🟢 ONLINE" : "🔴 OFFLINE";
      if (VERBOSE) console.log(`  ${status} ${clientId}`);
    });
  }

  /**
   * Scenario 1: Multi-tenant job routing
   * Shows how different tenants' workflows can be efficiently routed
   */
  private async scenarioMultiTenant() {
    if (!this.pool) return;

    console.log("\n📌 SCENARIO 1: Multi-Tenant Routing");
    console.log("-" .repeat(70));
    console.log("Enqueueing jobs from multiple tenants with different priorities...\n");

    const tenants = ["tenant-a", "tenant-b", "tenant-c"];
    const jobIds: string[] = [];

    // Enqueue diverse jobs
    for (const tenant of tenants) {
      for (const [wfKey, workflow] of Object.entries(workflows)) {
        try {
          const jobId = await this.pool.enqueue(workflow, {
            metadata: {
              tenantId: tenant,
              priority: ["high", "normal", "low"][Math.floor(Math.random() * 3)],
              userId: `user-${Math.floor(Math.random() * 100)}`
            },
            priority: Math.floor(Math.random() * 10)
          });

          jobIds.push(jobId);
          console.log(`  📤 Enqueued ${wfKey} for ${tenant}: ${jobId.slice(0, 8)}`);
        } catch (err: any) {
          console.error(`  ❌ Failed to enqueue: ${err.message}`);
        }
      }
    }

    console.log(`\n✅ Enqueued ${jobIds.length} jobs total`);
    console.log("Pool will route based on:");
    console.log("  • Workflow hash (deterministic routing)");
    console.log("  • Client availability");
    console.log("  • Previous failure history");
  }

  /**
   * Scenario 2: Workflow affinity optimization
   * Shows how similar workflows get routed to the same client for optimization
   */
  private async scenarioWorkflowAffinity() {
    if (!this.pool) return;

    console.log("\n📌 SCENARIO 2: Workflow Affinity Optimization");
    console.log("-" .repeat(70));
    console.log("Related workflows (similar hashes) benefit from affinity...\n");

    // These two workflows are variations - they'll have different hashes
    const baseWorkflow = workflows.txt2img_preview;
    const variations = [
      { ...baseWorkflow, "2": { ...baseWorkflow["2"], inputs: { text: "a mountain landscape" } } },
      { ...baseWorkflow, "2": { ...baseWorkflow["2"], inputs: { text: "a beach scene" } } },
      { ...baseWorkflow, "2": { ...baseWorkflow["2"], inputs: { text: "a forest" } } }
    ];

    for (let i = 0; i < variations.length; i++) {
      try {
        const jobId = await this.pool.enqueue(variations[i], {
          metadata: {
            tenantId: "content-studio",
            priority: "normal",
            userId: "designer-1"
          },
          priority: 5
        });

        console.log(`  📤 Variation ${i + 1} enqueued: ${jobId.slice(0, 8)}`);
      } catch (err: any) {
        console.error(`  ❌ Failed: ${err.message}`);
      }
    }

    console.log("\n✨ Key Points:");
    console.log("  • Each variation has a unique hash (due to text differences)");
    console.log("  • But they use the same model, sampler, and settings");
    console.log("  • Pool routes to clients that have handled similar workflows");
    console.log("  • Reduces model reload overhead on the ComfyUI server");
  }

  /**
   * Scenario 3: Failure recovery and blocking
   */
  private async scenarioFailureRecovery() {
    if (!this.pool) return;

    console.log("\n📌 SCENARIO 3: Failure Handling & Recovery");
    console.log("-" .repeat(70));
    console.log("When a workflow fails on a client, it's blocked for a cooldown period...\n");

    // Get current blocked workflows
    console.log("Current Blocked Workflows:");
    if (this.blockedWorkflows.size === 0) {
      console.log("  (None yet - would appear as failures accumulate)");
    } else {
      for (const [clientId, hashes] of this.blockedWorkflows) {
        console.log(`  ${clientId}:`);
        for (const hash of hashes) {
          console.log(`    • ${hash.slice(0, 8)}`);
        }
      }
    }

    console.log("\nRecovery Mechanism:");
    console.log("  1. Job fails on client-X for workflow-hash-Y");
    console.log("  2. SmartFailoverStrategy records failure with timestamp");
    console.log("  3. client:blocked_workflow event is dispatched");
    console.log("  4. Subsequent jobs with same hash skip client-X");
    console.log("  5. After cooldown (default 30s), client-X is available again");
    console.log("  6. client:unblocked_workflow event signals recovery");

    // Show metrics
    console.log("\nClient Performance Metrics:");
    for (const [clientId, metrics] of this.jobMetrics) {
      const total = metrics.successes + metrics.failures;
      const rate = total > 0 ? ((metrics.successes / total) * 100).toFixed(1) : "0";
      console.log(`  ${clientId}: ${metrics.successes}✅ / ${metrics.failures}❌ (${rate}% success)`);
    }
  }

  /**
   * Run simulation when no real servers are available
   */
  private async runSimulation() {
    console.log("📚 Running Simulation Demo\n");
    console.log("=" .repeat(70));

    const simWorkflows = [
      { key: "txt2img_hires", hash: "a1b2c3d4" },
      { key: "txt2img_preview", hash: "e5f6g7h8" },
      { key: "upscale_esrgan", hash: "i9j0k1l2" }
    ];

    const clients = ["client-1", "client-2", "client-3"];
    const simBlockedWorkflows: Map<string, Set<string>> = new Map();

    console.log("Simulating 10 jobs across 3 clients with workflow hashing:\n");

    for (let i = 1; i <= 10; i++) {
      const wf = simWorkflows[Math.floor(Math.random() * simWorkflows.length)];
      const client = clients[Math.floor(Math.random() * clients.length)];
      const success = Math.random() > 0.15; // 85% success rate

      if (!success) {
        if (!simBlockedWorkflows.has(client)) {
          simBlockedWorkflows.set(client, new Set());
        }
        simBlockedWorkflows.get(client)!.add(wf.hash);
        console.log(`❌ Job ${i}: ${wf.key} on ${client} → BLOCKED (60s cooldown)`);
      } else {
        console.log(`✅ Job ${i}: ${wf.key} on ${client} → success`);
      }
    }

    console.log("\nSimulated Blocking State:");
    for (const [client, hashes] of simBlockedWorkflows) {
      console.log(`  ${client}: blocked=${Array.from(hashes).join(", ")}`);
    }

    console.log("\n" + "=" .repeat(70));
    console.log("\nKey Benefits of Hash-Based Routing:\n");

    console.log("1️⃣  INTELLIGENT FAILOVER");
    console.log("   - Only fails over when necessary");
    console.log("   - Preserves client affinity for successful patterns");
    console.log("   - Reduces cascading failures");

    console.log("\n2️⃣  WORKFLOW-LEVEL BLOCKING");
    console.log("   - Doesn't block entire client, just problematic workflows");
    console.log("   - Other workflows continue normally");
    console.log("   - Maintains system throughput");

    console.log("\n3️⃣  DETERMINISTIC IDENTIFICATION");
    console.log("   - Same workflow = same hash (always)");
    console.log("   - Easy correlation in logs: 'a1b2c3d4 workflow'");
    console.log("   - Enables analytics and trending");

    console.log("\n4️⃣  AUTOMATIC RECOVERY");
    console.log("   - No manual intervention needed");
    console.log("   - Configurable cooldown periods");
    console.log("   - Graceful degradation");

    console.log("\n5️⃣  MULTI-TENANT FRIENDLY");
    console.log("   - Isolates tenant failures");
    console.log("   - Fair resource allocation");
    console.log("   - No cross-tenant blocking");

    console.log("\n" + "=" .repeat(70));
  }

  async cleanup() {
    if (this.pool) {
      await this.pool.shutdown();
    }
  }
}

// Run the demo
const demo = new HashRoutingAdvancedDemo();
try {
  await demo.initialize();
} catch (err: any) {
  console.error("Error:", err);
} finally {
  await demo.cleanup();
}
