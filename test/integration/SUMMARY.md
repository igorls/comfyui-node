# Integration Test Infrastructure Summary

## Overview

This integration test infrastructure enables **real-world reconnection testing** by spawning actual mock server processes, then killing and restarting them to simulate server downtime. This approach provides more realistic testing than unit tests with mocked WebSocket connections.

## Problem Solved

The original unit tests for reconnection behavior used mocked WebSocket connections, which cannot accurately simulate real server process lifecycle events like:

- Server crashes and restarts
- Network disconnections
- Connection timing issues
- Multiple reconnection attempts
- State transitions during actual network operations

## Solution Architecture

The integration test infrastructure consists of four main components:

### 1. Mock Server (`mock-server.ts`)

A standalone ComfyUI-compatible server that can be spawned as a separate process.

**Features:**
- HTTP server responding to ComfyUI API endpoints (`/queue`, `/prompt`, `/system_stats`, `/history`)
- WebSocket server on `/ws` path
- Sends periodic status messages
- Responds to SIGTERM/SIGINT for graceful shutdown
- IPC communication to signal when ready
- Can be run standalone for debugging: `bun test/integration/mock-server.ts [port]`

**Key Endpoints:**
- `GET /queue` - Returns queue status
- `GET /prompt` - Used by `pollStatus()` for health checks
- `POST /prompt` - Simulates workflow execution
- `GET /system_stats` - Returns mock system information
- WebSocket at `/ws` - Sends status messages and handles client connections

### 2. Server Manager (`server-manager.ts`)

Utilities for managing mock server processes in tests.

**Core Methods:**
- `startServer(port)` - Spawns a server process and waits until ready
- `killServer(port)` - Gracefully terminates a server process
- `restartServer(port, delayMs)` - Kills and restarts with optional delay
- `killAll()` - Cleans up all running servers
- `isRunning(port)` - Check if server is running
- `getServer(port)` - Get server instance details

**Features:**
- Process lifecycle management (spawn, kill, track)
- Timeout handling for startup and shutdown
- IPC message handling for ready signals
- Automatic cleanup on errors
- Detailed logging of server output

### 3. Test Helpers (`test-helpers.ts`)

Common utilities to reduce code duplication in tests.

**Helper Functions:**
- `initializeClient(api)` - Initialize ComfyApi client and wait for ready
- `waitForConnection(api, timeout)` - Poll until client is connected
- `waitForDisconnection(api, timeout)` - Poll until client disconnects
- `waitForEvent(api, eventName, timeout)` - Wait for specific event to fire
- `sleep(ms)` - Simple delay utility
- `pollUntil(condition, timeout, interval)` - Generic polling utility
- `trackEvent(api, eventName)` - Track whether an event fired

**Benefits:**
- Consistent error handling and timeouts
- Cleaner, more readable tests
- Reusable patterns across test files

### 4. Test Suites

Two test suites demonstrate different aspects of reconnection:

#### `reconnection.integration.spec.ts` - Comprehensive Tests

Tests covering:
- Manual reconnection after server restart
- Automatic reconnection with `autoReconnect` option
- Connection state transitions through lifecycle
- Connection validation methods
- Reconnection failure handling
- Multiple server restart cycles
- WebSocket message handling after reconnection

#### `reconnection-simple.example.spec.ts` - Examples

Simple, well-documented examples showing:
- Basic reconnection flow (step-by-step)
- Auto-reconnection example
- Multiple restart cycles

### 5. Validation Script (`validate-mock-server.ts`)

A standalone script to verify the mock server works correctly.

**Tests:**
1. Server startup
2. HTTP endpoints
3. WebSocket connection
4. Status message reception
5. Server shutdown
6. Server restart
7. Client reconnection
8. Resource cleanup

**Usage:** `bun test/integration/validate-mock-server.ts`

## How It Works

### Basic Pattern

