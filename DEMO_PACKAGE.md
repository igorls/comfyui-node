# WorkflowPool Hash-Based Routing - Comprehensive Demo Package

## 📦 Overview

This package contains a complete demonstration of the WorkflowPool hash-based routing feature added to the `improve-route-v2` branch. Hash-based routing provides **intelligent, workflow-level failure tracking and automatic failover** for multi-instance ComfyUI deployments.

## 📚 Documentation Files

### 1. **Hash Routing Guide** (`docs/hash-routing-guide.md`)
   - **Audience**: Developers new to hash-based routing
   - **Contents**:
     - What is hash-based routing and why it matters
     - Configuration options and usage examples
     - Real-world scenarios and best practices
     - Troubleshooting guide
   - **Key Sections**:
     - Key Concepts
     - Configuration Reference
     - Usage Examples
     - Performance Recommendations

### 2. **Hash Routing Architecture** (`docs/hash-routing-architecture.md`)
   - **Audience**: Architects and advanced developers
   - **Contents**:
     - System diagram with data flow
     - Complete job lifecycle diagrams
     - Data structure specifications
     - Failure recovery timeline
     - Performance characteristics
   - **Key Sections**:
     - System Architecture Diagram
     - Data Structures
     - Job Lifecycle (Success & Failure Paths)
     - Recovery Timeline
     - Monitoring & Observability

### 3. **Quick Start Guide** (`docs/hash-routing-quickstart.sh`)
   - **Audience**: Users who want to run the demos
   - **Contents**:
     - Quick start commands
     - Feature overview
     - Demo descriptions

## 🎯 Demo Scripts

### 1. **Basic Educational Demo** (`scripts/pool-hash-routing-demo.ts`)

**Purpose**: Demonstrate core concepts without requiring real ComfyUI servers

**Run Command**:
```bash
bun scripts/pool-hash-routing-demo.ts [--verbose]
```

**What It Shows**:
- Scenario 1: Normal execution with multiple workflows
- Scenario 2: Workflow failure and client blocking
- Scenario 3: Workflow hash independence
- Scenario 4: Cooldown and recovery mechanism
- Statistics and summary

**Key Output**:
```
✅ Demonstrates deterministic workflow hashing
✅ Shows client blocking for specific workflows
✅ Illustrates automatic failover
✅ Explains cooldown and recovery
✅ Provides configuration recommendations
```

**Runtime**: ~5 seconds
**Requirements**: None (uses mock clients)
**Verbose Mode**: `--verbose` flag shows detailed job logs

---

### 2. **Advanced Integration Demo** (`scripts/pool-hash-routing-advanced.ts`)

**Purpose**: Real-world integration patterns with optional real servers

**Run Commands**:
```bash
# Simulation mode (no servers needed)
bun scripts/pool-hash-routing-advanced.ts

# With real ComfyUI servers
COMFY_HOSTS=http://host1:8188,http://host2:8188 \
bun scripts/pool-hash-routing-advanced.ts
```

**What It Shows**:
- Scenario 1: Multi-tenant job routing
- Scenario 2: Workflow affinity optimization
- Scenario 3: Failure handling and recovery
- Event-based monitoring
- Performance metrics

**Key Features**:
- Multiple workflow variations
- Tenant isolation demonstration
- Real-time event monitoring
- Client performance tracking
- Custom failover strategy example

**Runtime**: ~30 seconds
**Output**: Multi-tenant metrics and health statistics

---

### 3. **Multi-Tenant Example** (`scripts/pool-multitenant-example.ts`)

**Purpose**: Real-world multi-tenant image generation service

**Run Command**:
```bash
COMFY_HOSTS=http://host1:8188,http://host2:8188 \
bun scripts/pool-multitenant-example.ts
```

**What It Shows**:
- Real service architecture
- Tenant metrics tracking
- Failure alerting and monitoring
- Performance per tenant
- Workflow blocking detection

**Key Components**:
- `MultiTenantImageService` class
- Job submission from multiple tenants
- Comprehensive metrics collection
- Event monitoring setup
- Production-ready patterns

**Requirements**: ComfyUI servers (can be mocked)

---

## 🔑 Key Concepts Demonstrated

