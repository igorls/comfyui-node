import { describe, it, expect, jest } from "bun:test";
import { MultiWorkflowPool } from "../multi-workflow-pool.js";
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
