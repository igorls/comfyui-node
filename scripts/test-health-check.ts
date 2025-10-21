/**
 * Test script to verify WorkflowPool health check mechanism
 * 
 * This test:
 * 1. Creates a WorkflowPool with health check enabled (30 second interval)
 * 2. Monitors for 2 minutes to observe health check activity
 * 3. Verifies no false disconnections occur
 * 4. Sends a prompt after idle period to confirm functionality
 */

import { ComfyApi } from "../src/client.js";
import { WorkflowPool } from "../src/pool/WorkflowPool.js";
import { Workflow } from "../src/workflow.js";

const COMFYUI_HOST = process.env.COMFYUI_HOST || "http://127.0.0.1:8188";
const MONITOR_DURATION_MS = parseInt(process.env.MONITOR_DURATION_MS || "120000", 10); // 2 minutes
const HEALTH_CHECK_INTERVAL_MS = parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || "30000", 10); // 30 seconds

console.log("=== WorkflowPool Health Check Test ===");
console.log(`ComfyUI Host: ${COMFYUI_HOST}`);
console.log(`Health Check Interval: ${HEALTH_CHECK_INTERVAL_MS}ms (${Math.round(HEALTH_CHECK_INTERVAL_MS / 1000)}s)`);
console.log(`Monitor Duration: ${MONITOR_DURATION_MS}ms (${Math.round(MONITOR_DURATION_MS / 1000)}s)`);
console.log("========================================\n");

interface Event {
  timestamp: number;
  type: string;
  clientId?: string;
  details?: any;
}

const events: Event[] = [];

function logEvent(type: string, clientId?: string, details?: any) {
  const timestamp = Date.now();
  events.push({ timestamp, type, clientId, details });
  
  const elapsed = events.length > 1 
    ? timestamp - events[0].timestamp 
    : 0;
  
  console.log(
    `[${new Date(timestamp).toISOString()}] ` +
    `[+${Math.round(elapsed / 1000)}s] ` +
    `${type}` +
    (clientId ? ` [${clientId.slice(0, 8)}]` : "") +
    (details ? ` - ${JSON.stringify(details)}` : "")
  );
}

// Simple text-to-image workflow
const TEST_WORKFLOW = {
  "1": {
    "inputs": {
      "model_name": "svdq-int4_r128-qwen-image-edit-2509-lightningv2.0-4steps.safetensors",
      "cpu_offload": "enable",
      "num_blocks_on_gpu": 20,
      "use_pin_memory": "enable"
    },
    "class_type": "NunchakuQwenImageDiTLoader"
  },
  "2": {
    "inputs": {
      "seed": -1,
      "steps": 4,
      "cfg": 1,
      "sampler_name": "euler",
      "scheduler": "simple",
      "denoise": 1,
      "model": ["1", 0],
      "positive": ["11", 0],
      "negative": ["5", 0],
      "latent_image": ["6", 0]
    },
    "class_type": "KSampler"
  },
  "5": {
    "inputs": {
      "conditioning": ["11", 0]
    },
    "class_type": "ConditioningZeroOut"
  },
  "6": {
    "inputs": {
      "width": 1024,
      "height": 1024,
      "batch_size": 1
    },
    "class_type": "EmptyLatentImage"
  },
  "7": {
    "inputs": {
      "vae_name": "qwen_image_vae.safetensors"
    },
    "class_type": "VAELoader"
  },
  "8": {
    "inputs": {
      "clip_name": "qwen_2.5_vl_7b_fp8_scaled.safetensors",
      "type": "qwen_image",
      "device": "default"
    },
    "class_type": "CLIPLoader"
  },
  "9": {
    "inputs": {
      "samples": ["2", 0],
      "vae": ["7", 0]
    },
    "class_type": "VAEDecode"
  },
  "11": {
    "inputs": {
      "text": "A peaceful lake at dawn with mist, photorealistic",
      "mode": "text_to_image",
      "system_prompt": "You are a camera. Capture reality with perfect accuracy.",
      "scaling_mode": "preserve_resolution",
      "debug_mode": false,
      "auto_label": true,
      "verbose_log": false,
      "Analyze Tokens": "analyze",
      "Open Testing Interface": "test",
      "clip": ["8", 0]
    },
    "class_type": "QwenVLTextEncoder"
  },
  "12": {
    "inputs": {
      "images": ["9", 0]
    },
    "class_type": "PreviewImage"
  }
};

