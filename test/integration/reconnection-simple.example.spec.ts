/**
 * Simple Example: Reconnection Integration Test
 *
 * This is a simplified example showing how to test reconnection behavior
 * by spawning a mock server in a separate process, killing it, and restarting it.
 *
 * This demonstrates the basic pattern:
 * 1. Start a mock server process
 * 2. Connect a client
 * 3. Kill the server process (simulating server crash/downtime)
 * 4. Restart the server process
 * 5. Verify the client reconnects
 *
 * Run with: bun test test/integration/reconnection-simple.example.spec.ts
 */

import { describe, test, expect, afterAll } from "bun:test";
import { ComfyApi } from "../../src/client";
import { ServerManager } from "./server-manager";
import { initializeClient, waitForConnection, sleep, pollUntil, trackEvent } from "./test-helpers";

const TEST_PORT = 8190; // Use unique port
const TEST_URL = `http://localhost:${TEST_PORT}`;

describe("Simple Reconnection Example", () => {
  const serverManager = new ServerManager({ port: TEST_PORT });

  afterAll(async () => {
    // Clean up all servers after tests
    await serverManager.killAll();
  });

  test("basic reconnection flow", async () => {
    console.log("\n=== Step 1: Start Mock Server ===");
    const server = await serverManager.startServer(TEST_PORT);
    console.log(`Server started at ${server.url}`);

    console.log("\n=== Step 2: Create Client and Connect ===");
    const api = new ComfyApi(TEST_URL);
    await initializeClient(api);
    console.log("Client connected!");

    expect(api.isConnected()).toBe(true);
    expect(api.connectionState).toBe("connected");

    console.log("\n=== Step 3: Kill Server (Simulate Downtime) ===");
    await serverManager.killServer(TEST_PORT);
    console.log("Server killed");

    // Wait for disconnection to be detected
    await sleep(500);
    expect(api.isConnected()).toBe(false);
    console.log("Client disconnected");

    console.log("\n=== Step 4: Restart Server ===");
    await serverManager.startServer(TEST_PORT);
    console.log("Server restarted");

    console.log("\n=== Step 5: Trigger Reconnection ===");
    await api.reconnectWs(true);

    // Wait for reconnection
    await waitForConnection(api);
    console.log("Client reconnected!");

    expect(api.isConnected()).toBe(true);
    expect(api.connectionState).toBe("connected");

    console.log("\n=== Step 6: Cleanup ===");
    api.destroy();
    await serverManager.killServer(TEST_PORT);
    console.log("Test complete!");
  }, 15000);

  test("auto-reconnection with server restart", async () => {
    console.log("\n=== Auto-Reconnection Test ===");

    // Start server
    await serverManager.startServer(TEST_PORT);

    // Create client with auto-reconnect enabled
    const api = new ComfyApi(TEST_URL, "auto-reconnect-client", {
      autoReconnect: true
    });

    // Track reconnected event
    const reconnectedTracker = trackEvent(api, "reconnected");

    // Initialize and wait for connection
    await initializeClient(api);
    console.log("Initial connection established");

    // Kill server
    console.log("Killing server to simulate downtime...");
    await serverManager.killServer(TEST_PORT);
    await sleep(500);
    console.log("Server is down");

    // Restart server
    console.log("Restarting server...");
    await serverManager.startServer(TEST_PORT);

    // Wait for automatic reconnection (client should reconnect on its own)
    console.log("Waiting for auto-reconnection...");
    await pollUntil(() => api.isConnected(), 10000, 100);
    console.log("Auto-reconnected!");

    expect(api.isConnected()).toBe(true);
    expect(reconnectedTracker.didFire()).toBe(true);

    // Cleanup
    reconnectedTracker.cleanup();
    api.destroy();
    await serverManager.killServer(TEST_PORT);
  }, 20000);

  test("multiple server restarts", async () => {
    console.log("\n=== Multiple Restarts Test ===");

    await serverManager.startServer(TEST_PORT);
    const api = new ComfyApi(TEST_URL, "multi-restart", {
      autoReconnect: true
    });

    // Initial connection
    await initializeClient(api);

    // Simulate 3 cycles of server going down and coming back up
    for (let cycle = 1; cycle <= 3; cycle++) {
      console.log(`\n--- Cycle ${cycle}: Server going down ---`);
      await serverManager.killServer(TEST_PORT);
      await sleep(1500);

      console.log(`--- Cycle ${cycle}: Server coming back up ---`);
      await serverManager.startServer(TEST_PORT);

      // Wait for reconnection (longer timeout for later cycles)
      await pollUntil(() => api.isConnected(), 15000, 100).catch(() => {
        console.log(`✗ Cycle ${cycle}: Failed to reconnect`);
      });

      if (api.isConnected()) {
        console.log(`✓ Cycle ${cycle}: Reconnected successfully`);
      }

      expect(api.isConnected()).toBe(true);

      // Brief delay between cycles to allow connection to stabilize
      await sleep(500);
    }

    console.log("\n✓ All cycles completed successfully!");

    // Cleanup
    api.destroy();
    await serverManager.killServer(TEST_PORT);
  }, 60000);
});
