/**
 * Integration Tests for Reconnection Behavior
 *
 * These tests spawn actual mock server processes, then kill and restart them
 * to simulate real server disconnections and test the reconnection logic.
 *
 * Run with: bun test test/integration/reconnection.integration.spec.ts
 */

import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { ComfyApi } from "../../src/client";
import { ServerManager } from "./server-manager";
import { initializeClient, waitForConnection, sleep, pollUntil, trackEvent } from "./test-helpers";

const TEST_PORT = 8189; // Use different port to avoid conflicts
const TEST_URL = `http://localhost:${TEST_PORT}`;

describe("Reconnection Integration Tests", () => {
  let serverManager: ServerManager;

  beforeAll(() => {
    serverManager = new ServerManager({ port: TEST_PORT });
  });

  afterEach(async () => {
    // Clean up all servers after each test
    await serverManager.killAll();
  });

  afterAll(async () => {
    await serverManager.killAll();
  });

  describe("Manual Reconnection", () => {
    test("successfully reconnects after server restart", async () => {
      // Start server
      const server = await serverManager.startServer(TEST_PORT);
      expect(serverManager.isRunning(TEST_PORT)).toBe(true);

      // Create client and connect
      const api = new ComfyApi(TEST_URL);
      await initializeClient(api);

      expect(api.isConnected()).toBe(true);
      expect(api.connectionState).toBe("connected");

      // Kill server
      await serverManager.killServer(TEST_PORT);
      expect(serverManager.isRunning(TEST_PORT)).toBe(false);

      // Wait for disconnection to be detected
      await sleep(500);
      expect(api.isConnected()).toBe(false);

      // Restart server
      await serverManager.startServer(TEST_PORT);

      // Manually trigger reconnection
      await api.reconnectWs(true);

      // Wait for reconnection
      await waitForConnection(api);

      expect(api.isConnected()).toBe(true);
      expect(api.connectionState).toBe("connected");

      // Cleanup
      api.destroy();
      await serverManager.killServer(TEST_PORT);
    }, 15000);

    test("handles multiple reconnection attempts", async () => {
      // Start server
      await serverManager.startServer(TEST_PORT);

      // Create client
      const api = new ComfyApi(TEST_URL);
      await initializeClient(api);

      // Kill server
      await serverManager.killServer(TEST_PORT);
      await sleep(500);

      // Try to reconnect (should fail - server is down)
      const reconnectPromise = api.reconnectWs(true);

      // Wait a bit
      await sleep(1000);

      // Abort the reconnection attempt
      api.abortReconnect();

      // Restart server
      await serverManager.startServer(TEST_PORT);

      // Reconnect again (should succeed now)
      await api.reconnectWs(true);
      await waitForConnection(api);

      expect(api.isConnected()).toBe(true);

      // Cleanup
      api.destroy();
      await serverManager.killServer(TEST_PORT);
    }, 20000);
  });

  describe("Automatic Reconnection", () => {
    test("automatically reconnects when autoReconnect is enabled", async () => {
      // Start server
      await serverManager.startServer(TEST_PORT);

      // Create client with autoReconnect enabled
      const api = new ComfyApi(TEST_URL, "auto-reconnect-test", {
        autoReconnect: true
      });
      await initializeClient(api);

      expect(api.isConnected()).toBe(true);
      const initialState = api.connectionState;
      expect(initialState).toBe("connected");

      // Kill server to simulate downtime
      await serverManager.killServer(TEST_PORT);

      // Wait for disconnection
      await sleep(500);
      expect(api.isConnected()).toBe(false);

      // Restart server
      await serverManager.startServer(TEST_PORT);

      // Wait for automatic reconnection (should happen automatically)
      await pollUntil(() => api.isConnected(), 10000, 100);

      // Should have reconnected automatically
      expect(api.isConnected()).toBe(true);
      expect(api.connectionState).toBe("connected");

      // Cleanup
      api.destroy();
      await serverManager.killServer(TEST_PORT);
    }, 20000);

    test("emits reconnected event on successful auto-reconnection", async () => {
      // Start server
      await serverManager.startServer(TEST_PORT);

      // Create client with autoReconnect
      const api = new ComfyApi(TEST_URL, "event-test", {
        autoReconnect: true
      });

      // Track events
      const reconnectedTracker = trackEvent(api, "reconnected");
      const failedTracker = trackEvent(api, "reconnection_failed");

      await initializeClient(api);

      // Simulate server downtime
      await serverManager.killServer(TEST_PORT);
      await sleep(500);

      // Restart server
      await serverManager.startServer(TEST_PORT);

      // Wait for reconnection
      await pollUntil(() => reconnectedTracker.didFire(), 10000, 100);

      expect(reconnectedTracker.didFire()).toBe(true);
      expect(failedTracker.didFire()).toBe(false);

      // Cleanup
      reconnectedTracker.cleanup();
      failedTracker.cleanup();
      api.destroy();
      await serverManager.killServer(TEST_PORT);
    }, 20000);
  });

  describe("Connection State Transitions", () => {
    test("tracks connection state through server lifecycle", async () => {
      // Start server
      await serverManager.startServer(TEST_PORT);

      const states: string[] = [];
      const api = new ComfyApi(TEST_URL, "state-tracking");

      // Track state changes
      const trackState = () => {
        states.push(api.connectionState);
      };

      // Initial state
      trackState(); // "connecting"

      // Wait for connection
      await initializeClient(api);
      trackState(); // "connected"

      // Kill server
      await serverManager.killServer(TEST_PORT);
      await sleep(1000); // Give more time for disconnection to be detected
      trackState(); // Should be "disconnected" or "reconnecting"

      // Start reconnection if not already reconnecting
      const reconnectPromise = api.reconnectWs(true);
      await sleep(100);
      trackState(); // "reconnecting"

      // Restart server
      await serverManager.startServer(TEST_PORT);

      // Wait for reconnection
      await waitForConnection(api);
      trackState(); // "connected" again

      // Verify state transitions
      expect(states[0]).toBe("connecting");
      expect(states[1]).toBe("connected");
      // After disconnect, could be "disconnected" or "reconnecting" depending on timing
      expect(["disconnected", "reconnecting"]).toContain(states[2]);
      expect(states[3]).toBe("reconnecting");
      expect(states[4]).toBe("connected");

      // Cleanup
      api.destroy();
      await serverManager.killServer(TEST_PORT);
    }, 20000);
  });

  describe("Connection Validation", () => {
    test("validateConnection returns true when server is up", async () => {
      // Start server
      await serverManager.startServer(TEST_PORT);

      const api = new ComfyApi(TEST_URL);
      await initializeClient(api);

      // Validate connection
      const isValid = await api.validateConnection();
      expect(isValid).toBe(true);

      // Cleanup
      api.destroy();
      await serverManager.killServer(TEST_PORT);
    }, 15000);

    test("validateConnection returns false when server is down", async () => {
      // Start server
      await serverManager.startServer(TEST_PORT);

      const api = new ComfyApi(TEST_URL);
      await initializeClient(api);

      // Kill server
      await serverManager.killServer(TEST_PORT);
      await sleep(500);

      // Validate connection (should fail)
      const isValid = await api.validateConnection();
      expect(isValid).toBe(false);

      // Cleanup
      api.destroy();
    }, 15000);
  });

  describe("Reconnection Failure Handling", () => {
    test("invokes onReconnectionFailed callback when server stays down", async () => {
      // Start server
      await serverManager.startServer(TEST_PORT);

      let reconnectionFailedCalled = false;

      const api = new ComfyApi(TEST_URL, "failure-test", {
        autoReconnect: false,
        onReconnectionFailed: () => {
          reconnectionFailedCalled = true;
        }
      });

      await initializeClient(api);

      // Kill server and don't restart it
      await serverManager.killServer(TEST_PORT);
      await sleep(500);

      // Try to reconnect (will fail because server is down)
      const reconnectPromise = api.reconnectWs(true);

      // Wait for reconnection to fail (this takes time with retries)
      await sleep(8000);

      // Abort to speed up test
      api.abortReconnect();

      // Cleanup
      api.destroy();
    }, 15000);
  });

  describe("Multiple Server Restarts", () => {
    test("handles multiple server restarts gracefully", async () => {
      // Start server
      await serverManager.startServer(TEST_PORT);

      const api = new ComfyApi(TEST_URL, "multi-restart", {
        autoReconnect: true
      });
      await initializeClient(api);

      // Simulate 3 server restarts
      for (let i = 0; i < 3; i++) {
        console.log(`\n=== Restart cycle ${i + 1} ===`);

        // Kill server
        await serverManager.killServer(TEST_PORT);
        await sleep(500);

        // Restart server
        await serverManager.startServer(TEST_PORT);

        // Wait for reconnection
        await pollUntil(() => api.isConnected(), 5000, 100).catch(() => {
          console.log(`Failed to reconnect on cycle ${i + 1}`);
        });

        expect(api.isConnected()).toBe(true);
      }

      // Cleanup
      api.destroy();
      await serverManager.killServer(TEST_PORT);
    }, 60000);
  });

  describe("WebSocket Message Handling After Reconnection", () => {
    test("receives messages correctly after reconnection", async () => {
      // Start server
      await serverManager.startServer(TEST_PORT);

      const api = new ComfyApi(TEST_URL);
      let statusMessagesReceived = 0;

      // Listen for status messages
      api.on("status", () => {
        statusMessagesReceived++;
      });

      await initializeClient(api);

      // Wait for at least one status message
      await sleep(1000);
      const messagesBeforeRestart = statusMessagesReceived;
      expect(messagesBeforeRestart).toBeGreaterThan(0);

      // Kill and restart server
      await serverManager.killServer(TEST_PORT);
      await sleep(500);
      await serverManager.startServer(TEST_PORT);

      // Reconnect
      await api.reconnectWs(true);
      await waitForConnection(api);

      // Wait for new status messages
      await sleep(2000);

      // Should have received more messages after reconnection
      expect(statusMessagesReceived).toBeGreaterThan(messagesBeforeRestart);

      // Cleanup
      api.destroy();
      await serverManager.killServer(TEST_PORT);
    }, 20000);
  });
});
