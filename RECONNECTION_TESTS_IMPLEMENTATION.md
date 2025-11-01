# Reconnection Tests Implementation Summary

## What Was Built

A comprehensive integration test infrastructure for testing ComfyUI client reconnection behavior by spawning **real mock server processes** in separate operating system processes, then killing and restarting them to simulate actual server crashes and recoveries.

## Problem Statement

The original request was:
> "to make the reconnection tests work you need to spawn the mock server on a different process, then after some time you kill the process to spawn another simulating a real server going down and up again"

Unit tests with mocked WebSocket connections cannot accurately test:
- Real process lifecycle events
- Actual network disconnections
- Connection timing and retry logic
- State transitions during real network operations
- Multiple reconnection cycles

## Solution Architecture

### Components Created

#### 1. **Mock Server** (`test/integration/mock-server.ts`)
A standalone ComfyUI-compatible server that runs as a separate process.

**Features:**
- HTTP server with ComfyUI API endpoints (`/queue`, `/prompt`, `/system_stats`, `/history`)
- WebSocket server at `/ws` path
- Sends periodic status messages (every 5 seconds)
- Simulates workflow execution
- Graceful shutdown via SIGTERM/SIGINT
- IPC messaging to signal readiness to parent process

**Key Implementation:**
```typescript
// Can be run standalone for debugging
bun test/integration/mock-server.ts [port]

// Supports all required ComfyUI endpoints
GET  /queue       → queue status
GET  /prompt      → health check (used by pollStatus)
POST /prompt      → workflow execution
GET  /system_stats → system information
GET  /history     → execution history
WS   /ws          → WebSocket connection
```

#### 2. **Server Manager** (`test/integration/server-manager.ts`)
Process management utilities for controlling mock servers in tests.

**API:**
```typescript
class ServerManager {
  async startServer(port): ServerInstance
  async killServer(port): void
  async restartServer(port, delayMs): ServerInstance
  async killAll(): void
  isRunning(port): boolean
  getServer(port): ServerInstance | undefined
}
```

**Features:**
- Spawns servers using `child_process.spawn()`
- Waits for IPC "ready" message before resolving
- Handles graceful and forced termination
- Tracks all running servers
- Automatic cleanup on errors
- Configurable timeouts for startup/shutdown

#### 3. **Test Helpers** (`test/integration/test-helpers.ts`)
Reusable utilities to simplify test code and reduce duplication.

**Helpers:**
```typescript
// Client initialization
initializeClient(api): Promise<void>

// Connection state polling
waitForConnection(api, timeout): Promise<void>
waitForDisconnection(api, timeout): Promise<void>

// Generic polling
pollUntil(condition, timeout, interval): Promise<void>

// Event tracking
trackEvent(api, eventName): { promise, didFire(), cleanup() }

// Utilities
sleep(ms): Promise<void>
waitForEvent(api, eventName, timeout): Promise<Event>
```

#### 4. **Integration Tests** (`test/integration/reconnection.integration.spec.ts`)
Comprehensive test suite with 10 test cases covering:

1. **Manual Reconnection**
   - Successfully reconnects after server restart
   - Handles multiple reconnection attempts

2. **Automatic Reconnection**
   - Auto-reconnects when `autoReconnect: true`
   - Emits `reconnected` event on successful auto-reconnection

3. **Connection State Transitions**
   - Tracks states: connecting → connected → disconnected → reconnecting → connected

4. **Connection Validation**
   - `validateConnection()` returns true when server is up
   - `validateConnection()` returns false when server is down

5. **Reconnection Failure Handling**
   - Invokes `onReconnectionFailed` callback when server stays down

6. **Multiple Server Restarts**
   - Handles 3 consecutive server restart cycles gracefully

7. **WebSocket Message Handling**
   - Receives messages correctly after reconnection

#### 5. **Simple Examples** (`test/integration/reconnection-simple.example.spec.ts`)
Well-documented, step-by-step examples showing:

