/**
 * Test script to verify WebSocket connection remains functional after long idle period
 * 
 * This test:
 * 1. Creates a client with very high (or disabled) inactivity timeout
 * 2. Waits idle for a configurable duration (default: 90 seconds)
 * 3. Sends a test prompt to verify the connection still works
 * 4. Reports on connection stability and execution success
 */

import { ComfyApi } from "../src/client.js";
import { Workflow } from "../src/workflow.js";

const COMFYUI_HOST = process.env.COMFYUI_HOST || "http://127.0.0.1:8188";
const IDLE_DURATION_MS = parseInt(process.env.IDLE_DURATION_MS || "90000", 10); // 90 seconds default
const WS_TIMEOUT = parseInt(process.env.WS_TIMEOUT || "300000", 10); // 5 minutes default (effectively disabled)

console.log("=== Long Idle Connection Test ===");
console.log(`ComfyUI Host: ${COMFYUI_HOST}`);
console.log(`WebSocket Timeout: ${WS_TIMEOUT}ms (${Math.round(WS_TIMEOUT / 1000)}s)`);
console.log(`Idle Duration: ${IDLE_DURATION_MS}ms (${Math.round(IDLE_DURATION_MS / 1000)}s)`);
console.log("===================================\n");

interface Event {
  timestamp: number;
  type: string;
  details?: any;
}

const events: Event[] = [];

function logEvent(type: string, details?: any) {
  const timestamp = Date.now();
  events.push({ timestamp, type, details });
  
  const elapsed = events.length > 1 
    ? timestamp - events[0].timestamp 
    : 0;
  
  console.log(
    `[${new Date(timestamp).toISOString()}] ` +
    `[+${Math.round(elapsed / 1000)}s] ` +
    `${type}` +
    (details ? ` - ${JSON.stringify(details)}` : "")
  );
}

// Simple test workflow - just loads VAE and CLIP (no image generation needed)
const TEST_WORKFLOW = {
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
  }
};

