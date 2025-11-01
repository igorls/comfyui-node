#!/usr/bin/env bun
/**
 * Validation Script for Mock Server
 *
 * This script validates that the mock server works correctly by:
 * 1. Starting the mock server
 * 2. Testing HTTP endpoints
 * 3. Testing WebSocket connection
 * 4. Killing and restarting the server
 * 5. Verifying reconnection works
 *
 * Run with: bun test/integration/validate-mock-server.ts
 */

import { ServerManager } from "./server-manager";
import { ComfyApi } from "../../src/client";

const TEST_PORT = 8192;
const TEST_URL = `http://localhost:${TEST_PORT}`;

async function main() {
  console.log("🧪 Mock Server Validation Script\n");

  const manager = new ServerManager({ port: TEST_PORT });

  try {
    // Test 1: Start Server
    console.log("✓ Test 1: Starting mock server...");
    const server = await manager.startServer(TEST_PORT);
    console.log(`  ✓ Server started at ${server.url}`);
    console.log(`  ✓ WebSocket at ${server.wsUrl}`);
    console.log(`  ✓ Process ID: ${server.pid}\n`);

    // Test 2: Test HTTP Endpoint
    console.log("✓ Test 2: Testing HTTP /queue endpoint...");
    const response = await fetch(`${TEST_URL}/queue`);
    if (!response.ok) {
      throw new Error(`HTTP request failed: ${response.status}`);
    }
    const data = await response.json();
    console.log(`  ✓ Response:`, data);
    if (!data.queue_running || !data.queue_pending) {
      throw new Error("Invalid queue response structure");
    }
    console.log("  ✓ Queue endpoint working\n");

    // Test 3: WebSocket Connection
    console.log("✓ Test 3: Testing WebSocket connection...");
    const api = new ComfyApi(TEST_URL, "validation-client");

    // Set up status event listener BEFORE init
    let receivedStatus = false;
    api.on("status", (event) => {
      console.log("  ✓ Received status message:", event.detail);
      receivedStatus = true;
    });

    // Initialize the client (this starts the WebSocket connection)
    await api.init();

    // Wait for connection
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Connection timeout"));
      }, 5000);

      const check = () => {
        if (api.isConnected()) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });

    console.log("  ✓ WebSocket connected");
    console.log(`  ✓ Connection state: ${api.connectionState}\n`);

    // Test 4: Receive Status Message
    console.log("✓ Test 4: Waiting for status message...");
    // Wait a bit for status message (listener already set up)
    await new Promise((resolve) => setTimeout(resolve, 2000));

    if (!receivedStatus) {
      throw new Error("Did not receive status message");
    }
    console.log("  ✓ Status messages working\n");

    // Test 5: Kill Server
    console.log("✓ Test 5: Killing server...");
    await manager.killServer(TEST_PORT);
    console.log("  ✓ Server killed");

    // Wait for disconnection
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.log(`  ✓ Client disconnected: ${!api.isConnected()}`);
    console.log(`  ✓ Connection state: ${api.connectionState}\n`);

    // Test 6: Restart Server
    console.log("✓ Test 6: Restarting server...");
    await manager.startServer(TEST_PORT);
    console.log("  ✓ Server restarted\n");

    // Test 7: Reconnection
    console.log("✓ Test 7: Testing reconnection...");
    await api.reconnectWs(true);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Reconnection timeout"));
      }, 5000);

      const check = () => {
        if (api.isConnected()) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      setTimeout(check, 100);
    });

    console.log("  ✓ Reconnected successfully");
    console.log(`  ✓ Connection state: ${api.connectionState}\n`);

    // Test 8: Cleanup
    console.log("✓ Test 8: Cleanup...");
    api.destroy();
    await manager.killAll();
    console.log("  ✓ All resources cleaned up\n");

    // Success
    console.log("✅ All validation tests passed!\n");
    console.log("The mock server is working correctly and ready for integration tests.");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Validation failed:", error);

    // Cleanup on failure
    try {
      await manager.killAll();
    } catch (cleanupError) {
      console.error("Error during cleanup:", cleanupError);
    }

    process.exit(1);
  }
}

// Run validation
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
