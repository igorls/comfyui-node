/**
 * Real Server Capability Demo & Hash-Based Routing Test
 * 
 * This demo:
 * 1. Discovers capabilities on all servers
 * 2. Finds compatible models and samplers
 * 3. Creates real workflows based on available models
 * 4. Demonstrates hash-based routing with actual execution
 * 5. Shows failure handling and recovery
 */

import { ComfyApi, WorkflowPool, SmartFailoverStrategy, MemoryQueueAdapter, Workflow } from "../src/index.js";

const HOSTS = (process.env.COMFY_HOSTS || "http://127.0.0.1:8188").split(",").map(h => h.trim());

interface ServerCapabilities {
  id: string;
  host: string;
  online: boolean;
  models: string[];
  samplers: string[];
  schedulers: string[];
  upscaleModels: string[];
  loraModels: string[];
  error?: string;
}

class RealServerDemo {
  private capabilities: Map<string, ServerCapabilities> = new Map();
  private pool: WorkflowPool | null = null;

  /**
   * Probe server capabilities
   */
  async discoverCapabilities() {
    console.log("\n🔍 DISCOVERING SERVER CAPABILITIES\n");
    console.log("=" .repeat(70));

    for (const host of HOSTS) {
      try {
        const api = new ComfyApi(host);
        console.log(`\nProbing: ${host}`);

        await api.init();

        // Get available models and settings
        const checkpoints = await api.ext.node.getCheckpoints().catch(() => [] as string[]);
        const samplerInfo = await api.ext.node.getSamplerInfo().catch(() => ({})) as any;
        const samplers = samplerInfo.sampler || [];
        const schedulers = samplerInfo.scheduler || [];
        const loras = await api.ext.node.getLoras().catch(() => [] as string[]);

        const cap: ServerCapabilities = {
          id: api.id,
          host,
          online: true,
          models: Array.isArray(checkpoints) ? checkpoints.slice(0, 5) : [],
          samplers: Array.isArray(samplers) ? samplers.slice(0, 5) : [],
          schedulers: Array.isArray(schedulers) ? schedulers.slice(0, 5) : [],
          upscaleModels: [],
          loraModels: Array.isArray(loras) ? loras.slice(0, 3) : []
        };

        this.capabilities.set(api.id, cap);

        console.log(`  ✅ Online`);
        console.log(`     ID: ${api.id}`);
        console.log(`     Models: ${cap.models.length > 0 ? cap.models.join(", ") : "none"}`);
        console.log(`     Samplers: ${cap.samplers.length > 0 ? cap.samplers.join(", ") : "none"}`);
        console.log(`     Schedulers: ${cap.schedulers.length > 0 ? cap.schedulers.join(", ") : "none"}`);

        api.destroy();
      } catch (err: any) {
        const cap: ServerCapabilities = {
          id: `unknown-${Math.random().toString(36).slice(2, 8)}`,
          host,
          online: false,
          models: [],
          samplers: [],
          schedulers: [],
          upscaleModels: [],
          loraModels: [],
          error: err.message
        };
        this.capabilities.set(host, cap);

        console.log(`  ❌ Offline or unavailable`);
        console.log(`     Error: ${err.message}`);
      }
    }

    const onlineCount = Array.from(this.capabilities.values()).filter(c => c.online).length;
    console.log(`\n✅ Found ${onlineCount}/${this.capabilities.size} online servers`);
    console.log("=" .repeat(70));

    return onlineCount > 0;
  }

  /**
   * Find common capabilities across all online servers
   */
  getCommonCapabilities() {
    const online = Array.from(this.capabilities.values()).filter(c => c.online);

    if (online.length === 0) {
      return null;
    }

    // Find intersection of capabilities
    const firstServer = online[0];
    const commonModels = firstServer.models.filter(model =>
      online.every(srv => srv.models.includes(model))
    );
    const commonSamplers = firstServer.samplers.filter(sampler =>
      online.every(srv => srv.samplers.includes(sampler))
    );

    return {
      models: commonModels,
      samplers: commonSamplers,
      hasCommonModels: commonModels.length > 0,
      hasCommonSamplers: commonSamplers.length > 0
    };
  }