async function main() {
  console.log("Creating client with high timeout...\n");
  
  const client = new ComfyApi(COMFYUI_HOST, undefined, {
    wsTimeout: WS_TIMEOUT,
    debug: false
  });
  
  // Track connection events
  client.on("connected", () => {
    logEvent("CLIENT_CONNECTED");
  });
  
  client.on("disconnected", () => {
    logEvent("CLIENT_DISCONNECTED");
  });
  
  client.on("reconnecting", () => {
    logEvent("CLIENT_RECONNECTING");
  });
  
  client.on("reconnected", () => {
    logEvent("CLIENT_RECONNECTED");
  });
  
  client.on("status", (ev) => {
    const queueRemaining = ev.detail?.status?.exec_info?.queue_remaining;
    logEvent("STATUS_UPDATE", { queue_remaining: queueRemaining });
  });
  
  client.on("executing", (ev) => {
    logEvent("EXECUTING", { 
      prompt_id: ev.detail.prompt_id, 
      node: ev.detail.node 
    });
  });
  
  client.on("executed", (ev) => {
    logEvent("EXECUTED", { 
      prompt_id: ev.detail.prompt_id, 
      node: ev.detail.node 
    });
  });
  
  client.on("execution_success", (ev) => {
    logEvent("EXECUTION_SUCCESS", { 
      prompt_id: ev.detail.prompt_id 
    });
  });
  
  client.on("execution_error", (ev) => {
    logEvent("EXECUTION_ERROR", { 
      prompt_id: ev.detail.prompt_id,
      error: ev.detail.exception_message 
    });
  });
  
  client.on("progress", (ev) => {
    logEvent("PROGRESS", { 
      prompt_id: ev.detail.prompt_id,
      node: ev.detail.node,
      value: ev.detail.value,
      max: ev.detail.max
    });
  });
  
  console.log("Initializing client...\n");
  await client.init();
  
  logEvent("CLIENT_INITIALIZED");
  
  console.log(`\n✓ Client initialized successfully`);
  console.log(`\nWaiting idle for ${Math.round(IDLE_DURATION_MS / 1000)} seconds...\n`);
  
  // Report every 10 seconds during idle period
  const startTime = Date.now();
  const reportInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const disconnects = events.filter(e => e.type === "CLIENT_DISCONNECTED").length;
    const reconnects = events.filter(e => e.type === "CLIENT_RECONNECTED" || e.type === "CLIENT_RECONNECTING").length;
    
    console.log(
      `  ... ${Math.round(elapsed / 1000)}s elapsed ` +
      `(${disconnects} disconnects, ${reconnects} reconnects)`
    );
  }, 10000);
  
  // Wait for the idle period
  await new Promise(resolve => setTimeout(resolve, IDLE_DURATION_MS));
  
  clearInterval(reportInterval);
  
  const idleDisconnects = events.filter(e => e.type === "CLIENT_DISCONNECTED").length;
  const idleReconnects = events.filter(e => e.type === "CLIENT_RECONNECTED" || e.type === "CLIENT_RECONNECTING").length;
  
  console.log(`\n✓ Idle period complete`);
  console.log(`  Connection stability: ${idleDisconnects} disconnects, ${idleReconnects} reconnects\n`);
  
  // Now test if the connection still works
  console.log("Testing connection by sending a prompt...\n");
  
  logEvent("STARTING_EXECUTION_TEST");
  
  const workflow = Workflow.from(TEST_WORKFLOW).output("vae", "7").output("clip", "8");
  
  let executionSuccess = false;
  let executionError: any = null;
  
  try {
    const result = await client.runAndWait(workflow);
    executionSuccess = true;
    logEvent("EXECUTION_TEST_SUCCESS", { result: "completed" });
    console.log("\n✓ Execution completed successfully!");
    console.log(`  Result:`, result);
  } catch (error) {
    executionError = error;
    logEvent("EXECUTION_TEST_FAILED", { error: String(error) });
    console.error("\n✗ Execution failed!");
    console.error(`  Error:`, error);
  }
  
  // Final analysis
  console.log("\n=== Test Results ===\n");
  
  const totalDisconnects = events.filter(e => e.type === "CLIENT_DISCONNECTED").length;
  const totalReconnects = events.filter(e => e.type === "CLIENT_RECONNECTED" || e.type === "CLIENT_RECONNECTING").length;
  const executionEvents = events.filter(e => 
    e.type.startsWith("EXECUTING") || 
    e.type.startsWith("EXECUTED") || 
    e.type === "EXECUTION_SUCCESS" ||
    e.type === "PROGRESS"
  ).length;
  
  console.log(`Total Events: ${events.length}`);
  console.log(`Total Disconnects: ${totalDisconnects}`);
  console.log(`Total Reconnects: ${totalReconnects}`);
  console.log(`Execution Events: ${executionEvents}`);
  console.log();
  
  if (totalDisconnects === 0) {
    console.log("✓ No disconnections during entire test");
  } else if (totalDisconnects === totalReconnects && totalDisconnects <= 1) {
    console.log("⚠ One reconnection occurred (acceptable)");
  } else {
    console.log(`✗ Multiple disconnections detected (${totalDisconnects})`);
  }
  
  console.log();
  
  if (executionSuccess) {
    console.log("✓ Connection remained functional after long idle period");
    console.log("✓ Execution events were received successfully");
  } else {
    console.log("✗ Connection failed to execute prompt after idle period");
    console.log(`  Error: ${executionError}`);
  }
  
  console.log();
  
  // Event timeline
  console.log("Event Timeline:");
  for (const event of events) {
    const elapsed = event.timestamp - events[0].timestamp;
    console.log(`  [+${Math.round(elapsed / 1000)}s] ${event.type}`);
  }
  
  // Cleanup
  console.log("\nCleaning up...");
  client.destroy();
  
  // Exit with appropriate code
  if (executionSuccess && totalDisconnects === 0) {
    console.log("\n✓ TEST PASSED: Connection stable and functional\n");
    process.exit(0);
  } else if (executionSuccess && totalDisconnects <= 1) {
    console.log("\n⚠ TEST PASSED WITH WARNINGS: Connection functional but reconnected\n");
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
