# Integration Tests Quick Start Guide

## What Are These Tests?

These integration tests spawn **real mock server processes** and then kill/restart them to test reconnection behavior. Unlike unit tests that mock WebSocket connections, these tests simulate actual server crashes and recoveries.

## Running Tests

```bash
# Run all integration tests
bun test test/integration/

# Run simple examples (recommended for first-time)
bun run test:integration:simple

# Run comprehensive reconnection tests
bun run test:integration:reconnection

# Validate that the mock server works
bun test/integration/validate-mock-server.ts
```

## Quick Example

Here's the simplest possible integration test:

```typescript
import { ComfyApi } from "../../src/client";
import { ServerManager } from "./server-manager";
import { initializeClient, waitForConnection, sleep } from "./test-helpers";

test("basic reconnection", async () => {
  const manager = new ServerManager({ port: 8191 });
  
  // Start mock server
  await manager.startServer(8191);
  
  // Connect client
  const api = new ComfyApi("http://localhost:8191");
  await initializeClient(api);
  expect(api.isConnected()).toBe(true);
  
  // Kill server (simulate crash)
  await manager.killServer(8191);
  await sleep(500);
  expect(api.isConnected()).toBe(false);
  
  // Restart server
  await manager.startServer(8191);
  
  // Reconnect
  await api.reconnectWs(true);
  await waitForConnection(api);
  expect(api.isConnected()).toBe(true);
  
  // Cleanup
  api.destroy();
  await manager.killAll();
});
```

## Key Concepts

### 1. Server Manager

Manages mock server processes:

```typescript
const manager = new ServerManager({ port: 8191 });

await manager.startServer(8191);        // Spawn server
await manager.killServer(8191);         // Kill server
await manager.restartServer(8191, 1000); // Kill, wait 1s, restart
await manager.killAll();                 // Cleanup all servers
```

### 2. Test Helpers

Common utilities to simplify tests:

```typescript
// Initialize client and wait for ready
await initializeClient(api);

// Wait for connection
await waitForConnection(api);

// Wait for disconnection
await waitForDisconnection(api);

// Simple sleep
await sleep(1000);

// Poll until condition is met
await pollUntil(() => api.isConnected(), 10000, 100);

// Track if event fired
const tracker = trackEvent(api, "reconnected");
await pollUntil(() => tracker.didFire(), 5000);
tracker.cleanup();
```

### 3. Mock Server

The mock server provides:
- HTTP endpoints: `/queue`, `/prompt`, `/system_stats`, `/history`
- WebSocket server at `/ws`
- Periodic status messages
- Simulated workflow execution

## Common Patterns

### Pattern 1: Test Manual Reconnection

```typescript
test("manual reconnection", async () => {
  const manager = new ServerManager({ port: 8192 });
  await manager.startServer(8192);
  
  const api = new ComfyApi("http://localhost:8192");
  await initializeClient(api);
  
  // Server goes down
  await manager.killServer(8192);
  await sleep(500);
  
  // Server comes back
  await manager.startServer(8192);
  
  // Manually reconnect
  await api.reconnectWs(true);
  await waitForConnection(api);
  
  expect(api.isConnected()).toBe(true);
  
  api.destroy();
  await manager.killAll();
});
```

### Pattern 2: Test Auto-Reconnection

```typescript
test("auto reconnection", async () => {
  const manager = new ServerManager({ port: 8193 });
  await manager.startServer(8193);
  
  const api = new ComfyApi("http://localhost:8193", "test-client", {
    autoReconnect: true  // Enable auto-reconnect
  });
  await initializeClient(api);
  
  // Server goes down
  await manager.killServer(8193);
  await sleep(500);
  
  // Server comes back
  await manager.startServer(8193);
  
  // Wait for automatic reconnection (no manual trigger needed)
  await pollUntil(() => api.isConnected(), 10000, 100);
  
  expect(api.isConnected()).toBe(true);
  
  api.destroy();
  await manager.killAll();
});
```

### Pattern 3: Test Events

```typescript
test("reconnection events", async () => {
  const manager = new ServerManager({ port: 8194 });
  await manager.startServer(8194);
  
  const api = new ComfyApi("http://localhost:8194", "test", {
    autoReconnect: true
  });
  
  // Track reconnected event
  const reconnectedTracker = trackEvent(api, "reconnected");
  
  await initializeClient(api);
  
  // Simulate downtime
  await manager.killServer(8194);
  await sleep(500);
  await manager.startServer(8194);
  
  // Wait for reconnection and event
  await pollUntil(() => reconnectedTracker.didFire(), 10000);
  
  expect(reconnectedTracker.didFire()).toBe(true);
  
  reconnectedTracker.cleanup();
  api.destroy();
  await manager.killAll();
});
```

