# WebSocket Idle Connection Issue - RESOLVED

## Problem Description

WorkflowPool clients constantly disconnect and reconnect when idle, causing unnecessary reconnection cycles.

## Root Cause

The `ComfyApi` client implements an inactivity timeout mechanism that closes and reconnects the WebSocket if no messages are received within `wsTimeout` milliseconds (default was: 10000ms).

However, ComfyUI server **does not send heartbeat/keepalive messages** when idle. It only sends:
- Initial `status` message on connection
- `feature_flags` message on connection
- Subsequent messages only when there's activity (executions, queue changes, etc.)

This causes the client to repeatedly:
1. Wait 10 seconds without receiving any messages
2. Detect "inactivity" and trigger a reconnection
3. Reconnect and receive initial messages
4. Go idle again and repeat the cycle

## Evidence

From monitoring tests:
```
[+0ms] MESSAGE - status
[+2ms] MESSAGE - feature_flags
[+10027ms] EVENT - disconnected
[+10027ms] EVENT - reconnecting
[+10029ms] EVENT - reconnected
[+10029ms] MESSAGE - status
[+10030ms] MESSAGE - feature_flags
... (cycle repeats)
```

**Maximum interval between messages: 10027ms** (exceeds the 10000ms timeout)

## Solution Implemented ✅

### 1. Increased Default WebSocket Timeout
**File: `src/client.ts`**

Changed default `wsTimeout` from 10 seconds to 60 seconds:
```typescript
private readonly wsTimeout: number = 60000; // Was: 10000
```

**Benefits:**
- Reduces false disconnections during normal idle periods
- Still detects real connection failures reasonably quickly
- Users can override if needed

### 2. Health Check Ping Mechanism for WorkflowPool
**File: `src/pool/client/ClientManager.ts`**

Added periodic health check that:
- Runs every 30 seconds by default (configurable)
- Polls idle clients with lightweight `getQueue()` calls
- Keeps WebSocket connections alive
- Detects connection issues proactively
- Only pings idle (non-busy) clients to avoid interference

**Key Features:**
```typescript
constructor(strategy: FailoverStrategy, opts?: { 
  healthCheckIntervalMs?: number 
}) {
  this.healthCheckIntervalMs = opts?.healthCheckIntervalMs ?? 30000;
}

private async performHealthCheck(): Promise<void> {
  for (const managed of this.clients) {
    if (!managed.busy && managed.online) {
      try {
        await managed.client.getQueue(); // Lightweight ping
        managed.lastSeenAt = Date.now();
      } catch (error) {
        console.warn(`Health check failed for ${managed.id}`);
      }
    }
  }
}
```

### 3. WorkflowPool Configuration
**File: `src/pool/WorkflowPool.ts`**

Added configuration option:
```typescript
interface WorkflowPoolOpts {
  healthCheckIntervalMs?: number; // Default: 30000 (30s), set to 0 to disable
}
```

Example usage:
```typescript
const pool = new WorkflowPool(clients, {
  healthCheckIntervalMs: 30000 // 30 seconds
});
```

### 4. Proper Cleanup
Added `destroy()` method to ClientManager that stops health check interval on shutdown:
```typescript
destroy(): void {
  this.stopHealthCheck();
}
```

WorkflowPool now calls `clientManager.destroy()` in `shutdown()`.

## Test Results

### Before Fix (default 10s timeout, no health check)
```
✗ Multiple disconnections detected (3 disconnects every ~10s)
⚠️ Unstable connections
```

### After Fix (60s timeout + 30s health check)
```
✓ 120 seconds monitored: 0 disconnects, 0 reconnects
✓ Health check maintained stable connection
✓ All WebSocket events received properly (previews, progress, execution)
✓ Pool remained functional after long idle period
```

## Test Scripts

Created comprehensive test scripts:

1. **`scripts/debug-idle-connections.ts`** - Monitor connection cycles
2. **`scripts/debug-websocket-activity.ts`** - Track WebSocket message patterns
3. **`scripts/test-long-idle-then-execute.ts`** - Test connection after 90s idle
4. **`scripts/test-long-idle-txt2img.ts`** - Test with image generation + previews
5. **`scripts/test-health-check.ts`** - Verify health check mechanism

Run tests:
```bash
# Test idle stability with high timeout
bun run scripts/debug-idle-connections.ts

# Test long idle then execution with previews
IDLE_DURATION_MS=90000 bun run scripts/test-long-idle-txt2img.ts

# Test health check mechanism
bun run scripts/test-health-check.ts
```

## Configuration Options

### For Individual Clients
```typescript
const client = new ComfyApi(host, clientId, {
  wsTimeout: 60000 // 60 seconds (new default)
});
```

### For WorkflowPool
```typescript
const pool = new WorkflowPool(clients, {
  healthCheckIntervalMs: 30000 // 30 seconds (default)
  // Set to 0 to disable health checks
});
```

## Benefits

1. ✅ **Eliminates false disconnections** during idle periods
2. ✅ **Proactive health monitoring** via periodic pings
3. ✅ **Prevents false host issue alerts** in pool management
4. ✅ **Maintains WebSocket activity** with minimal overhead
5. ✅ **Configurable** - users can adjust intervals or disable
6. ✅ **No interference** - only pings idle clients
7. ✅ **Proper cleanup** - resources released on shutdown

## Performance Impact

- **Health check overhead**: ~1 lightweight HTTP request per client every 30s
- **Network traffic**: Minimal (~200 bytes per ping)
- **CPU/Memory**: Negligible
- **Benefit**: Prevents expensive reconnection cycles

## Migration Guide

No breaking changes. The improvements work automatically with existing code:

```typescript
// Old code continues to work
const pool = new WorkflowPool(clients);

// But now:
// - Default timeout is 60s instead of 10s
// - Health check runs automatically every 30s
// - No more false disconnections

// Optional: Customize health check
const pool = new WorkflowPool(clients, {
  healthCheckIntervalMs: 60000 // Every 60s
});

// Optional: Disable health check (not recommended)
const pool = new WorkflowPool(clients, {
  healthCheckIntervalMs: 0 // Disabled
});
```

## Conclusion

The issue has been fully resolved through a combination of:
1. Increased default timeout (10s → 60s)
2. Proactive health check mechanism (30s interval)
3. Proper resource cleanup

WorkflowPool connections now remain stable during idle periods while still detecting real connection failures.
