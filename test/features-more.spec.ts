import { ComfyApi } from "../src/client";
import { EUpdateResult } from "../src/types/manager";

// Generic fetch sequencer
function seqFetch(responses: Array<Partial<Response> & { jsonBody?: any; textBody?: string }>) {
  let i = 0;
  // @ts-ignore
  global.fetch = async (url: string, init?: any) => {
    const spec = responses[Math.min(i, responses.length - 1)];
    i++;
    const ok = spec.ok ?? true;
    const status = spec.status ?? (ok ? 200 : 500);
    return {
      ok,
      status,
      headers: new Headers(),
      json: async () => spec.jsonBody ?? {},
      text: async () => spec.textBody ?? "stub",
      arrayBuffer: async () => new ArrayBuffer(1)
    } as unknown as Response;
  };
}

describe("Additional feature edge cases", () => {
  afterEach(() => { // @ts-ignore
    delete global.fetch; });

  test("manager update & install flows (status permutations)", async () => {
    seqFetch([
      { ok: true, textBody: "1.0.0" }, // getVersion for checkSupported
      { ok: true, status: 201 }, // checkExtensionUpdate -> UPDATE_AVAILABLE
      { ok: true, status: 200, jsonBody: { updated: 0, failed: 0 } }, // updateAllExtensions -> UNCHANGED
      { ok: true, status: 201, jsonBody: { updated: 1, failed: 0 } }, // updateAllExtensions -> SUCCESS
      { ok: true, status: 200 }, // updateComfyUI -> UNCHANGED
      { ok: true, status: 201 }, // updateComfyUI -> SUCCESS
      { ok: true }, // installExtension
      { ok: false, status: 500 } // uninstallExtension fail -> expect throw
    ]);
    const api: any = new ComfyApi("http://x");
    await api.ext.manager.checkSupported();
    const updCheck = await api.ext.manager.checkExtensionUpdate();
    expect(updCheck).toBeDefined();
    const upAll1 = await api.ext.manager.updateAllExtensions();
    // When status=200 we expect UNCHANGED result shape { type: EUpdateResult.UNCHANGED }
    expect((upAll1 as any).type).toBe(EUpdateResult.UNCHANGED);
    const upAll2 = await api.ext.manager.updateAllExtensions();
    expect((upAll2 as any).type).toBe(EUpdateResult.SUCCESS);
    const ui1 = await api.ext.manager.updateComfyUI();
    expect(ui1).toBe(EUpdateResult.UNCHANGED);
    const ui2 = await api.ext.manager.updateComfyUI();
    expect(ui2).toBe(EUpdateResult.SUCCESS);
    const installed = await api.ext.manager.installExtension({} as any);
    expect(installed).toBe(true);
    await expect(api.ext.manager.uninstallExtension({} as any)).rejects.toThrow(/Failed/);
  });

  test("monitoring positive event dispatch updates resources", () => {
    const api: any = new ComfyApi("http://x");
    api.ext.monitor.supported = true;
    // Manually invoke internal bind by simulating checkSupported success
    (api.ext.monitor as any)["bind"]?.();
    const payload = { cpu_utilization: 10, ram_total: 1, ram_used: 0.5, ram_used_percent: 50, hdd_total: 1, hdd_used: 0.2, hdd_used_percent: 20, device_type: "cuda", gpus: [] };
    api.dispatchEvent(new CustomEvent("all", { detail: { type: "crystools.monitor", data: payload } }));
    expect(api.ext.monitor.monitorData).toEqual(payload);
  });

  test("file feature: uploadImage fail & success mapping", async () => {
    seqFetch([
      { ok: false, status: 500, jsonBody: { name: "bad" } },
      { ok: true, status: 200, jsonBody: { name: "good", type: "output", subfolder: "", size: 123 } }
    ]);
    const api = new ComfyApi("http://x");
    const f = new Blob([new Uint8Array([1,2,3])]);
    const failed = await api.ext.file.uploadImage(f, "a.png");
    expect(failed).toBe(false);
    const success = await api.ext.file.uploadImage(f, "b.png");
    expect(success && success.info.filename).toBe("good");
  });

  test("file feature: storeUserData error throw & list fallback", async () => {
    seqFetch([
      { ok: true, status: 500 }, // storeUserData -> throw
      { ok: true, status: 404 }, // listUserData -> returns []
      { ok: true, status: 200, jsonBody: ["one.txt"] } // listUserData success
    ]);
    const api = new ComfyApi("http://x");
    await expect(api.ext.file.storeUserData("one.txt", { a: 1 })).rejects.toThrow(/Error storing/);
    const empty = await api.ext.file.listUserData("/tmp");
    expect(empty).toEqual([]);
    const list = await api.ext.file.listUserData("/tmp");
    expect(list).toContain("one.txt");
  });

  test("user feature createUser error path", async () => {
    seqFetch([{ ok: false, status: 400 }]);
    const api = new ComfyApi("http://x");
    const res = await api.ext.user.createUser("bob");
    expect(res.status).toBe(400);
  });

  test("system feature freeMemory failure path", async () => {
    seqFetch([{ ok: false, status: 500 }]);
    const api = new ComfyApi("http://x");
    const ok = await api.ext.system.freeMemory(true, true);
    expect(ok).toBe(false);
  });
});
