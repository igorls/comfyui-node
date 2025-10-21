/**
 * Debug script to reproduce WorkflowPool idle connection/disconnection issue
 * 
 * This script:
 * 1. Creates a WorkflowPool with real ComfyUI client(s)
 * 2. Monitors connection events (connected/disconnected/reconnected)
 * 3. Leaves the pool idle to observe if clients repeatedly connect/disconnect
 * 4. Logs detailed connection state changes to help identify the issue
 */

import { ComfyApi } from "../src/client.js";
import { WorkflowPool } from "../src/pool/WorkflowPool.js";

// Configuration
const COMFYUI_HOST = process.env.COMFYUI_HOST || "http://127.0.0.1:8188";
const NUM_CLIENTS = parseInt(process.env.NUM_CLIENTS || "1", 10);
const IDLE_DURATION_MS = parseInt(process.env.IDLE_DURATION_MS || "60000", 10); // 60 seconds default
const WS_TIMEOUT = parseInt(process.env.WS_TIMEOUT || "10000", 10); // 10 seconds default

console.log("=== WorkflowPool Idle Connection Debug ===");
console.log(`ComfyUI Host: ${COMFYUI_HOST}`);
console.log(`Number of Clients: ${NUM_CLIENTS}`);
console.log(`Idle Duration: ${IDLE_DURATION_MS}ms (${Math.round(IDLE_DURATION_MS / 1000)}s)`);
console.log(`WebSocket Timeout: ${WS_TIMEOUT}ms`);
console.log("==========================================\n");

// Track connection state changes
interface ConnectionEvent {
  timestamp: number;
  clientId: string;
  event: string;
  details?: any;
}

const connectionLog: ConnectionEvent[] = [];

function logConnectionEvent(clientId: string, event: string, details?: any) {
  const timestamp = Date.now();
  const entry: ConnectionEvent = { timestamp, clientId, event, details };
  connectionLog.push(entry);
  
  const elapsed = connectionLog.length > 1 
    ? timestamp - connectionLog[0].timestamp 
    : 0;
  
  console.log(
    `[${new Date(timestamp).toISOString()}] ` +
    `[+${Math.round(elapsed / 1000)}s] ` +
    `Client ${clientId}: ${event}` +
    (details ? ` ${JSON.stringify(details)}` : "")
  );
}

function analyzeConnectionLog() {
  console.log("\n=== Connection Log Analysis ===");
  console.log(`Total events: ${connectionLog.length}`);
  
  if (connectionLog.length === 0) {
    console.log("No connection events recorded.");
    return;
  }

  // Count events by type
  const eventCounts: Record<string, number> = {};
  for (const entry of connectionLog) {
    eventCounts[entry.event] = (eventCounts[entry.event] || 0) + 1;
  }
  
  console.log("\nEvent counts:");
  for (const [event, count] of Object.entries(eventCounts)) {
    console.log(`  ${event}: ${count}`);
  }
  
  // Count events per client
  const clientEvents: Record<string, number> = {};
  for (const entry of connectionLog) {
    clientEvents[entry.clientId] = (clientEvents[entry.clientId] || 0) + 1;
  }
  
  console.log("\nEvents per client:");
  for (const [clientId, count] of Object.entries(clientEvents)) {
    console.log(`  ${clientId}: ${count} events`);
  }
  
  // Detect connection cycles (connect -> disconnect -> connect pattern)
  const cycles: Array<{ clientId: string; count: number }> = [];
  for (const clientId of Object.keys(clientEvents)) {
    const clientLog = connectionLog.filter(e => e.clientId === clientId);
    let cycleCount = 0;
    
    for (let i = 0; i < clientLog.length - 2; i++) {
      const curr = clientLog[i];
      const next = clientLog[i + 1];
      const after = clientLog[i + 2];
      
      // Pattern: connected -> disconnected -> reconnected
      if (
        (curr.event === "connected" || curr.event === "reconnected") &&
        next.event === "disconnected" &&
        (after.event === "connected" || after.event === "reconnected")
      ) {
        cycleCount++;
      }
    }
    
    if (cycleCount > 0) {
      cycles.push({ clientId, count: cycleCount });
    }
  }
  
  if (cycles.length > 0) {
    console.log("\n⚠️  Connection cycles detected:");
    for (const cycle of cycles) {
      console.log(`  ${cycle.clientId}: ${cycle.count} cycles`);
    }
  } else {
    console.log("\n✓ No connection cycles detected");
  }
  
  // Calculate connection stability
  const duration = connectionLog[connectionLog.length - 1].timestamp - connectionLog[0].timestamp;
  const disconnects = eventCounts["disconnected"] || 0;
  const reconnects = eventCounts["reconnected"] || 0;
  
  console.log("\nConnection stability:");
  console.log(`  Duration: ${Math.round(duration / 1000)}s`);
  console.log(`  Disconnections: ${disconnects}`);
  console.log(`  Reconnections: ${reconnects}`);
  
  if (disconnects === 0 && reconnects === 0) {
    console.log("  ✓ Stable connections (no disconnections)");
  } else if (disconnects === reconnects && disconnects <= 1) {
    console.log("  ✓ Acceptable stability (1 reconnect)");
  } else {
    console.log(`  ⚠️  Unstable connections (${disconnects} disconnects, ${reconnects} reconnects)`);
  }
}

