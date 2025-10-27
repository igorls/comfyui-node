/**
 * Real-world example: Multi-tenant image generation service with monitoring
 * 
 * Demonstrates:
 * - Multi-tenant job isolation via hash-based routing
 * - Workflow failure detection and alerts
 * - Performance monitoring per workflow
 * - Graceful degradation under load
 */

import { ComfyApi, WorkflowPool, SmartFailoverStrategy, MemoryQueueAdapter } from "../src/index.js";

// Example workflows (replace with your actual workflows)
const workflows = {
  txt2img: {
    "1": { class_type: "CheckpointLoader", inputs: { ckpt_name: "model.safetensors" } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: "a landscape", clip: ["1", 1] } },
    "3": { class_type: "KSampler", inputs: { seed: -1, steps: 20, cfg: 7.0, sampler_name: "euler" } },
    "4": { class_type: "SaveImage", inputs: { images: ["3", 0] } }
  },
  upscale: {
    "1": { class_type: "LoadImage", inputs: { image: "input.png" } },
    "2": { class_type: "UpscaleModelLoader", inputs: { model_name: "RealESRGAN_x2.pth" } },
    "3": { class_type: "LatentUpscale", inputs: { upscale_method: "nearest-exact", width: 2048, height: 2048 } },
    "4": { class_type: "SaveImage", inputs: { images: ["3", 0] } }
  }
};

// Multi-tenant request
interface TenantRequest {
  tenantId: string;
  workflowType: keyof typeof workflows;
  priority: number;
  metadata: Record<string, any>;
}

// Monitoring state
interface TenantMetrics {
  successCount: number;
  failureCount: number;
  totalTime: number;
  avgTime: number;
  lastError?: string;
  blockedWorkflows: Set<string>;
}

class MultiTenantImageService {
  private pool: WorkflowPool | null = null;
  private metrics: Map<string, TenantMetrics> = new Map();
  private requestQueue: TenantRequest[] = [];

  async initialize(hosts: string[]) {
    console.log("🚀 Initializing Multi-Tenant Image Service");
    console.log(`📍 Connecting to ${hosts.length} servers...\n`);

    // Create clients
    const clients: ComfyApi[] = [];
    for (const host of hosts) {
      try {
        const api = new ComfyApi(host);
        await api.init();
        clients.push(api);
        console.log(`✅ Connected to ${host} (${api.id})`);
      } catch (err: any) {
        console.warn(`⚠️  Could not connect to ${host}: ${err.message}`);
      }
    }

    if (clients.length === 0) {
      throw new Error("No ComfyUI servers available!");
    }

    // Create pool with smart failover
    const strategy = new SmartFailoverStrategy({
      cooldownMs: 30_000,        // 30 second cooldown
      maxFailuresBeforeBlock: 1  // Block on first failure
    });

    this.pool = new WorkflowPool(clients, {
      failoverStrategy: strategy,
      queueAdapter: new MemoryQueueAdapter(),
      healthCheckIntervalMs: 20_000
    });

    await this.setupMonitoring();
    await this.pool.ready();

    console.log("\n✅ Service initialized and ready!");
    console.log(`📊 Monitoring ${clients.length} clients\n`);
  }

  private async setupMonitoring() {
    if (!this.pool) return;

    // Alert on workflow blocking
    this.pool.on("client:blocked_workflow", (ev) => {
      const { clientId, workflowHash } = ev.detail;
      console.warn(`⚠️  ALERT: ${clientId} blocked for workflow ${workflowHash.slice(0, 8)}`);

      // Update metrics
      for (const [tenantId, metrics] of this.metrics) {
        metrics.blockedWorkflows.add(workflowHash.slice(0, 8));
      }
    });

    // Track recovery
    this.pool.on("client:unblocked_workflow", (ev) => {
      const { clientId, workflowHash } = ev.detail;
      console.log(`✅ RECOVERED: ${clientId} available for workflow ${workflowHash.slice(0, 8)}`);
    });

    // Track job completion
    this.pool.on("job:completed", (ev) => {
      const { job } = ev.detail;
      const tenantId = (job as any).metadata?.tenantId || "unknown";
      const metrics = this.metrics.get(tenantId);

      if (metrics) {
        metrics.successCount++;
        metrics.totalTime += (Date.now() - (job.startedAt || Date.now()));
        metrics.avgTime = metrics.totalTime / (metrics.successCount + metrics.failureCount);
      }

      console.log(`✅ Job completed for ${tenantId} (attempt ${job.attempts})`);
    });

    // Track failures
    this.pool.on("job:failed", (ev) => {
      const { job } = ev.detail;
      const tenantId = (job as any).metadata?.tenantId || "unknown";
      const metrics = this.metrics.get(tenantId);

      if (metrics) {
        metrics.failureCount++;
        metrics.lastError = String((job as any).lastError);
        metrics.totalTime += (Date.now() - (job.startedAt || Date.now()));
        metrics.avgTime = metrics.totalTime / (metrics.successCount + metrics.failureCount);
      }

      console.log(`❌ Job failed for ${tenantId}: ${(job as any).lastError}`);
    });

    // Track progress
    this.pool.on("job:progress", (ev) => {
      const { jobId, progress } = ev.detail;
      const value = (progress as any)?.value ?? 0;
      const max = (progress as any)?.max ?? 1;
      const pct = Math.round((value / max) * 100);
      process.stdout.write(`\r⏳ Job ${jobId.slice(0, 8)} progress: ${pct}%`);
    });
  }

