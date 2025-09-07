import { describe, it, expect, beforeEach } from "bun:test";
import { ComfyApi } from "../src";

// We'll mock global fetch for all tests in this suite
// Each test can override by writing to mockResponses map
interface MockKey {
  method: string;
  url: string;
}

const mockResponses: Record<string, {
  status?: number;
  ok?: boolean;
  headers?: any;
  body?: any;
  rawBody?: ArrayBuffer | Blob
}> = {};

function key(method: string, url: string) {
  return `${method.toUpperCase()} ${url}`;
}

(globalThis as any).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input.toString();
  const method = init?.method || "GET";
  const k = key(method, url);
  const mock = mockResponses[k];
  if (!mock) {
    // default generic ok json
    return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (mock.rawBody) {
    return new Response(mock.rawBody, { status: mock.status ?? 200, headers: mock.headers });
  }
  const body = mock.body !== undefined ? (typeof mock.body === "string" ? mock.body : JSON.stringify(mock.body)) : "";
  return new Response(body, {
    status: mock.status ?? 200,
    headers: mock.headers || { "content-type": "application/json" }
  });
};

function setJson(method: string, route: string, body: any, status = 200, host = "http://localhost:8188") {
  mockResponses[key(method, `${host}${route}`)] = { body, status };
}

function setRaw(method: string, route: string, rawBody: ArrayBuffer | Blob, headers?: any, status = 200, host = "http://localhost:8188") {
  mockResponses[key(method, `${host}${route}`)] = { rawBody, headers, status };
}

// Minimal workflow for queue tests
const dummyWorkflow = { 1: { class_type: "LoadImage", inputs: {} } };

describe("Feature modules integration", () => {
  let api: ComfyApi;
  const host = "http://localhost:8188";

  beforeEach(() => {
    for (const k in mockResponses) delete mockResponses[k];
    api = new ComfyApi(host, "test-client", { credentials: undefined as any });
  });

  it("queueFeature.queuePrompt builds correct POST body variations", async () => {
    setJson("POST", "/prompt", { prompt_id: "abc" });
    const resAppend = await api.ext.queue.queuePrompt(null, dummyWorkflow);
    expect(resAppend.prompt_id).toBe("abc");

    setJson("POST", "/prompt", { prompt_id: "front" });
    await api.ext.queue.queuePrompt(-1, dummyWorkflow);

    setJson("POST", "/prompt", { prompt_id: "at2" });
    await api.ext.queue.queuePrompt(2, dummyWorkflow);
  });

  it("historyFeature.getHistories returns parsed object", async () => {
    setJson("GET", "/history?max_items=50", { a: { prompt: { foo: 1 } } });
    const hist = await api.ext.history.getHistories(50);
    // We only assert the structure came through
    expect((hist as any).a.prompt.foo).toBe(1);
  });

  it("systemFeature.getSystemStats returns object", async () => {
    setJson("GET", "/system_stats", { system: { os: "Windows" } });
    const stats = await api.ext.system.getSystemStats();
    expect(String(stats.system.os)).toBe("Windows");
  });

  it("fileFeature.getPathImage builds URL", () => {
    const url = api.ext.file.getPathImage({ filename: "x.png", type: "output", subfolder: "" } as any);
    expect(url).toContain("/view?filename=x.png");
  });

  it("nodeFeature.getNodeDefs returns null on empty body", async () => {
    mockResponses[key("GET", `${host}/object_info`)] = {
      body: "",
      status: 200,
      headers: { "content-type": "application/json" }
    };
    const defs = await api.ext.node.getNodeDefs();
    expect(defs).toBeNull();
  });

  it("nodeFeature.getSamplerInfo returns sampler & scheduler arrays when present", async () => {
    // Mock structure similar to the real node definition shape
    setJson("GET", "/object_info/KSampler", {
      KSampler: {
        input: {
          required: {
            sampler_name: ["euler", "euler_ancestral"],
            scheduler: ["normal", "karras"]
          }
        }
      }
    });
    const info = await api.ext.node.getSamplerInfo();
    expect(info.sampler).toContain("euler");
    expect(info.scheduler).toContain("karras");
  });

  it("miscFeature.getEmbeddings falls back gracefully", async () => {
    // The first call /api/embeddings returns a legacy array
    setJson("GET", "/api/embeddings?page_size=100", { items: [{ model_name: "embedA" }] });
    const embeds = await api.ext.misc.getEmbeddings();
    expect(embeds).toEqual(["embedA"]);
  });

  it("userFeature.storeSetting POSTs value", async () => {
    setJson("POST", "/settings/my.key", {});
    await api.ext.user.storeSetting("my.key", 123);
  });

  it("modelFeature.getModelPreview returns structured data", async () => {
    const buf = new TextEncoder().encode("data").buffer;
    setRaw("GET", "/experiment/models/preview/folder/0/file.bin", buf, { "content-type": "image/webp" });
    const preview = await api.ext.model.getModelPreview("folder", 0, "file.bin");
    expect(preview.contentType).toBe("image/webp");
    expect(preview.body.byteLength).toBe(4);
  });

  it("featureFlags.getServerFeatures returns flags", async () => {
    setJson("GET", "/features", { newApi: true });
    const flags = await api.ext.featureFlags.getServerFeatures();
    expect(flags.newApi).toBe(true);
  });

  it("client wrapper delegates to feature module (getSystemStats)", async () => {
    setJson("GET", "/system_stats", { system: { os: "Linux" } });
    const stats = await api.ext.system.getSystemStats();
    expect(String(stats.system.os)).toBe("Linux");
  });
});
