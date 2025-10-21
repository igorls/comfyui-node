/**
 * Debug script to monitor WebSocket activity in detail
 * 
 * This helps identify if the WebSocket is receiving any messages from the server
 * and whether the inactivity timeout logic is working correctly.
 */

import { ComfyApi } from "../src/client.js";

const COMFYUI_HOST = process.env.COMFYUI_HOST || "http://127.0.0.1:8188";
const WS_TIMEOUT = parseInt(process.env.WS_TIMEOUT || "10000", 10);
const DURATION_MS = parseInt(process.env.DURATION_MS || "30000", 10);

console.log("=== WebSocket Activity Monitor ===");
console.log(`ComfyUI Host: ${COMFYUI_HOST}`);
console.log(`WebSocket Timeout: ${WS_TIMEOUT}ms`);
console.log(`Monitor Duration: ${DURATION_MS}ms`);
console.log("====================================\n");

interface ActivityLog {
  timestamp: number;
  type: "message" | "event" | "timer_check";
  event?: string;
  details?: any;
}

const activityLog: ActivityLog[] = [];

function logActivity(type: ActivityLog["type"], event?: string, details?: any) {
  const timestamp = Date.now();
  activityLog.push({ timestamp, type, event, details });
  
  const elapsed = activityLog.length > 1 
    ? timestamp - activityLog[0].timestamp 
    : 0;
  
  console.log(
    `[+${Math.round(elapsed)}ms] ` +
    `${type.toUpperCase()}` +
    (event ? ` - ${event}` : "") +
    (details ? `: ${JSON.stringify(details)}` : "")
  );
}

async function main() {
  const client = new ComfyApi(COMFYUI_HOST, undefined, {
    wsTimeout: WS_TIMEOUT,
    debug: true // Enable verbose logging
  });
  
  // Monitor ALL events
  client.on("all", (ev) => {
    logActivity("message", ev.detail.type, { 
      hasData: !!ev.detail.data,
      dataKeys: ev.detail.data ? Object.keys(ev.detail.data) : []
    });
  });
  
  client.on("connected", () => {
    logActivity("event", "connected");
  });
  
  client.on("disconnected", () => {
    logActivity("event", "disconnected");
  });
  
  client.on("reconnecting", () => {
    logActivity("event", "reconnecting");
  });
  
  client.on("reconnected", () => {
    logActivity("event", "reconnected");
  });
  
  client.on("status", (ev) => {
    const queueRemaining = ev.detail?.status?.exec_info?.queue_remaining;
    logActivity("event", "status", { queue_remaining: queueRemaining });
  });
  
  // Access internal lastActivity timer for debugging
  const checkActivity = () => {
    const lastActivity = (client as any).lastActivity;
    const now = Date.now();
    const idleTime = now - lastActivity;
    logActivity("timer_check", "inactivity_check", { 
      idleMs: idleTime, 
      thresholdMs: WS_TIMEOUT,
      willTriggerReconnect: idleTime > WS_TIMEOUT
    });
  };
  
  console.log("Initializing client...\n");
  await client.init();
  
  console.log("\nClient initialized, monitoring WebSocket activity...\n");
  
  // Check activity every 2 seconds
  const activityTimer = setInterval(checkActivity, 2000);
  
  // Wait for duration
  await new Promise(resolve => setTimeout(resolve, DURATION_MS));
  
  clearInterval(activityTimer);
  
  console.log("\n=== Activity Analysis ===");
  console.log(`Total activities: ${activityLog.length}`);
  
  const messages = activityLog.filter(a => a.type === "message");
  const events = activityLog.filter(a => a.type === "event");
  
  console.log(`\nMessages received: ${messages.length}`);
  console.log(`Events fired: ${events.length}`);
  
  // Group messages by type
  const messageTypes: Record<string, number> = {};
  for (const msg of messages) {
    if (msg.event) {
      messageTypes[msg.event] = (messageTypes[msg.event] || 0) + 1;
    }
  }
  
  console.log("\nMessage types:");
  for (const [type, count] of Object.entries(messageTypes)) {
    console.log(`  ${type}: ${count}`);
  }
  
  // Calculate message intervals
  if (messages.length > 1) {
    const intervals: number[] = [];
    for (let i = 1; i < messages.length; i++) {
      intervals.push(messages[i].timestamp - messages[i-1].timestamp);
    }
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const maxInterval = Math.max(...intervals);
    
    console.log("\nMessage intervals:");
    console.log(`  Average: ${Math.round(avgInterval)}ms`);
    console.log(`  Maximum: ${Math.round(maxInterval)}ms`);
    
    if (maxInterval > WS_TIMEOUT) {
      console.log(`\n⚠️  Maximum interval (${Math.round(maxInterval)}ms) exceeds timeout (${WS_TIMEOUT}ms)`);
      console.log("   This explains the disconnections!");
    }
  }
  
  // Check for disconnects
  const disconnects = events.filter(e => e.event === "disconnected");
  const reconnects = events.filter(e => e.event === "reconnected" || e.event === "reconnecting");
  
  if (disconnects.length > 0) {
    console.log(`\n⚠️  ${disconnects.length} disconnect(s) detected`);
    console.log(`   ${reconnects.length} reconnect attempt(s) detected`);
  } else {
    console.log("\n✓ No disconnects detected");
  }
  
  console.log("\nCleaning up...");
  client.destroy();
  console.log("Done.\n");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