### 1. Deterministic Workflow Hashing

Each workflow produces a consistent SHA-256 hash:
```
Same workflow → Same hash (always)
Different workflows → Different hashes
```

This enables:
- Consistent identification across restarts
- Failure tracking per workflow type
- Analytics and trending

### 2. Workflow-Level Blocking

Instead of blocking entire clients:

```
❌ OLD: Client fails → Entire client blocked
✅ NEW: Workflow fails on client → Only that workflow blocked on that client
```

Benefits:
- Minimal impact on system capacity
- Other workflows continue normally
- Intelligent failover decisions

### 3. Smart Failover Strategy

```
Configuration:
  cooldownMs: 60_000          (block duration)
  maxFailuresBeforeBlock: 1   (tolerance level)

Behavior:
  • Failure occurs
  • Record with expiry timestamp
  • Filter this client for this workflow
  • Wait for cooldown to expire
  • Automatically unblock
```

### 4. Automatic Recovery

No manual intervention needed:
- Cooldown period ticks down
- Block expires automatically
- Client becomes available again
- Events signal recovery for monitoring

### 5. Event-Driven Monitoring

```typescript
pool.on("client:blocked_workflow", (ev) => {
  // Workflow blocked on client - investigate
});

pool.on("client:unblocked_workflow", (ev) => {
  // Workflow recovered - resolution confirmed
});
```

## 📊 Architecture Highlights

### Data Flow

```
User Request
    ↓
Hash Workflow
    ↓
Queue Job
    ↓
Process from Queue
    ↓
Select Client (with failover filtering)
    ↓
Execute
    ↓
Success?
    ├─ YES → Complete, clean up blocks
    └─ NO  → Record failure, set expiry, retry later
```

### SmartFailoverStrategy State

```typescript
workflowFailures: Map<
  clientId,
  Map<
    workflowHash,
    {
      blockedUntil: timestamp,
      failureCount: number
    }
  >
>
```

### Job Lifecycle

```
QUEUED
  ↓
ACCEPTED (assigned to client)
  ↓
STARTED (received promptId)
  ↓
PROGRESS (updates during execution)
  ↓
COMPLETED or FAILED
  ↓
RETRYING or CANCELLED
```

## 🚀 Quick Start Examples

### Basic Usage

```typescript
import { ComfyApi, WorkflowPool, SmartFailoverStrategy } from "comfyui-node";

const clients = [
  new ComfyApi("http://localhost:8188"),
  new ComfyApi("http://localhost:8189")
];

const pool = new WorkflowPool(clients, {
  failoverStrategy: new SmartFailoverStrategy({
    cooldownMs: 60_000,
    maxFailuresBeforeBlock: 1
  })
});

await pool.ready();

// Monitor blocking
pool.on("client:blocked_workflow", (ev) => {
  console.log(`${ev.detail.clientId} blocked for ${ev.detail.workflowHash}`);
});

// Submit jobs
const jobId = await pool.enqueue(workflow, {
  priority: 5,
  metadata: { tenantId: "tenant-1" }
});
```

### Multi-Tenant Monitoring

```typescript
pool.on("job:completed", (ev) => {
  const { job } = ev.detail;
  updateMetrics(job.metadata.tenantId, "success");
});

pool.on("job:failed", (ev) => {
  const { job } = ev.detail;
  updateMetrics(job.metadata.tenantId, "failure");
});

pool.on("client:blocked_workflow", (ev) => {
  const { clientId, workflowHash } = ev.detail;
  alert(`Client ${clientId} having issues with workflow ${workflowHash}`);
});
```

## 📈 Configuration Recommendations

### Development Environment
```typescript
new SmartFailoverStrategy({
  cooldownMs: 30_000,        // Fast recovery
  maxFailuresBeforeBlock: 3  // Tolerant
})
```

### Production Environment
```typescript
new SmartFailoverStrategy({
  cooldownMs: 60_000,        // Balanced (default)
  maxFailuresBeforeBlock: 1  // Fail fast
})
```

### High-Availability Setup
```typescript
new SmartFailoverStrategy({
  cooldownMs: 120_000,       // Conservative
  maxFailuresBeforeBlock: 1  // Strict
})
```

