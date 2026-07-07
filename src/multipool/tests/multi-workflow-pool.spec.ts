import { describe, it, expect, jest } from "bun:test";
import { MultiWorkflowPool } from "../multi-workflow-pool.js";
import { Workflow } from "../workflow.js";
import type { EnhancedClient } from "../interfaces.js";

// Regression coverage for the idle re-trigger (general-queue liveness).
//
// When a client goes idle the pool must re-poke the queues that client can
// serve. A client can serve its affinity queues AND the shared "general" queue
// (any idle client may pull a general job). The previous implementation poked
// only `client.workflowAffinity`, so:
//   - general-queue jobs submitted while every client was busy never resumed, and
//   - a client added WITHOUT affinity (workflowAffinity === undefined) pulled
//     nothing after finishing a job.
// Both would stall forever. These tests lock the fixed behavior.

describe("MultiWorkflowPool.triggerQueuesForIdleClient", () => {
  const spyQueue = () => ({ processQueue: jest.fn().mockResolvedValue(undefined) });

  // The pool constructor connects to nothing, so it is safe to instantiate here.
  const makePool = () => new MultiWorkflowPool();

  it("pokes the general queue AND affinity queues for a client with affinity", () => {
    const pool = makePool();
    const general = spyQueue();
    const specific = spyQueue();
    (pool.queues as any).set("general", general);
    (pool.queues as any).set("hash-A", specific);

    const client: EnhancedClient = {
      url: "http://host-a:8188", state: "idle", nodeName: "host-a",
      api: {} as any, workflowAffinity: new Set(["hash-A"]),
    };
    (pool as any).triggerQueuesForIdleClient(client);

    expect(specific.processQueue).toHaveBeenCalledTimes(1);
    // The regression: the general queue must be poked too.
    expect(general.processQueue).toHaveBeenCalledTimes(1);
  });

  it("pokes the general queue for a client registered WITHOUT affinity", () => {
    const pool = makePool();
    const general = spyQueue();
    (pool.queues as any).set("general", general);

    const client: EnhancedClient = {
      url: "http://host-b:8188", state: "idle", nodeName: "host-b",
      api: {} as any, // no workflowAffinity → undefined
    };
    (pool as any).triggerQueuesForIdleClient(client);

    expect(general.processQueue).toHaveBeenCalledTimes(1);
  });

  it("does not throw when an affinity hash has no live queue", () => {
    const pool = makePool();
    const general = spyQueue();
    (pool.queues as any).set("general", general);

    const client: EnhancedClient = {
      url: "http://host-c:8188", state: "idle", nodeName: "host-c",
      api: {} as any, workflowAffinity: new Set(["hash-missing"]),
    };
    expect(() => (pool as any).triggerQueuesForIdleClient(client)).not.toThrow();
    expect(general.processQueue).toHaveBeenCalledTimes(1);
  });
});

describe("MultiWorkflowPool.submitToVariants", () => {
  const wf = (ckpt: string) => Workflow.from({ "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: ckpt } } });
  // Replace the pool's client registry + submitJob with stubs/spies.
  const wire = (pool: MultiWorkflowPool, registry: any) => {
    (pool as any).clientRegistry = registry;
    return jest.spyOn(pool, "submitJob").mockResolvedValue("job-id");
  };

  it("throws when no variants are given", async () => {
    const pool = new MultiWorkflowPool();
    await expect(pool.submitToVariants([])).rejects.toThrow(/at least one/);
  });

  it("dispatches the variant whose host is idle now", async () => {
    const pool = new MultiWorkflowPool();
    const vA = wf("a.safetensors"), vB = wf("b.safetensors");
    const submit = wire(pool, {
      getOptimalClient: (v: any) => (v === vB ? { url: "http://b", priority: 0 } : null),
      hasClientsForWorkflow: () => true,
    });
    await pool.submitToVariants([vA, vB]);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0]).toBe(vB);
  });

  it("prefers the idle host with the highest priority (order-independent)", async () => {
    const pool = new MultiWorkflowPool();
    const vA = wf("a.safetensors"), vB = wf("b.safetensors");
    const submit = wire(pool, {
      getOptimalClient: (v: any) => (v === vA ? { url: "http://a", priority: 5 } : { url: "http://b", priority: 1 }),
      hasClientsForWorkflow: () => true,
    });
    await pool.submitToVariants([vB, vA]);
    expect(submit.mock.calls[0][0]).toBe(vA);
  });

  it("parks on a capable variant when no host is idle", async () => {
    const pool = new MultiWorkflowPool();
    const vA = wf("a.safetensors"), vB = wf("b.safetensors");
    const submit = wire(pool, {
      getOptimalClient: () => null, // none idle
      hasClientsForWorkflow: (h: string) => h === vB.structureHash, // only B has clients
    });
    await pool.submitToVariants([vA, vB]);
    expect(submit.mock.calls[0][0]).toBe(vB);
  });
});