  /**
   * Create a basic text-to-image workflow from available capabilities
   */
  createBasicWorkflow() {
    const common = this.getCommonCapabilities();

    if (!common || !common.hasCommonModels || !common.hasCommonSamplers) {
      console.log(
        "⚠️  No common models/samplers. Creating minimal workflow (may fail on some servers)..."
      );
    }

    const model = common?.models[0] || "model.safetensors";
    const sampler = common?.samplers[0] || "euler";

    return {
      "1": {
        class_type: "CheckpointLoader",
        inputs: { ckpt_name: model }
      },
      "2": {
        class_type: "CLIPTextEncode",
        inputs: {
          text: "a beautiful landscape with mountains and lake, masterpiece, detailed",
          clip: ["1", 1]
        }
      },
      "3": {
        class_type: "CLIPTextEncode",
        inputs: {
          text: "blurry, low quality",
          clip: ["1", 1]
        }
      },
      "4": {
        class_type: "KSampler",
        inputs: {
          seed: 12345,
          steps: 10,
          cfg: 7.0,
          sampler_name: sampler,
          scheduler: "normal",
          denoise: 1.0,
          model: ["1", 0],
          positive: ["2", 0],
          negative: ["3", 0],
          latent_image: ["5", 0]
        }
      },
      "5": {
        class_type: "EmptyLatentImage",
        inputs: { width: 512, height: 512, batch_size: 1 }
      },
      "6": {
        class_type: "VAEDecode",
        inputs: { samples: ["4", 0], vae: ["1", 2] }
      },
      "7": {
        class_type: "SaveImage",
        inputs: { images: ["6", 0], filename_prefix: "demo" }
      }
    };
  }

  /**
   * Initialize the pool and run demonstrations
   */
  async initializePool() {
    const onlineServers = Array.from(this.capabilities.values())
      .filter(c => c.online)
      .map(c => new ComfyApi(c.host));

    if (onlineServers.length === 0) {
      throw new Error("No online servers available");
    }

    console.log(`\n📦 INITIALIZING WORKFLOW POOL\n`);
    console.log("=" .repeat(70));

    this.pool = new WorkflowPool(onlineServers, {
      failoverStrategy: new SmartFailoverStrategy({
        cooldownMs: 30_000,
        maxFailuresBeforeBlock: 1
      }),
      queueAdapter: new MemoryQueueAdapter(),
      healthCheckIntervalMs: 20_000
    });

    await this.pool.ready();

    console.log(`✅ Pool ready with ${onlineServers.length} server(s)\n`);

    return this.pool;
  }

  /**
   * Set up event monitoring
   */
  setupMonitoring() {
    if (!this.pool) return null;

    let blockedCount = 0;
    let completedCount = 0;
    let failedCount = 0;

    console.log("\n📊 SETTING UP EVENT MONITORING\n");
    console.log("=" .repeat(70));

    this.pool.on("pool:ready", (ev) => {
      console.log("✅ Pool ready:", ev.detail.clientIds.join(", "));
    });

    this.pool.on("job:queued", (ev) => {
      console.log(`  📋 Job queued: ${ev.detail.job.jobId.slice(0, 8)}`);
    });

    this.pool.on("job:started", (ev) => {
      console.log(`  ▶️  Job started on ${ev.detail.job.clientId?.slice(0, 8)}`);
    });

    this.pool.on("job:progress", (ev) => {
      const progress = ev.detail.progress as any;
      if (progress?.value && progress?.max) {
        const pct = Math.round((progress.value / progress.max) * 100);
        process.stdout.write(`\r  ⏳ Progress: ${pct}%`);
      }
    });

    this.pool.on("job:completed", (ev) => {
      completedCount++;
      console.log(`\n  ✅ Job completed in ${ev.detail.job.attempts} attempt(s)`);
    });

    this.pool.on("job:failed", (ev) => {
      failedCount++;
      console.log(
        `\n  ❌ Job failed: ${String((ev.detail.job as any).lastError).slice(0, 100)}`
      );
    });

    this.pool.on("client:blocked_workflow", (ev) => {
      blockedCount++;
      console.log(
        `  🚫 BLOCKED: ${ev.detail.clientId.slice(0, 8)} for workflow ${ev.detail.workflowHash.slice(0, 8)}`
      );
    });

    this.pool.on("client:unblocked_workflow", (ev) => {
      console.log(
        `  🔓 UNBLOCKED: ${ev.detail.clientId.slice(0, 8)} recovered for workflow ${ev.detail.workflowHash.slice(0, 8)}`
      );
    });

    return { blockedCount: () => blockedCount, completedCount: () => completedCount, failedCount: () => failedCount };
  }

