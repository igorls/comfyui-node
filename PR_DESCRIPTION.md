# Integration Tests for Reconnection Behavior

## Summary

This PR implements a comprehensive integration test infrastructure for testing ComfyUI client reconnection behavior by spawning **real mock server processes**, then killing and restarting them to simulate actual server crashes and recoveries.

## Problem

The previous reconnection tests used mocked WebSocket connections, which cannot accurately simulate:
- Real server process crashes and restarts
- Actual network disconnections and timing issues
- Connection state transitions during real network operations
- Multiple reconnection cycles with real retry logic

## Solution

Created a complete integration test infrastructure with:

### 1. Mock Server (`test/integration/mock-server.ts`)
- Standalone ComfyUI-compatible server running in separate process
- HTTP endpoints: `/queue`, `/prompt`, `/system_stats`, `/history`
- WebSocket server at `/ws` with periodic status messages
- Graceful shutdown via SIGTERM/SIGINT
- IPC messaging to signal readiness
- Can be run standalone: `bun test/integration/mock-server.ts [port]`

### 2. Server Manager (`test/integration/server-manager.ts`)
- Process lifecycle management (spawn, kill, restart)
- `startServer(port)` - Spawns server and waits for ready signal
- `killServer(port)` - Gracefully terminates server
- `restartServer(port, delay)` - Kill and restart with optional delay
- `killAll()` - Cleanup all servers
- Configurable timeouts and error handling

### 3. Test Helpers (`test/integration/test-helpers.ts`)
- `initializeClient(api)` - Initialize and wait for ready
- `waitForConnection(api)` - Poll until connected
- `waitForDisconnection(api)` - Poll until disconnected
- `pollUntil(condition)` - Generic polling utility
- `trackEvent(api, event)` - Track event firing
- `sleep(ms)` - Simple delay

### 4. Integration Tests (`reconnection.integration.spec.ts`)
10 comprehensive test cases covering:
- ✅ Manual reconnection after server restart
- ✅ Multiple reconnection attempts
- ✅ Automatic reconnection with `autoReconnect: true`
- ✅ `reconnected` event emission
- ✅ Connection state transitions (connecting → connected → disconnected → reconnecting → connected)
- ✅ Connection validation (`validateConnection()`)
- ✅ Reconnection failure handling
- ✅ Multiple server restart cycles
- ✅ WebSocket message handling after reconnection

### 5. Simple Examples (`reconnection-simple.example.spec.ts`)
3 well-documented, step-by-step examples:
- Basic reconnection flow
- Auto-reconnection example
- Multiple restart cycles

### 6. Validation Script (`validate-mock-server.ts`)
Standalone script verifying entire infrastructure works correctly

### 7. Documentation
- `README.md` - Comprehensive guide (276 lines)
- `SUMMARY.md` - Architecture overview (253 lines)
- `QUICKSTART.md` - Developer quick-start guide (405 lines)

## How It Works

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
await serverManager.killAll();
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

## Files Added

```
test/integration/
├── README.md                           # Full documentation (276 lines)
├── SUMMARY.md                          # Architecture summary (253 lines)
├── QUICKSTART.md                       # Developer quick-start (405 lines)
├── mock-server.ts                      # Standalone server (262 lines)
├── server-manager.ts                   # Process management (289 lines)
├── test-helpers.ts                     # Test utilities (177 lines)
├── validate-mock-server.ts             # Validation script (154 lines)
├── reconnection.integration.spec.ts    # Comprehensive tests (375 lines)
└── reconnection-simple.example.spec.ts # Simple examples (158 lines)

Total: 9 files, ~2,350 lines
```

## NPM Scripts Added

```json
{
  "test:integration": "bun test ./test/integration/",
  "test:integration:simple": "bun test ./test/integration/reconnection-simple.example.spec.ts",
  "test:integration:reconnection": "bun test ./test/integration/reconnection.integration.spec.ts"
}
```

## Running Tests

```bash
# All integration tests
bun test test/integration/

# Simple examples (recommended first)
bun run test:integration:simple

# Comprehensive tests
bun run test:integration:reconnection

# Validate infrastructure
bun test/integration/validate-mock-server.ts
```

## Key Features

### Real Process Isolation
- Mock servers run in separate OS processes
- Can be killed/restarted without affecting test process
- Simulates production scenarios accurately

### Comprehensive Testing
- Tests manual and automatic reconnection
- Verifies connection state machine
- Confirms event emission
- Validates message handling across reconnections
- Tests multiple restart cycles

### Developer-Friendly
- Well-documented with 3 comprehensive guides
- Helper functions reduce code duplication
- Simple examples as templates
- Standalone validation script

### Production-Ready
- CI/CD compatible
- Proper resource cleanup (no orphaned processes)
- Timeout handling for reliability
- Detailed logging for debugging
- Uses unique ports to avoid conflicts

## Benefits Over Unit Tests

1. **Real Process Lifecycle** - Tests actual process spawning, killing, restarting
2. **True Network Behavior** - Real WebSocket connections, not mocks
3. **Timing Accuracy** - Tests actual connection timing and retry logic
4. **State Management** - Verifies state transitions match real-world scenarios
5. **Error Handling** - Tests actual error conditions and recovery

## Breaking Changes

None - this is purely additive.

## Future Enhancements

- Test connection pooling under server restarts
- Test workflow execution across reconnections
- Add network latency/packet loss simulation
- Multi-client concurrent scenarios
- Load testing with many clients

## Checklist

- [x] Tests implemented and passing (13/13)
- [x] Documentation complete (3 comprehensive guides)
- [x] Validation script working
- [x] NPM scripts added
- [x] No breaking changes
- [x] CI/CD compatible
- [x] Proper cleanup implemented

## Related Issues

Addresses the requirement for proper reconnection testing with real server process lifecycle simulation.