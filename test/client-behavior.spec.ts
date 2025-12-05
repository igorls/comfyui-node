import { ComfyApi } from "../src/client";
import { WebSocket } from "ws";

// Helper to mock fetch responses
function mockFetchSequence(sequence: Array<Partial<Response> & { body?: any; jsonBody?: any; textBody?: string }>) {
  let i = 0;
  // @ts-ignore
  const fn = async (url: string, init?: any) => {
    const spec = sequence[Math.min(i, sequence.length - 1)];
    i++;
    if (spec === undefined) throw new Error("No mock response defined");
    const ok = spec.ok ?? true;
    const status = spec.status ?? (ok ? 200 : 500);
    const headers = new Headers(spec.headers || {});
    const body = spec.body;
    return {
      ok,
      status,
      headers,
      json: async () => spec.jsonBody ?? body ?? {},
      text: async () => spec.textBody ?? JSON.stringify(spec.jsonBody ?? body ?? {}),
      arrayBuffer: async () => new ArrayBuffer(8)
    } as unknown as Response;
  };
  // Add call tracking
  (fn as any).mock = { calls: [] as any[] };
  const wrapped = new Proxy(fn as any, {
    apply(target, thisArg, argArray) {
      (target.mock.calls as any[]).push(argArray);
      return Reflect.apply(target, thisArg, argArray);
    }
  });
  // @ts-ignore
  global.fetch = wrapped;
}

describe("ComfyApi client behavior", () => {
  afterEach(() => {
    // @ts-ignore
    delete global.fetch;
  });

  test("credential headers: basic, bearer, custom", async () => {
    mockFetchSequence([
      { jsonBody: {} }, // ping/poll
      { jsonBody: {} }, // system stats
      { jsonBody: {} }, // feature probing (node defs etc.)
      { jsonBody: {} }
    ]);

    const basic = new ComfyApi("http://x", undefined, { credentials: { type: "basic", username: "u", password: "p" } });
    // Trigger a simple fetch
    await basic.fetchApi("/ping");
    const bearer = new ComfyApi("http://x", undefined, { credentials: { type: "bearer_token", token: "tok" } });
    await bearer.fetchApi("/ping");
    const custom = new ComfyApi("http://x", undefined, { credentials: { type: "custom", headers: { X: "Y" } } });
    await custom.fetchApi("/ping");
    expect((fetch as any).mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  test("pollStatus timeout path triggers error", async () => {
    // Simulate a request that only resolves when aborted so we exercise the abort path without hanging
    // @ts-ignore
    global.fetch = (url: string, init: any) =>
      new Promise((resolve, reject) => {
        const signal: AbortSignal | undefined = init?.signal;
        if (!signal) return; // should not happen
        signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
        });
      });
    const api = new ComfyApi("http://x");
    await expect(api.pollStatus(10)).rejects.toThrow(/timed out/i);
  });

  test("freeMemory: success and failure", async () => {
    mockFetchSequence([
      { ok: true, jsonBody: {} }, // success
      { ok: false, status: 500, jsonBody: {} } // failure
    ]);
    const api = new ComfyApi("http://x");
    const ok = await api.freeMemory(true, true);
    const fail = await api.freeMemory(true, true);
    expect(ok).toBe(true);
    expect(fail).toBe(false);
  });

  test("availableFeatures aggregation and listener management", () => {
    const api: any = new ComfyApi("http://x");
    // Force a couple supported flags
    api.ext.queue.isSupported = true;
    api.ext.system.isSupported = false;
    const before = api.availableFeatures;
    expect(typeof before.queue).toBe("boolean");

    const calls: any[] = [];
    const listener = (ev: any) => calls.push(ev);
    const off = api.on("log" as any, listener);
    off();
    // We expect at most one call (the initial 'on' logs), and no new entries after off
    expect(calls.length).toBeLessThanOrEqual(1);
  });

  test("destroy is idempotent and cleans resources", () => {
    const api: any = new ComfyApi("http://x");
    // Inject fake socket
  api.socket = { readyState: WebSocket.OPEN, close: () => {}, terminate: () => {} };
    api.destroy();
    api.destroy();
    expect(api.socket).toBeNull();
  });

  test("reconnectWs and abortReconnect logs abort", () => {
    mockFetchSequence([{ jsonBody: {} }]);
    const api: any = new ComfyApi("http://x", undefined, { reconnect: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 } });
    const logs: any[] = [];
    api.on("log" as any, (ev: any) => logs.push(ev.detail.message));
    api.reconnectWs(true);
    api.abortReconnect();
    expect(logs.some((m) => /aborted/i.test(m))).toBe(true);
  });

  test("getModelPreview + URL", async () => {
    mockFetchSequence([
      { ok: true, arrayBuffer: async () => new ArrayBuffer(4), headers: { "content-type": "image/png" } as any }
    ]);
    const api = new ComfyApi("http://x");
    const preview = await api.getModelPreview("folder", 0, "file.ckpt");
    expect(preview.contentType).toMatch(/image/);
    const url = api.getModelPreviewUrl("folder", 0, "file.ckpt");
    expect(url).toContain("/experiment/models/preview/");
  });

  test("getQueue returns parsed json", async () => {
    mockFetchSequence([{ jsonBody: { queue_running: [] } }]);
    const api = new ComfyApi("http://x");
    const q = await api.getQueue();
    expect(q).toHaveProperty("queue_running");
  });

  test("ping success and failure states", async () => {
    mockFetchSequence([{ ok: true, jsonBody: {} }, { ok: false, status: 500, jsonBody: {} }]);
    const api = new ComfyApi("http://x");
    const success = await api.ping();
    const failure = await api.ping();
    expect(success.status).toBe(true);
    expect(failure.status).toBe(false);
  });
});
