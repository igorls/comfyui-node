# Integration Tests

This directory contains integration tests for the comfyui-node library that use real process spawning to test reconnection and other network-related behaviors.

## Overview

Unlike unit tests that mock WebSocket connections, these integration tests spawn actual mock server processes, allowing us to test real-world scenarios like:

- Server crashes and restarts
- Network disconnections
- Automatic reconnection behavior
- Connection state transitions
- Multiple server restart cycles

## Architecture

### Mock Server (`mock-server.ts`)

A standalone server process that mimics a ComfyUI server:

- **HTTP Server**: Responds to `/queue`, `/system_stats`, `/prompt`, and `/history` endpoints
- **WebSocket Server**: Accepts WebSocket connections and sends status messages
- **Process Control**: Responds to SIGTERM/SIGINT for graceful shutdown
- **IPC Communication**: Signals when ready via process messaging

The mock server can be run standalone for debugging:

```bash
bun test/integration/mock-server.ts [port]
```

### Server Manager (`server-manager.ts`)

Utilities for managing mock server processes in tests:

- `startServer(port)`: Spawn a server process and wait until it's ready
- `killServer(port)`: Gracefully terminate a server process
- `restartServer(port, delayMs)`: Kill and restart a server with optional delay
- `killAll()`: Clean up all running servers
- `simulateServerDowntime(manager, port, downtimeMs)`: Helper for downtime simulation

### Test Files

- **`reconnection.integration.spec.ts`**: Comprehensive reconnection tests covering:
  - Manual reconnection
  - Automatic reconnection
  - Connection state transitions
  - Connection validation
  - Reconnection failure handling
  - Multiple server restarts
  - Message handling after reconnection

- **`reconnection-simple.example.spec.ts`**: Simple examples demonstrating the testing pattern:
  - Basic reconnection flow (step-by-step)
  - Auto-reconnection example
  - Multiple restart cycles

## Running Integration Tests

### Run all integration tests:
```bash
bun test test/integration/
```

### Run specific test file:
```bash
bun test test/integration/reconnection.integration.spec.ts
```

### Run the simple examples:
```bash
bun test test/integration/reconnection-simple.example.spec.ts
```

## Writing New Integration Tests

### Basic Pattern

```typescript
import { ServerManager } from "./server-manager";
import { ComfyApi } from "../../src/client";

describe("My Integration Test", () => {
  const serverManager = new ServerManager({ port: 8191 });

  afterAll(async () => {
    await serverManager.killAll();
  });

  test("my test case", async () => {
    // 1. Start server
    await serverManager.startServer(8191);

    // 2. Create and connect client
    const api = new ComfyApi("http://localhost:8191");
    await waitForConnection(api);

    // 3. Kill server to simulate downtime
    await serverManager.killServer(8191);
    await new Promise(r => setTimeout(r, 500));

    // 4. Restart server
    await serverManager.startServer(8191);

    // 5. Verify reconnection
    await api.reconnectWs(true);
    await waitForConnection(api);

    expect(api.isConnected()).toBe(true);

    // 6. Cleanup
    api.destroy();
    await serverManager.killServer(8191);
  });
});

function waitForConnection(api: ComfyApi): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (api.isConnected()) resolve();
      else setTimeout(check, 100);
    };
    check();
  });
}
```

### Best Practices

1. **Use Unique Ports**: Each test file should use a unique port to avoid conflicts
   ```typescript
   const TEST_PORT = 8191; // Different from other test files
   ```

2. **Always Clean Up**: Use `afterAll` to kill all servers
   ```typescript
   afterAll(async () => {
     await serverManager.killAll();
   });
   ```

3. **Add Appropriate Timeouts**: Integration tests take longer than unit tests
   ```typescript
   test("my test", async () => {
     // test code
   }, 15000); // 15 second timeout
   ```

4. **Wait for State Changes**: Network operations aren't instant
   ```typescript
   // After killing server, wait for disconnection
   await serverManager.killServer(port);
   await new Promise(r => setTimeout(r, 500));
   ```

5. **Handle Async Operations**: Use helper functions to poll for conditions
   ```typescript
   await new Promise<void>((resolve) => {
     const check = () => {
       if (condition) resolve();
       else setTimeout(check, 100);
     };
     check();
   });
   ```

## Testing Reconnection Scenarios

### Manual Reconnection
```typescript
await serverManager.killServer(port);
await serverManager.startServer(port);
await api.reconnectWs(true);
```

### Automatic Reconnection
```typescript
const api = new ComfyApi(url, "client-id", {
  autoReconnect: true
});

await serverManager.killServer(port);
await serverManager.startServer(port);
// Client will reconnect automatically
```

### Simulating Downtime
```typescript
import { simulateServerDowntime } from "./server-manager";

// Kill server, wait 2 seconds, restart
await simulateServerDowntime(serverManager, port, 2000);
```

### Multiple Restart Cycles
```typescript
for (let i = 0; i < 3; i++) {
  await serverManager.killServer(port);
  await new Promise(r => setTimeout(r, 1000));
  await serverManager.startServer(port);
  await waitForConnection(api);
}
```

## Debugging

### View Server Logs
Server output is automatically logged to console with `[Server PORT]` prefix:
```
[Server 8191] HTTP server listening on http://localhost:8191
[Server 8191] WebSocket server listening on ws://localhost:8191/ws
[Server 8191] Client connected (total: 1)
```

### Run Mock Server Standalone
```bash
bun test/integration/mock-server.ts 8191
```

Then manually connect with your client or tools like `wscat`:
```bash
wscat -c ws://localhost:8191/ws
```

### Add Debug Logging
```typescript
api.on("reconnected", () => {
  console.log("Reconnected event fired!");
});

api.on("status", (event) => {
  console.log("Status message:", event.detail);
});
```

## Troubleshooting

### Port Already in Use
If tests fail with "port already in use":
- Each test file should use a unique port
- Ensure `afterAll` cleanup is running
- Check for orphaned processes: `lsof -i :8191`

### Timeouts
If tests timeout:
- Increase test timeout: `test("name", async () => {...}, 30000)`
- Add more logging to see where it's stuck
- Verify server is actually starting (check console output)

### Flaky Tests
If tests are unreliable:
- Add delays after state changes
- Use polling with timeout instead of fixed delays
- Ensure previous test cleaned up properly

## CI/CD Considerations

These tests spawn processes and use network ports, so:

1. **Unique Ports**: Tests can run in parallel if using different ports
2. **Process Cleanup**: Always ensure processes are killed in `afterAll`
3. **Timeouts**: CI may be slower, use generous timeouts
4. **Port Availability**: Ensure test ports aren't used by other services

## Future Improvements

- Add tests for:
  - Connection pooling under server restarts
  - Workflow execution across reconnections
  - Error recovery scenarios
  - Health check behavior
  - Graceful degradation
- Mock more ComfyUI endpoints
- Add network latency simulation
- Test behavior under packet loss
- Add multi-client scenarios