async function main() {
  console.log("Creating client and pool...\n");
  
  // Create client with increased timeout (matches new default)
  const client = new ComfyApi(COMFYUI_HOST, undefined, {
    wsTimeout: 60000, // 60 seconds - matches new default
    debug: false
  });
  
  // Track client events
  client.on("connected", () => {
    logEvent("CLIENT_CONNECTED", client.id);
  });
  
  client.on("disconnected", () => {
    logEvent("CLIENT_DISCONNECTED", client.id);
  });
  
  client.on("reconnecting", () => {
    logEvent("CLIENT_RECONNECTING", client.id);
  });
  
  client.on("reconnected", () => {
    logEvent("CLIENT_RECONNECTED", client.id);
  });
  
  // Create pool with health check
  const pool = new WorkflowPool([client], {
    healthCheckIntervalMs: HEALTH_CHECK_INTERVAL_MS
  });
  
  // Track pool events
  pool.on("pool:ready", (ev) => {
    logEvent("POOL_READY", undefined, { clients: ev.detail.clientIds.length });
  });
  
  pool.on("client:state", (ev) => {
    logEvent("CLIENT_STATE", ev.detail.clientId, { 
      online: ev.detail.online, 
      busy: ev.detail.busy 
    });
  });
  
  pool.on("job:started", (ev) => {
    logEvent("JOB_STARTED", ev.detail.job.clientId, { jobId: ev.detail.job.jobId });
  });
  
  pool.on("job:completed", (ev) => {
    logEvent("JOB_COMPLETED", ev.detail.job.clientId, { jobId: ev.detail.job.jobId });
  });
  
  await pool.ready();
  
  console.log("✓ Pool ready\n");
  console.log(`Monitoring for ${Math.round(MONITOR_DURATION_MS / 1000)} seconds...`);
  console.log(`Health checks will occur every ${Math.round(HEALTH_CHECK_INTERVAL_MS / 1000)} seconds\n`);
  
  const startTime = Date.now();
  const reportInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const disconnects = events.filter(e => e.type === "CLIENT_DISCONNECTED").length;
    const reconnects = events.filter(e => e.type === "CLIENT_RECONNECTED" || e.type === "CLIENT_RECONNECTING").length;
    
    console.log(
      `  ... ${Math.round(elapsed / 1000)}s elapsed ` +
      `(${disconnects} disconnects, ${reconnects} reconnects)`
    );
  }, 15000); // Report every 15 seconds
  
  // Monitor for the specified duration
  await new Promise(resolve => setTimeout(resolve, MONITOR_DURATION_MS));
  
  clearInterval(reportInterval);
  
  const monitorDisconnects = events.filter(e => e.type === "CLIENT_DISCONNECTED").length;
  const monitorReconnects = events.filter(e => e.type === "CLIENT_RECONNECTED" || e.type === "CLIENT_RECONNECTING").length;
  
  console.log(`\n✓ Monitoring period complete`);
  console.log(`  Connection stability: ${monitorDisconnects} disconnects, ${monitorReconnects} reconnects\n`);
  
  // Test execution after long idle
  console.log("Testing execution after idle period...\n");
  
  logEvent("STARTING_EXECUTION_TEST");
  
  const workflow = Workflow.from(TEST_WORKFLOW).output("images", "12");
  
  let executionSuccess = false;
  let executionError: any = null;
  
  try {
    const jobId = await pool.enqueue(workflow);
    logEvent("JOB_ENQUEUED", undefined, { jobId });
    
    // Wait for completion
    await new Promise<void>((resolve, reject) => {
      const onComplete = (ev: any) => {
        if (ev.detail.job.jobId === jobId) {
          executionSuccess = true;
          pool.off("job:completed", onComplete);
          pool.off("job:failed", onFailed);
          resolve();
        }
      };
      const onFailed = (ev: any) => {
        if (ev.detail.job.jobId === jobId) {
          executionError = ev.detail.job.lastError;
          pool.off("job:completed", onComplete);
          pool.off("job:failed", onFailed);
          reject(executionError);
        }
      };
      pool.on("job:completed", onComplete);
      pool.on("job:failed", onFailed);
    });
    
    logEvent("EXECUTION_TEST_SUCCESS");
    console.log("\n✓ Execution completed successfully!");
  } catch (error) {
    executionError = error;
    logEvent("EXECUTION_TEST_FAILED", undefined, { error: String(error) });
    console.error("\n✗ Execution failed!");
    console.error(`  Error:`, error);
  }
  
  // Final analysis
  console.log("\n=== Test Results ===\n");
  
  const totalDisconnects = events.filter(e => e.type === "CLIENT_DISCONNECTED").length;
  const totalReconnects = events.filter(e => e.type === "CLIENT_RECONNECTED" || e.type === "CLIENT_RECONNECTING").length;
  
  console.log(`Total Events: ${events.length}`);
  console.log(`Total Disconnects: ${totalDisconnects}`);
  console.log(`Total Reconnects: ${totalReconnects}`);
  console.log();
  
  if (totalDisconnects === 0) {
    console.log("✓ No disconnections during entire test");
    console.log("✓ Health check mechanism kept connection alive");
  } else if (totalDisconnects === totalReconnects && totalDisconnects <= 1) {
    console.log("⚠ One reconnection occurred (acceptable)");
  } else {
    console.log(`✗ Multiple disconnections detected (${totalDisconnects})`);
  }
  
  console.log();
  
  if (executionSuccess) {
    console.log("✓ Pool remained functional after long idle period");
    console.log("✓ Execution completed successfully");
  } else {
    console.log("✗ Pool failed to execute after idle period");
    console.log(`  Error: ${executionError}`);
  }
  
  console.log();
  
  // Event timeline
  console.log("Event Timeline (key events):");
  const keyEvents = events.filter(e => 
    e.type === "POOL_READY" ||
    e.type === "CLIENT_CONNECTED" ||
    e.type === "CLIENT_DISCONNECTED" ||
    e.type === "CLIENT_RECONNECTING" ||
    e.type === "CLIENT_RECONNECTED" ||
    e.type === "STARTING_EXECUTION_TEST" ||
    e.type === "JOB_ENQUEUED" ||
    e.type === "JOB_STARTED" ||
    e.type === "JOB_COMPLETED" ||
    e.type === "EXECUTION_TEST_SUCCESS" ||
    e.type === "EXECUTION_TEST_FAILED"
  );
  
  for (const event of keyEvents) {
    const elapsed = event.timestamp - events[0].timestamp;
    console.log(`  [+${Math.round(elapsed / 1000)}s] ${event.type}`);
  }
  
  // Cleanup
  console.log("\nShutting down...");
  await pool.shutdown();
  client.destroy();
  
  // Exit with appropriate code
  if (executionSuccess && totalDisconnects === 0) {
    console.log("\n✓ TEST PASSED: Health check maintained stable connection\n");
    process.exit(0);
  } else if (executionSuccess && totalDisconnects <= 1) {
    console.log("\n⚠ TEST PASSED WITH WARNINGS: Execution worked but connection reconnected\n");
    process.exit(0);
  } else {
    console.log("\n✗ TEST FAILED\n");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("\nFatal error:", error);
  process.exit(1);
});