## 🔍 Monitoring Best Practices

### 1. Alert on Blocked Workflows
```typescript
pool.on("client:blocked_workflow", (ev) => {
  // Send alert
  // Log incident
  // Trigger investigation
});
```

### 2. Track Recovery
```typescript
pool.on("client:unblocked_workflow", (ev) => {
  // Log resolution
  // Update status dashboard
  // Send notification
});
```

### 3. Metrics per Workflow
```typescript
const workflowMetrics = new Map();

pool.on("job:completed", (ev) => {
  const hash = ev.detail.job.workflowHash;
  const metrics = workflowMetrics.get(hash) || { success: 0, failure: 0 };
  metrics.success++;
  workflowMetrics.set(hash, metrics);
});
```

### 4. Tenant Isolation Monitoring
```typescript
pool.on("client:blocked_workflow", (ev) => {
  // Filter events by tenant
  // Alert tenant-specific issues
  // Prevent cross-tenant impact awareness
});
```

## 🧪 Running the Full Demo Suite

```bash
# 1. Build the project
bun run build

# 2. Run basic educational demo
echo "=== Basic Demo ===" && \
bun scripts/pool-hash-routing-demo.ts

# 3. Run advanced demo (simulation)
echo "=== Advanced Demo (Simulation) ===" && \
bun scripts/pool-hash-routing-advanced.ts

# 4. With real servers (if available)
export COMFY_HOSTS=http://localhost:8188,http://localhost:8189
echo "=== Advanced Demo (Real Servers) ===" && \
bun scripts/pool-hash-routing-advanced.ts
```

## 📖 Documentation Structure

```
docs/
├── hash-routing-guide.md          ← Start here (practical guide)
├── hash-routing-architecture.md   ← System design (detailed)
├── hash-routing-quickstart.sh     ← Quick commands
└── workflow-pool.md               ← General pool documentation

scripts/
├── pool-hash-routing-demo.ts      ← Educational demo
├── pool-hash-routing-advanced.ts  ← Integration demo
└── pool-multitenant-example.ts    ← Production pattern
```

## ✨ Benefits Summary

| Feature | Benefit |
|---------|---------|
| **Deterministic Hashing** | Consistent workflow identification across restarts |
| **Workflow-Level Blocking** | Minimal impact, other workflows unaffected |
| **Automatic Failover** | Intelligent routing to healthy clients |
| **Self-Healing** | Automatic recovery after cooldown |
| **Observable** | Event-based monitoring and alerting |
| **Multi-Tenant Safe** | Isolation and fair resource allocation |
| **Zero Configuration** | Works out of the box with sensible defaults |

## 🎓 Learning Path

1. **Start**: Read `docs/hash-routing-guide.md` (10 min)
2. **Visualize**: Review `docs/hash-routing-architecture.md` (15 min)
3. **Learn**: Run `scripts/pool-hash-routing-demo.ts` (5 min)
4. **Explore**: Run `scripts/pool-hash-routing-advanced.ts` (10 min)
5. **Build**: Use `scripts/pool-multitenant-example.ts` as template (30 min)
6. **Monitor**: Implement event handlers for your use case

## 🤝 Integration Steps

1. Update your ComfyUI client list to use `WorkflowPool`
2. Configure `SmartFailoverStrategy` for your hardware
3. Set up event handlers for monitoring
4. Test with your workflows
5. Deploy and monitor

## 📞 Support

For issues or questions:
1. Check `docs/troubleshooting.md`
2. Review demo scripts for examples
3. Examine event handler patterns in demos
4. Check GitHub issues

## 📝 Version Info

- **Feature Version**: v1.4.2+ (improve-route-v2 branch)
- **Added**: Hash-based workflow routing
- **Default**: SmartFailoverStrategy with 60s cooldown
- **Backward Compatible**: Yes, existing code works unchanged

## 🎯 Next Steps

1. Build the project: `bun run build`
2. Run the demo: `bun scripts/pool-hash-routing-demo.ts`
3. Read the guide: `docs/hash-routing-guide.md`
4. Explore examples: `scripts/pool-*.ts` files
5. Integrate into your project

---

**Happy Pooling! 🚀**