```typescript
// 1. Start mock server in separate process
await serverManager.startServer(8189);

// 2. Create and initialize client
const api = new ComfyApi("http://localhost:8189");
await initializeClient(api);

// 3. Kill server (simulates crash)
await serverManager.killServer(8189);
await sleep(500);

// 4. Restart server (simulates recovery)
await serverManager.startServer(8189);

// 5. Verify reconnection
await api.reconnectWs(true);
await waitForConnection(api);

expect(api.isConnected()).toBe(true);

// 6. Cleanup
api.destroy();
await serverManager.killServer(8189);
```

### Process Isolation

- Each mock server runs in its own process
- Tests can kill/restart servers without affecting test process
- Simulates real production scenarios accurately
- Multiple servers can run on different ports for parallel testing

### State Tracking

The integration tests verify:
- Connection state transitions (`connecting` → `connected` → `disconnected` → `reconnecting` → `connected`)
- Event emission (`connected`, `reconnected`, `reconnection_failed`)
- API validation (`isConnected()`, `validateConnection()`)
- Message handling across reconnections

## Running Tests

```bash
# All integration tests
bun test test/integration/

# Specific test file
bun test test/integration/reconnection.integration.spec.ts

# Simple examples
bun run test:integration:simple

# Validation script
bun test/integration/validate-mock-server.ts
```

## Key Features Tested

### 1. Manual Reconnection
Tests that clients can manually trigger reconnection after server restarts.

### 2. Automatic Reconnection
Tests that clients with `autoReconnect: true` automatically reconnect when the server comes back online.

### 3. Connection State Management
Verifies that the `connectionState` property accurately reflects the connection lifecycle.

### 4. Event Emission
Confirms that events like `reconnected` and `reconnection_failed` fire at the correct times.

### 5. Multiple Restart Cycles
Tests resilience through multiple server down/up cycles.

### 6. Message Handling
Verifies that WebSocket messages are correctly received after reconnection.

## Benefits Over Unit Tests

1. **Real Process Lifecycle** - Tests actual process spawning, killing, and restarting
2. **True Network Behavior** - Real WebSocket connections, not mocks
3. **Timing Accuracy** - Tests actual connection timing and retry logic
4. **State Management** - Verifies state transitions match real-world scenarios
5. **Error Handling** - Tests actual error conditions and recovery
6. **CI/CD Ready** - Can run in automated pipelines

## NPM Scripts

Added to `package.json`:

```json
{
  "test:integration": "bun test ./test/integration/",
  "test:integration:simple": "bun test ./test/integration/reconnection-simple.example.spec.ts",
  "test:integration:reconnection": "bun test ./test/integration/reconnection.integration.spec.ts"
}
```

## File Structure

```
test/integration/
├── README.md                           # Documentation
├── SUMMARY.md                          # This file
├── mock-server.ts                      # Standalone mock server
├── server-manager.ts                   # Process management utilities
├── test-helpers.ts                     # Common test utilities
├── validate-mock-server.ts             # Validation script
├── reconnection.integration.spec.ts    # Comprehensive tests
└── reconnection-simple.example.spec.ts # Simple examples
```

## Future Enhancements

Potential improvements:
- Test connection pooling under server restarts
- Test workflow execution across reconnections
- Add network latency simulation
- Test behavior under packet loss
- Multi-client scenarios
- Load testing with many concurrent clients
- Test graceful degradation strategies
- Mock more ComfyUI-specific endpoints and behaviors

## Debugging Tips

1. **View Server Logs**: Server output is logged with `[Server PORT]` prefix
2. **Run Server Standalone**: `bun test/integration/mock-server.ts 8191`
3. **Add Debug Logging**: Use event listeners to track state changes
4. **Check Ports**: Ensure test ports aren't already in use
5. **Increase Timeouts**: If tests are flaky, increase timeout values

## Conclusion

This integration test infrastructure provides a robust, realistic way to test reconnection behavior in the comfyui-node library. By spawning actual server processes, the tests accurately simulate real-world scenarios that cannot be replicated with mocked connections. The infrastructure is well-documented, easy to use, and provides a solid foundation for future testing improvements.