### Pattern 4: Multiple Restart Cycles

```typescript
test("multiple restarts", async () => {
  const manager = new ServerManager({ port: 8195 });
  await manager.startServer(8195);
  
  const api = new ComfyApi("http://localhost:8195", "test", {
    autoReconnect: true
  });
  await initializeClient(api);
  
  // Test 3 restart cycles
  for (let i = 0; i < 3; i++) {
    await manager.killServer(8195);
    await sleep(1000);
    await manager.startServer(8195);
    await pollUntil(() => api.isConnected(), 10000);
    expect(api.isConnected()).toBe(true);
  }
  
  api.destroy();
  await manager.killAll();
});
```

## Best Practices

### 1. Use Unique Ports

Each test file should use a unique port to avoid conflicts:

```typescript
const TEST_PORT = 8191; // Choose unique port per file
```

### 2. Always Clean Up

Use `afterAll` to ensure servers are killed:

```typescript
describe("My Tests", () => {
  const manager = new ServerManager({ port: 8191 });
  
  afterAll(async () => {
    await manager.killAll();
  });
  
  // ... tests
});
```

### 3. Add Appropriate Timeouts

Integration tests take longer than unit tests:

```typescript
test("my test", async () => {
  // test code
}, 15000); // 15 second timeout
```

### 4. Wait for State Changes

Don't assume immediate state changes:

```typescript
// Bad: Assumes immediate disconnection
await manager.killServer(port);
expect(api.isConnected()).toBe(false); // Might still be true!

// Good: Wait for disconnection
await manager.killServer(port);
await sleep(500);
expect(api.isConnected()).toBe(false);
```

### 5. Use Helper Functions

Instead of writing polling loops, use helpers:

```typescript
// Bad: Manual polling
await new Promise<void>((resolve) => {
  const check = () => {
    if (api.isConnected()) resolve();
    else setTimeout(check, 100);
  };
  check();
});

// Good: Use helper
await waitForConnection(api);
```

## Debugging

### View Server Output

Server logs are automatically printed with `[Server PORT]` prefix:

```
[Server 8191] HTTP server listening on http://localhost:8191
[Server 8191] Client connected (total: 1)
```

### Run Mock Server Standalone

Test the mock server independently:

```bash
bun test/integration/mock-server.ts 8191
```

Then connect manually with a WebSocket client or the actual ComfyApi.

### Add Debug Logging

```typescript
api.on("status", (event) => {
  console.log("Status:", event.detail);
});

api.on("reconnected", () => {
  console.log("Reconnected!");
});
```

### Check Connection State

```typescript
console.log("State:", api.connectionState);
console.log("Connected:", api.isConnected());
```

## Common Issues

### Port Already in Use

**Problem:** Error about port already in use

**Solution:** 
- Use unique ports per test file
- Ensure `afterAll` cleanup is running
- Kill orphaned processes: `lsof -i :8191` (Linux/Mac) or Task Manager (Windows)

### Test Timeouts

**Problem:** Tests timeout

**Solution:**
- Increase test timeout: `test("name", async () => {...}, 30000)`
- Check if server actually started (look for server logs)
- Ensure mock server endpoints are working

### Flaky Tests

**Problem:** Tests pass sometimes, fail other times

**Solution:**
- Add delays after state changes: `await sleep(500)`
- Use polling with timeout instead of fixed delays
- Increase timeout values for slower systems

## Next Steps

1. **Read the Examples**: Check `reconnection-simple.example.spec.ts` for annotated examples
2. **Run Validation**: `bun test/integration/validate-mock-server.ts` to verify setup
3. **Write Your Test**: Use the patterns above as templates
4. **Read Full Docs**: See `README.md` for complete documentation

## Quick Reference

```typescript
// Server management
const manager = new ServerManager({ port: 8191 });
await manager.startServer(port);
await manager.killServer(port);
await manager.restartServer(port, delayMs);
await manager.killAll();

// Client setup
const api = new ComfyApi(url, clientId, { autoReconnect: true });
await initializeClient(api);

// Wait for states
await waitForConnection(api);
await waitForDisconnection(api);
await pollUntil(() => api.isConnected(), timeout);

// Track events
const tracker = trackEvent(api, "reconnected");
tracker.didFire(); // boolean
tracker.cleanup();

// Utilities
await sleep(ms);

// Cleanup
api.destroy();
await manager.killAll();
```

Happy testing! 🚀