  async submitRequest(request: TenantRequest): Promise<string> {
    if (!this.pool) {
      throw new Error("Pool not initialized");
    }

    // Initialize tenant metrics
    if (!this.metrics.has(request.tenantId)) {
      this.metrics.set(request.tenantId, {
        successCount: 0,
        failureCount: 0,
        totalTime: 0,
        avgTime: 0,
        blockedWorkflows: new Set()
      });
    }

    const workflow = workflows[request.workflowType];
    if (!workflow) {
      throw new Error(`Unknown workflow: ${request.workflowType}`);
    }

    try {
      const jobId = await this.pool.enqueue(workflow, {
        priority: request.priority,
        metadata: {
          tenantId: request.tenantId,
          ...request.metadata
        },
        includeOutputs: ["SaveImage"]
      });

      console.log(`📤 Enqueued: ${request.workflowType} for ${request.tenantId} (jobId: ${jobId.slice(0, 8)})`);
      return jobId;
    } catch (err: any) {
      console.error(`❌ Failed to enqueue: ${err.message}`);
      throw err;
    }
  }

  printReport() {
    console.log("\n" + "=" .repeat(70));
    console.log("📊 MULTI-TENANT SERVICE REPORT");
    console.log("=" .repeat(70));

    for (const [tenantId, metrics] of this.metrics) {
      const total = metrics.successCount + metrics.failureCount;
      const rate = total > 0 ? ((metrics.successCount / total) * 100).toFixed(1) : "0";

      console.log(`\n${tenantId}:`);
      console.log(`  Success: ${metrics.successCount}✅  Failures: ${metrics.failureCount}❌  Rate: ${rate}%`);
      console.log(`  Avg Time: ${Math.round(metrics.avgTime / 1000)}s`);

      if (metrics.blockedWorkflows.size > 0) {
        console.log(`  Blocked Workflows: ${Array.from(metrics.blockedWorkflows).join(", ")}`);
      }

      if (metrics.lastError) {
        console.log(`  Last Error: ${metrics.lastError.slice(0, 80)}`);
      }
    }

    console.log("\n" + "=" .repeat(70));
    console.log("\n✨ Key Benefits of Hash-Based Routing:\n");
    console.log("1. TENANT ISOLATION");
    console.log("   - One tenant's failures don't block others");
    console.log("   - Fair resource allocation\n");

    console.log("2. WORKFLOW AFFINITY");
    console.log("   - Failures tracked per workflow, not per client");
    console.log("   - Intelligent automatic failover\n");

    console.log("3. OBSERVABILITY");
    console.log("   - Real-time monitoring of block/unblock events");
    console.log("   - Easy to correlate issues with specific workflows\n");

    console.log("4. RECOVERY");
    console.log("   - Automatic unblocking after cooldown period");
    console.log("   - No manual intervention needed\n");
  }

  async shutdown() {
    if (this.pool) {
      await this.pool.shutdown();
      console.log("\n✅ Service shutdown complete");
    }
  }
}

// Example usage
async function main() {
  const hosts = (process.env.COMFY_HOSTS || "http://127.0.0.1:8188").split(",");

  const service = new MultiTenantImageService();

  try {
    await service.initialize(hosts);

    // Simulate requests from multiple tenants
    console.log("\n📨 Simulating tenant requests...\n");

    const tenants = ["tenant-a", "tenant-b", "tenant-c"];
    const workflowTypes: Array<keyof typeof workflows> = ["txt2img", "upscale"];

    for (let i = 0; i < 6; i++) {
      const tenant = tenants[i % tenants.length];
      const workflow = workflowTypes[i % workflowTypes.length];

      try {
        await service.submitRequest({
          tenantId: tenant,
          workflowType: workflow,
          priority: Math.floor(Math.random() * 10),
          metadata: {
            userId: `user-${Math.floor(Math.random() * 100)}`,
            batchId: `batch-${i}`
          }
        });

        // Small delay between submissions
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (err) {
        console.error(`Failed to submit request: ${err}`);
      }
    }

    // Wait for jobs to complete (or timeout)
    console.log("\n⏳ Waiting for jobs to complete (30s timeout)...\n");
    await new Promise(resolve => setTimeout(resolve, 30000));

    service.printReport();
  } catch (err: any) {
    console.error(`\n❌ Error: ${err.message}`);
  } finally {
    await service.shutdown();
  }
}

// Run if executed directly
if (import.meta.main) {
  await main();
}
