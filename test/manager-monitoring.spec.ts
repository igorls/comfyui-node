import { ComfyApi } from "../src/client";

function mockFetch(sequence: Array<Partial<Response> & { jsonBody?: any; textBody?: string }>) {
  let i = 0;
  // @ts-ignore
  global.fetch = async (url: string) => {
    const spec = sequence[Math.min(i, sequence.length - 1)];
    i++;
    if (!spec) throw new Error("No mock response");
    const ok = spec.ok ?? true;
    const status = spec.status ?? (ok ? 200 : 500);
    return {
      ok,
      status,
      json: async () => spec.jsonBody ?? {},
      text: async () => spec.textBody ?? "version",
      headers: new Headers()
    } as unknown as Response;
  };
}

describe("Manager & Monitoring feature basic coverage", () => {
  afterEach(() => {
    // @ts-ignore
    delete global.fetch;
  });

  test("manager checkSupported succeeds then getNodeMapList transforms", async () => {
    mockFetch([
      { ok: true, textBody: "1.0.0" }, // version
      { ok: true, jsonBody: { "http://repo": [["NodeA", "NodeB"], { title_aux: "TA", title: "T", author: "Au", nickname: "Nick", description: "Desc" }] } }
    ]);
    const api: any = new ComfyApi("http://x");
    const supported = await api.ext.manager.checkSupported();
    expect(supported).toBe(true);
    const list = await api.ext.manager.getNodeMapList();
    expect(list[0].nodeNames).toContain("NodeA");
  });

  test("monitoring unsupported returns false/null", async () => {
    const api: any = new ComfyApi("http://x");
    // Force unsupported (no node defs)
    api.ext.monitor.supported = false;
    expect(await api.ext.monitor.switch(true)).toBe(false);
    expect(await api.ext.monitor.getHddList()).toBeNull();
    expect(await api.ext.monitor.getGpuList()).toBeNull();
  });
});