async function main() {
  // Create clients
  const clients: ComfyApi[] = [];
  
  console.log(`Creating ${NUM_CLIENTS} client(s)...\n`);
  
  for (let i = 0; i < NUM_CLIENTS; i++) {
    const client = new ComfyApi(COMFYUI_HOST, undefined, {
      wsTimeout: WS_TIMEOUT,
      debug: false // Set to true for verbose logging
    });
    
    // Monitor connection events
    client.on("connected", () => {
      logConnectionEvent(client.id, "connected");
    });
    
    client.on("disconnected", () => {
      logConnectionEvent(client.id, "disconnected");
    });
    
    client.on("reconnected", () => {
      logConnectionEvent(client.id, "reconnected");
    });
    
    client.on("reconnecting", () => {
      logConnectionEvent(client.id, "reconnecting");
    });
    
    client.on("status", (ev) => {
      // Log status updates (but don't spam)
      const queueRemaining = ev.detail?.status?.exec_info?.queue_remaining;
      if (queueRemaining !== undefined) {
        logConnectionEvent(client.id, "status", { queue_remaining: queueRemaining });
      }
    });
    
    clients.push(client);
  }
  
  // Create WorkflowPool
  console.log("Creating WorkflowPool...\n");
  const pool = new WorkflowPool(clients);
  
  // Monitor pool events
  pool.on("pool:ready", (ev) => {
    console.log(`✓ Pool ready with clients: ${ev.detail.clientIds.join(", ")}\n`);
  });
  
  pool.on("client:state", (ev) => {
    logConnectionEvent(
      ev.detail.clientId,
      "client:state",
      { online: ev.detail.online, busy: ev.detail.busy }
    );
  });
  
  pool.on("pool:error", (ev) => {
    console.error(`✗ Pool error: ${ev.detail.error}\n`);
  });
  
  // Wait for pool to be ready
  await pool.ready();
  
  console.log(`\n=== Monitoring for ${Math.round(IDLE_DURATION_MS / 1000)}s (idle) ===\n`);
  
  // Set up a timer to periodically report status
  const reportInterval = setInterval(() => {
    const elapsed = connectionLog.length > 0 
      ? Date.now() - connectionLog[0].timestamp 
      : 0;
    console.log(
      `[${new Date().toISOString()}] ` +
      `Still monitoring... (${Math.round(elapsed / 1000)}s elapsed, ` +
      `${connectionLog.length} events so far)`
    );
  }, 10000); // Report every 10 seconds
  
  // Wait for the idle duration
  await new Promise(resolve => setTimeout(resolve, IDLE_DURATION_MS));
  
  clearInterval(reportInterval);
  
  console.log("\n=== Monitoring period complete ===\n");
  
  // Analyze the results
  analyzeConnectionLog();
  
  // Cleanup
  console.log("\nShutting down...");
  await pool.shutdown();
  
  // Destroy clients
  for (const client of clients) {
    client.destroy();
  }
  
  console.log("Done.\n");
  
  // Exit with appropriate code
  const disconnects = connectionLog.filter(e => e.event === "disconnected").length;
  const reconnects = connectionLog.filter(e => e.event === "reconnected").length;
  
  if (disconnects > 1 || reconnects > 1) {
    console.log("⚠️  Issue detected: Multiple disconnects/reconnects during idle period");
    process.exit(1);
  } else {
    console.log("✓ No issues detected");
    process.exit(0);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