  /**
   * Run demonstration
   */
  async runDemo() {
    console.log("\n🎯 SUBMITTING WORKFLOW JOBS\n");
    console.log("=" .repeat(70));

    if (!this.pool) {
      throw new Error("Pool not initialized");
    }

    const workflow = this.createBasicWorkflow();

    // Enqueue multiple variations
    const jobIds: string[] = [];

    // Job 1: Original workflow
    try {
      console.log("\n1️⃣  Submitting baseline workflow...");
      const jobId1 = await this.pool.enqueue(workflow, {
        priority: 5,
        metadata: {
          demo: "baseline",
          description: "Standard text-to-image"
        }
      });
      jobIds.push(jobId1);
      console.log(`   Job ID: ${jobId1.slice(0, 8)}`);
    } catch (err: any) {
      console.error(`   ❌ Failed: ${err.message}`);
    }

    // Job 2: Workflow with different seed (different hash)
    try {
      console.log("\n2️⃣  Submitting variation (different seed)...");
      const wf2 = JSON.parse(JSON.stringify(workflow));
      wf2["4"].inputs.seed = 99999;
      wf2["4"].inputs.steps = 15; // More steps for variation

      const jobId2 = await this.pool.enqueue(wf2, {
        priority: 5,
        metadata: {
          demo: "variation",
          description: "Different seed and steps"
        }
      });
      jobIds.push(jobId2);
      console.log(`   Job ID: ${jobId2.slice(0, 8)}`);
    } catch (err: any) {
      console.error(`   ❌ Failed: ${err.message}`);
    }

    // Job 3: Same as Job 1 (should have same hash - demonstrates deterministic hashing)
    try {
      console.log("\n3️⃣  Submitting duplicate workflow (same hash)...");
      const jobId3 = await this.pool.enqueue(workflow, {
        priority: 5,
        metadata: {
          demo: "duplicate",
          description: "Identical to job 1 - same hash"
        }
      });
      jobIds.push(jobId3);
      console.log(`   Job ID: ${jobId3.slice(0, 8)}`);
    } catch (err: any) {
      console.error(`   ❌ Failed: ${err.message}`);
    }

    console.log(`\n✅ Submitted ${jobIds.length} jobs\n`);

    return jobIds;
  }

  /**
   * Print final report
   */
  printReport(stats: { blockedCount: () => number; completedCount: () => number; failedCount: () => number }) {
    console.log("\n" + "=" .repeat(70));
    console.log("📊 FINAL REPORT");
    console.log("=" .repeat(70));

    console.log("\n🖥️  Server Status:");
    for (const cap of this.capabilities.values()) {
      const status = cap.online ? "🟢 ONLINE" : "🔴 OFFLINE";
      console.log(`  ${status} ${cap.host}`);
      if (cap.error) {
        console.log(`       Error: ${cap.error}`);
      }
      if (cap.online) {
        console.log(`       Models: ${cap.models.length}`);
        console.log(`       Samplers: ${cap.samplers.length}`);
      }
    }

    console.log("\n📈 Job Statistics:");
    console.log(`  Completed: ${stats.completedCount()}✅`);
    console.log(`  Failed: ${stats.failedCount()}❌`);
    console.log(`  Blocked Workflows: ${stats.blockedCount()}🚫`);

    console.log("\n🔑 Key Insights:");
    console.log("  • Each workflow has a deterministic hash");
    console.log("  • Failures tracked per (client, workflow-hash)");
    console.log("  • Duplicate workflows have same hash");
    console.log("  • Blocked workflows auto-unblock after cooldown");
    console.log("  • Pool routes around blocked combinations");

    console.log("\n✨ Hash-Based Routing Benefits:");
    console.log("  ✓ Fine-grained failure tracking");
    console.log("  ✓ Intelligent automatic failover");
    console.log("  ✓ Multi-tenant safe isolation");
    console.log("  ✓ Self-healing recovery");
    console.log("  ✓ Observable via events");

    console.log("\n" + "=" .repeat(70) + "\n");
  }

  async cleanup() {
    if (this.pool) {
      await this.pool.shutdown();
    }
  }
}

// Main execution
async function main() {
  console.log("\n╔════════════════════════════════════════════════════════════════════╗");
  console.log("║  WorkflowPool Hash-Based Routing - Real Server Capability Demo  ║");
  console.log("╚════════════════════════════════════════════════════════════════════╝");

  const demo = new RealServerDemo();

  try {
    // Step 1: Discover capabilities
    const hasServers = await demo.discoverCapabilities();

    if (!hasServers) {
      console.log("\n⚠️  No online servers found. Running simulation only.\n");
      console.log("To test with real servers, run:");
      console.log("  COMFY_HOSTS=http://host1:8188,http://host2:8188 bun scripts/pool-real-demo.ts");
      return;
    }

    // Step 2: Initialize pool
    await demo.initializePool();

    // Step 3: Set up monitoring
    const stats = demo.setupMonitoring();
    
    if (!stats) {
      throw new Error("Failed to set up monitoring");
    }

    // Step 4: Run demo
    const jobIds = await demo.runDemo();

    // Step 5: Wait for jobs to complete
    console.log("⏳ Waiting for jobs (30 second timeout)...\n");
    await new Promise(resolve => setTimeout(resolve, 30000));

    // Step 6: Print report
    demo.printReport(stats);
  } catch (err: any) {
    console.error("\n❌ Error:", err.message);
  } finally {
    await demo.cleanup();
  }
}

await main();
