# Test Guide

This document explains the test organization and how to run tests in the comfyui-node project.

## Test Organization

The test suite is divided into two main categories:

### 1. Unit Tests (`test/*.spec.ts`)

Fast, isolated tests that mock external dependencies and don't require a running ComfyUI server. These tests run quickly and are suitable for continuous integration and rapid development feedback.

**Location:** `test/*.spec.ts` (root level of test directory)

**Characteristics:**
- Mock all network calls and external dependencies
- Run in milliseconds
- No process spawning
- Suitable for CI/CD pipelines

### 2. Integration Tests (`test/integration/*.spec.ts`)

Slower tests that spawn actual mock server processes to simulate real-world scenarios like server disconnections, reconnections, and network failures.

**Location:** `test/integration/` directory

**Characteristics:**
- Spawn separate server processes
- Test real network connections
- Test reconnection behavior
- Run in seconds (10-20s per test file)
- Should be run separately from unit tests

## Running Tests

### Default Test Command (Unit Tests Only)

```bash
bun test
# or
bun run test
```

This runs **only unit tests** (excludes integration tests). This is the recommended command for:
- Quick feedback during development
- CI/CD pipelines
- Pre-commit checks

**Expected output:**
```
✓ 235+ tests pass
○ 17 tests skipped
✗ 0 tests fail
⏱ ~2 seconds
```

### All Tests (Including Integration)

```bash
bun run test:all
```

This runs **all tests** including integration tests. Note that integration tests may:
- Take significantly longer (20-60 seconds)
- Require available ports (8189, 8190)
- Be sensitive to system resource contention when run in parallel

### Integration Tests Only

Run all integration tests:
```bash
bun run test:integration
```

Run specific integration test suites:
```bash
# Simple reconnection examples
bun run test:integration:simple

# Full reconnection test suite
bun run test:integration:reconnection
```

### Real Server Tests (Optional)

If you have a ComfyUI server running locally:

```bash
# Basic integration tests with real server
COMFY_REAL=1 bun run test:real

# Full integration tests with real server
COMFY_REAL=1 COMFY_FULL=1 bun run test:full
```

## Test File Patterns

- `test/*.spec.ts` - Unit tests
- `test/integration/*.spec.ts` - Integration tests
- `test/real.*.spec.ts` - Real server integration tests (skipped by default)

## Common Issues

### Integration Tests Fail When Run with All Tests

**Problem:** Integration tests pass individually but fail when run with `bun run test:all`

**Cause:** Resource contention or timing issues when running 300+ tests in parallel

**Solution:** Run integration tests separately:
```bash
bun run test              # Unit tests only
bun run test:integration  # Integration tests separately
```

### "Can't connect to the server" Error

**Problem:** Tests fail with connection errors

**Cause:** 
- No server running (for real server tests)
- Port conflicts (for integration tests)
- Server not ready before client connection attempt

**Solution:**
- For unit tests: Ensure mocks are properly configured
- For integration tests: Run them separately with `bun run test:integration`
- For real server tests: Ensure ComfyUI is running and set `COMFY_REAL=1`

### Tests Timeout

**Problem:** Tests timeout after 5 seconds (default) or custom timeout

**Cause:**
- Network calls in tests that should be mocked
- Server process not starting in integration tests
- Actual timeout (operation genuinely takes too long)

**Solution:**
- Check that unit tests mock all network calls
- For integration tests, increase timeout if needed (see test file configuration)
- Ensure integration tests run separately

## Writing New Tests

### Unit Tests

Place in `test/` directory with `*.spec.ts` extension.

**Key principles:**
- Mock all external dependencies (network, file system, etc.)
- Tests should complete in milliseconds
- Use mock clients with stubbed `init()` method:

```typescript
import { ComfyApi } from "../src/client";

beforeEach(() => {
  mockClient = new ComfyApi("http://localhost:8188", "test-client");
  
  // Mock the init method to prevent network calls
  mockClient.init = async () => {
    (mockClient as any).socket = { readyState: 1 }; // OPEN state
    (mockClient as any).clientId = "test-client";
  };
});
```

### Integration Tests

Place in `test/integration/` directory with `*.spec.ts` extension.

**Key principles:**
- Use unique ports to avoid conflicts (8189, 8190, etc.)
- Clean up server processes in `afterEach` or `afterAll`
- Use provided test helpers from `test/integration/test-helpers.ts`
- Set appropriate timeouts (15-30 seconds for complex scenarios)

```typescript
import { ServerManager } from "./server-manager";
import { initializeClient, waitForConnection } from "./test-helpers";

const TEST_PORT = 8191; // Use unique port

describe("My Integration Test", () => {
  const serverManager = new ServerManager({ port: TEST_PORT });

  afterAll(async () => {
    await serverManager.killAll();
  });

  test("my test", async () => {
    await serverManager.startServer(TEST_PORT);
    const api = new ComfyApi(`http://localhost:${TEST_PORT}`);
    await initializeClient(api);
    
    // Your test logic here
    
    api.destroy();
    await serverManager.killServer(TEST_PORT);
  }, 15000); // 15 second timeout
});
```

## Coverage

Generate coverage reports:

```bash
# Text format
bun run coverage

# LCOV format (for tools like VSCode extensions)
bun run coverage:lcov

# Enforce coverage thresholds
bun run coverage:enforce
```

## CI/CD Recommendations

For continuous integration pipelines, use:

```bash
bun run test  # Unit tests only - fast and reliable
```

Optionally run integration tests in a separate job:

```bash
bun run test:integration  # Integration tests - slower but comprehensive
```

This approach provides:
- Fast feedback from unit tests (~2 seconds)
- Reliable results (no timing/resource issues)
- Optional comprehensive testing via integration tests