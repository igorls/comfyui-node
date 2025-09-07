import { describe, it, expect, beforeEach } from "bun:test";
import { ComfyPool, EQueueMode } from "../src/pool";

// Minimal subset of ComfyApi interface needed by pool
class MockComfyApi extends EventTarget {
  id: string;
  osType: string = "posix";
  private destroyed = false;
  private ready = false;
  private queueRemaining = 0;
  ext: any;

  constructor(id: string) {
    super();
    this.id = id;
    this.ext = { monitor: { isSupported: false, on: () => {} } };
  }

  async init() {
    this.ready = true;
    // Emit an initial status so pool marks it online
    this.emitStatus();
    return this;
  }

  on(type: string, cb: (...args: any[]) => void) {
    this.addEventListener(type as any, (ev: any) => cb(ev));
  }

  destroy() {
    this.destroyed = true;
  }

  emitStatus(queueRemaining: number = this.queueRemaining) {
    this.queueRemaining = queueRemaining;
    const detail = {
      status: {
        exec_info: {
          queue_remaining: queueRemaining
        }
      }
    };
    this.dispatchEvent(new CustomEvent("status", { detail }));
  }

  simulateExecutionSuccess() {
    this.emitStatus(0);
    this.dispatchEvent(new CustomEvent("execution_success", { detail: {} }));
  }
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe("ComfyPool", () => {
  let clients: MockComfyApi[];

  beforeEach(() => {
    clients = [new MockComfyApi("a"), new MockComfyApi("b"), new MockComfyApi("c")];
  });

  it("initializes clients and emits ready", async () => {
  const pool = new ComfyPool(clients as any);
    let readyCount = 0;
    pool.on("ready", () => readyCount++);
    await wait(10);
    expect(pool.clients.length).toBe(3);
    expect(readyCount).toBe(3);
    pool.destroy();
  });

  it("runs jobs in PICK_ZERO favoring idle clients", async () => {
  const pool = new ComfyPool(clients as any, EQueueMode.PICK_ZERO);
    await wait(5);
    const used: string[] = [];
    await pool.batch([
      async (api: any) => { used.push(api.id); api.simulateExecutionSuccess(); },
      async (api: any) => { used.push(api.id); api.simulateExecutionSuccess(); },
      async (api: any) => { used.push(api.id); api.simulateExecutionSuccess(); }
    ]);
    // Expect we touched at least 2 distinct clients (not guaranteed all 3 depending on timing)
    expect(new Set(used).size).toBeGreaterThanOrEqual(2);
    pool.destroy();
  });

  it("round-robin distributes clients", async () => {
  const pool = new ComfyPool(clients as any, EQueueMode.PICK_ROUTINE);
    await wait(5);
    const used: string[] = [];
    for (let i=0;i<6;i++) {
      await pool.run(async (api: any) => { used.push(api.id); api.simulateExecutionSuccess(); });
    }
    // Expect approximate repeating pattern a,b,c,a,b,c
    expect(used.slice(0,3)).toEqual(["a","b","c"]);
    pool.destroy();
  });

  it("lowest queue mode picks client with smallest queue_remaining", async () => {
  const pool = new ComfyPool(clients as any, EQueueMode.PICK_LOWEST);
    await wait(5);
    // Simulate queue depths
    (pool.clients[0] as any).emitStatus(5);
    (pool.clients[1] as any).emitStatus(2);
    (pool.clients[2] as any).emitStatus(7);
    let picked = "";
    await pool.run(async (api: any) => { picked = api.id; api.simulateExecutionSuccess(); });
    expect(picked).toBe("b");
    pool.destroy();
  });

  it("weighting processes all jobs (ordering TODO deterministic hook)", async () => {
    const pool = new ComfyPool(clients as any);
    await wait(5);
    const order: string[] = [];
    await Promise.all([
      pool.run(async (api: any) => { order.push("w10"); api.simulateExecutionSuccess(); }, 10),
      pool.run(async (api: any) => { order.push("w1"); api.simulateExecutionSuccess(); }, 1),
      pool.run(async (api: any) => { order.push("w5"); api.simulateExecutionSuccess(); }, 5)
    ]);
    expect(new Set(order)).toEqual(new Set(["w10","w1","w5"]));
    // TODO: expose internal job queue snapshot to assert stability ordering
    pool.destroy();
  });

  it("include and exclude filters select appropriate clients", async () => {
    const pool = new ComfyPool(clients as any);
    await wait(5);
    const used: string[] = [];
    await pool.run(async (api: any) => { used.push(api.id); api.simulateExecutionSuccess(); }, undefined, { includeIds: ["b"] });
    expect(used[0]).toBe("b");
    await pool.run(async (api: any) => { used.push(api.id); api.simulateExecutionSuccess(); }, undefined, { excludeIds: ["b"] });
    // Second run should not use b
    expect(used[1]).not.toBe("b");
    pool.destroy();
  });

  it("dynamic mode switching affects subsequent client selection", async () => {
    const pool = new ComfyPool(clients as any, EQueueMode.PICK_ZERO);
    await wait(5);
    let changeModeFired = false;
    pool.on("change_mode", () => { changeModeFired = true; });

    // Simulate varying queue depths BEFORE switching
    (pool.clients[0] as any).emitStatus(5); // a
    (pool.clients[1] as any).emitStatus(2); // b (lowest)
    (pool.clients[2] as any).emitStatus(7); // c

    // Switch to PICK_LOWEST
    pool.changeMode(EQueueMode.PICK_LOWEST);
    expect(changeModeFired).toBe(true);

    let picked = "";
    await pool.run(async (api: any) => { picked = api.id; api.simulateExecutionSuccess(); });
    expect(picked).toBe("b"); // lowest queue selected
    pool.destroy();
  });

  it("queue capacity limit rejects excess jobs", async () => {
    // Use maxQueueSize=0 to force immediate rejection on first enqueue
    const pool = new ComfyPool(clients as any, EQueueMode.PICK_ZERO, { maxQueueSize: 0 });
    await wait(5);
    let error: any = null;
    try {
      await pool.run(async () => { /* never runs */ });
    } catch (e) { error = e; }
    expect(error).toBeTruthy();
    expect(String(error)).toMatch(/Job queue limit reached/);
    pool.destroy();
  });

  it("claim timeout produces rejection", async () => {
    const pool = new ComfyPool(clients as any, EQueueMode.PICK_ZERO, { claimTimeoutMs: 50 });
    await wait(5);
    // Mark all clients as online but busy (locked & queueRemaining > 0)
  (pool as any).clientStates.forEach((s: any) => { s.online = true; s.queueRemaining = 1; s.locked = true; });
    let timedOut = false;
    try {
      await pool.run(async () => { /* unreachable */ }, undefined, undefined, { enableFailover: false });
    } catch (e) {
      timedOut = /Timeout/.test(String(e));
    }
    expect(timedOut).toBe(true);
    pool.destroy();
  });

  it("failover retries other clients on error", async () => {
  const pool = new ComfyPool(clients as any);
    await wait(5);
    let attempts: string[] = [];
    let first = true;
    await pool.run(async (api: any) => {
      attempts.push(api.id);
      if (first) { first = false; throw new Error("boom"); }
      api.simulateExecutionSuccess();
    }, undefined, undefined, { maxRetries: 3, retryDelay: 1 });
    expect(attempts.length).toBeGreaterThanOrEqual(2);
    expect(new Set(attempts).size).toBeGreaterThanOrEqual(2); // switched client
    pool.destroy();
  });

  it("failover exhaustion emits retries then final rejection", async () => {
    const two = clients.slice(0,2);
    const pool = new ComfyPool(two as any);
    await wait(5);
    const events: any[] = [];
    pool.on("execution_error", (ev: any) => events.push(ev.detail));
    let caught: any = null;
    try {
      await pool.run(async () => { throw new Error("always"); }, undefined, undefined, { maxRetries: 2, retryDelay: 2 });
    } catch (e) { caught = e; }
    expect(caught).toBeTruthy();
    // Expect exactly 2 attempts for 2 clients: first willRetry true, second false
    expect(events.length).toBe(2);
    expect(events[0].willRetry).toBe(true);
    expect(events[1].willRetry).toBe(false);
    expect(events[1].attempt).toBeGreaterThanOrEqual(events[0].attempt);
    pool.destroy();
  });

  it("execution_error payload wraps underlying detail", async () => {
    const pool = new ComfyPool(clients as any);
    await wait(5);
    let wrapped: any = null;
    pool.on("execution_error", (ev: any) => { wrapped = ev.detail.error; });
    // Force by running job that throws
    let caught: any = null;
    try {
      await pool.run(async () => { throw new Error("inner-problem"); }, undefined, undefined, { enableFailover: false });
    } catch (e) { caught = e; }
    expect(caught).toBeTruthy();
    expect(wrapped).toBeTruthy();
    // Provide minimal assertion on message consistency
    expect(String(caught)).toContain("inner-problem");
    pool.destroy();
  });

  it("have_job then idle ordering from status transitions", async () => {
    const pool = new ComfyPool(clients as any);
    await wait(5);
    const api: any = pool.clients[0];
    const sequence: string[] = [];
    pool.on("have_job", () => sequence.push("have_job"));
    pool.on("idle", () => sequence.push("idle"));
    api.emitStatus(3);
    api.emitStatus(0);
    expect(sequence[0]).toBe("have_job");
    expect(sequence[1]).toBe("idle");
    pool.destroy();
  });

  it("destroy is idempotent", async () => {
    const pool = new ComfyPool(clients as any);
    await wait(5);
    pool.destroy();
    // second call should not throw
    pool.destroy();
    expect(pool.clients.length).toBe(0);
  });

  it("round-robin long run fairness", async () => {
    const pool = new ComfyPool(clients as any, EQueueMode.PICK_ROUTINE);
    await wait(5);
    const counts: Record<string, number> = { a:0, b:0, c:0 };
    for (let i=0;i<30;i++) {
      await pool.run(async (api: any) => { counts[api.id]++; api.simulateExecutionSuccess(); });
    }
    const values = Object.values(counts);
    const max = Math.max(...values); const min = Math.min(...values);
    expect(max - min).toBeLessThanOrEqual(1);
    pool.destroy();
  });

  it("destroy clears clients and prevents further processing", async () => {
  const pool = new ComfyPool(clients as any);
    await wait(5);
    pool.destroy();
    expect(pool.clients.length).toBe(0);
  });
});