```typescript
// Example 1: Basic reconnection flow
test("basic reconnection flow", async () => {
  // Step 1: Start Mock Server
  await serverManager.startServer(TEST_PORT);
  
  // Step 2: Create Client and Connect
  const api = new ComfyApi(TEST_URL);
  await initializeClient(api);
  
  // Step 3: Kill Server (Simulate Downtime)
  await serverManager.killServer(TEST_PORT);
  
  // Step 4: Restart Server
  await serverManager.startServer(TEST_PORT);
  
  // Step 5: Trigger Reconnection
  await api.reconnectWs(true);
  await waitForConnection(api);
  
  // Step 6: Cleanup
  api.destroy();
  await serverManager.killAll();
});
```

#### 6. **Validation Script** (`test/integration/validate-mock-server.ts`)
Standalone script to verify the entire infrastructure works correctly.

**Tests:**
- Server startup and readiness
- HTTP endpoint responses
- WebSocket connection establishment
- Status message reception
- Server shutdown
- Server restart
- Client reconnection
- Resource cleanup

**Usage:** `bun test/integration/validate-mock-server.ts`

#### 7. **Documentation**
- `README.md` - Comprehensive guide to the integration test infrastructure
- `SUMMARY.md` - Architecture overview and implementation details
- `QUICKSTART.md` - Developer quick-start guide with common patterns

### NPM Scripts Added

```json
{
  "test:integration": "bun test ./test/integration/",
  "test:integration:simple": "bun test ./test/integration/reconnection-simple.example.spec.ts",
  "test:integration:reconnection": "bun test ./test/integration/reconnection.integration.spec.ts"
}
```

## How It Works

### Process Isolation Pattern

```
┌─────────────────────────────────────────────────────────┐
│ Test Process (Bun Test Runner)                         │
│                                                         │
│  ┌──────────────────────────────────────────┐          │
│  │ ServerManager                            │          │
│  │  - Spawns child processes                │          │
│  │  - Manages lifecycle                     │          │
│  │  - Handles IPC communication             │          │
│  └──────────┬───────────────────────────────┘          │
│             │                                            │
│             │ spawn()                                    │
│             ▼                                            │
│  ┌─────────────────────┐   ┌─────────────────────┐     │
│  │ Mock Server Process │   │ Mock Server Process │     │
│  │ PID: 12345          │   │ PID: 67890          │     │
│  │ Port: 8189          │   │ Port: 8190          │     │
│  │                     │   │                     │     │
│  │ HTTP + WebSocket    │   │ HTTP + WebSocket    │     │
│  └─────────────────────┘   └─────────────────────┘     │
│             ▲                        ▲                   │
│             │                        │                   │
│             │ HTTP/WS Connection     │                   │
│             │                        │                   │
│  ┌──────────┴────────────┐  ┌───────┴──────────┐       │
│  │ ComfyApi Client #1    │  │ ComfyApi Client #2│       │
│  │ Tests reconnection    │  │ Tests reconnection│       │
│  └───────────────────────┘  └──────────────────┘       │
└─────────────────────────────────────────────────────────┘
```

### Server Lifecycle

```
1. Test calls: serverManager.startServer(8189)
   ↓
2. ServerManager spawns: bun mock-server.ts 8189
   ↓
3. Mock server starts HTTP + WebSocket servers
   ↓
4. Mock server sends IPC message: "ready"
   ↓
5. ServerManager resolves startServer() promise
   ↓
6. Test creates ComfyApi client and calls init()
   ↓
7. Client connects to mock server via HTTP + WebSocket
   ↓
8. Test calls: serverManager.killServer(8189)
   ↓
9. ServerManager sends SIGTERM to process
   ↓
10. Mock server gracefully closes connections
   ↓
11. Mock server exits, ServerManager detects exit
   ↓
12. Test calls: serverManager.startServer(8189)
   ↓
13. New mock server process spawns (new PID)
   ↓
14. Client reconnects (manual or automatic)
```

## Test Results

All 13 integration tests passing:

```
✓ Manual Reconnection > successfully reconnects after server restart
✓ Manual Reconnection > handles multiple reconnection attempts
✓ Automatic Reconnection > automatically reconnects when autoReconnect is enabled
✓ Automatic Reconnection > emits reconnected event on successful auto-reconnection
✓ Connection State Transitions > tracks connection state through server lifecycle
✓ Connection Validation > validateConnection returns true when server is up
✓ Connection Validation > validateConnection returns false when server is down
✓ Reconnection Failure Handling > invokes onReconnectionFailed callback
✓ Multiple Server Restarts > handles multiple server restarts gracefully
✓ WebSocket Message Handling > receives messages correctly after reconnection
✓ Simple Example > basic reconnection flow
✓ Simple Example > auto-reconnection with server restart
✓ Simple Example > multiple server restarts

13 pass | 0 fail | 37 expect() calls
```

## Key Technical Details

### IPC Communication
The mock server signals readiness via Node.js IPC:
```typescript
// Mock server
if (process.send) {
  process.send("ready");
}

// Server manager
const messageHandler = (message: any) => {
  if (message === "ready") {
    resolve();
  }
};
instance.process.on("message", messageHandler);
```

### Graceful Shutdown
```typescript
// Mock server handles SIGTERM
process.on("SIGTERM", shutdown);

// Server manager enforces timeout
setTimeout(() => {
  instance.process.kill("SIGKILL"); // Force kill if needed
}, shutdownTimeout);
```

### Connection State Tracking
Tests verify the complete state machine:
```
connecting → connected → disconnected → reconnecting → connected
     ↓            ↓            ↓              ↓            ↓
   init()      open()       close()    reconnectWs()   open()
```

### Event Verification
```typescript
const tracker = trackEvent(api, "reconnected");
// ... perform actions
await pollUntil(() => tracker.didFire(), 10000);
expect(tracker.didFire()).toBe(true);
tracker.cleanup();
```

## Benefits

### Over Unit Tests
1. **Real Process Lifecycle** - Tests actual process spawning, killing, restarting
2. **True Network Behavior** - Real WebSocket connections, not mocks
3. **Timing Accuracy** - Tests actual connection timing and retry logic
4. **State Management** - Verifies state transitions match real-world scenarios
5. **Error Handling** - Tests actual error conditions and recovery

### Production Readiness
- CI/CD compatible
- Isolated test execution (different ports)
- Comprehensive cleanup (no orphaned processes)
- Detailed logging for debugging
- Timeout handling for reliability

## Usage Examples

### Run All Tests
```bash
bun test test/integration/
```

### Run Simple Examples
```bash
bun run test:integration:simple
```

### Validate Infrastructure
```bash
bun test/integration/validate-mock-server.ts
```

### Debug Mock Server
```bash
# Run standalone
bun test/integration/mock-server.ts 8191

# Connect with wscat
wscat -c ws://localhost:8191/ws

# Test with curl
curl http://localhost:8191/queue
```

## Files Created

```
test/integration/
├── README.md                           # Full documentation
├── SUMMARY.md                          # Architecture summary
├── QUICKSTART.md                       # Developer quick-start
├── mock-server.ts                      # 262 lines - Standalone server
├── server-manager.ts                   # 289 lines - Process management
├── test-helpers.ts                     # 177 lines - Test utilities
├── validate-mock-server.ts             # 154 lines - Validation script
├── reconnection.integration.spec.ts    # 375 lines - 10 comprehensive tests
└── reconnection-simple.example.spec.ts # 158 lines - 3 simple examples
```

**Total:** 9 files, ~1,850 lines of code

## Next Steps

### For Developers
1. Read `QUICKSTART.md` for common patterns
2. Run validation script to verify setup
3. Use simple examples as templates
4. Add new tests following established patterns

### Future Enhancements
- Test connection pooling under server restarts
- Test workflow execution across reconnections
- Add network latency/packet loss simulation
- Multi-client concurrent scenarios
- Load testing with many clients
- More ComfyUI-specific endpoint mocking

## Conclusion

This implementation provides a robust, production-ready integration test infrastructure that accurately simulates real-world server failures and reconnection scenarios. By using actual process spawning and termination, the tests provide confidence that the reconnection logic works correctly in production environments.

The infrastructure is:
- ✅ Well-documented with 3 comprehensive guides
- ✅ Easy to use with helper functions and examples
- ✅ Production-ready with proper cleanup and error handling
- ✅ Extensible for future test scenarios
- ✅ CI/CD compatible
- ✅ All 13 tests passing

**Mission accomplished!** 🎉