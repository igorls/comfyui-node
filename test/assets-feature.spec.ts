import { describe, expect, it, mock } from "bun:test";
import { AssetsFeature } from "../src/features/assets.js";

describe("AssetsFeature", () => {
  const createMockClient = (fetchResponse: any) => {
    const mockFetch = mock(async () => fetchResponse);
    return {
      fetchApi: mockFetch,
      id: "test-client",
      apiHost: "http://localhost:8188"
    } as any;
  };

  it("checks support via /api/assets", async () => {
    const client = createMockClient({ ok: true });
    const feature = new AssetsFeature(client);

    await expect(feature.checkSupported()).resolves.toBe(true);
    expect(client.fetchApi).toHaveBeenCalledWith("/api/assets?limit=1");
  });

  it("builds list query params", async () => {
    const client = createMockClient({
      ok: true,
      json: async () => ({ assets: [], total: 0, has_more: false })
    });
    const feature = new AssetsFeature(client);

    await feature.listAssets({
      include_tags: ["output", "image"],
      exclude_tags: ["temp"],
      metadata_filter: { width: 1024 },
      limit: 20,
      offset: 40,
      cursor: "next",
      sort: "updated_at",
      order: "asc",
      include_public: false
    });

    const calledUrl = client.fetchApi.mock.calls[0][0];
    expect(calledUrl).toContain("/api/assets?");
    expect(calledUrl).toContain("include_tags=output%2Cimage");
    expect(calledUrl).toContain("exclude_tags=temp");
    expect(calledUrl).toContain("metadata_filter=%7B%22width%22%3A1024%7D");
    expect(calledUrl).toContain("limit=20");
    expect(calledUrl).toContain("offset=40");
    expect(calledUrl).toContain("cursor=next");
    expect(calledUrl).toContain("sort=updated_at");
    expect(calledUrl).toContain("order=asc");
    expect(calledUrl).toContain("include_public=false");
  });

  it("returns null for missing asset details", async () => {
    const client = createMockClient({
      ok: false,
      status: 404,
      json: async () => ({ error: "Asset not found" })
    });
    const feature = new AssetsFeature(client);

    await expect(feature.getAsset("missing")).resolves.toBeNull();
  });

  it("uploads assets with metadata form data", async () => {
    const client = createMockClient({
      ok: true,
      json: async () => ({
        id: "asset-1",
        name: "image.png",
        size: 4,
        created_at: "2026-06-20T00:00:00Z",
        updated_at: "2026-06-20T00:00:00Z",
        created_new: true
      })
    });
    const feature = new AssetsFeature(client);

    const result = await feature.uploadAsset(new Blob(["data"], { type: "image/png" }), "image.png", {
      tags: ["input"],
      user_metadata: { source: "test" }
    });
    const [url, options] = client.fetchApi.mock.calls[0];

    expect(url).toBe("/api/assets");
    expect(options.method).toBe("POST");
    expect(options.body).toBeInstanceOf(FormData);
    expect(result.created_new).toBe(true);
  });
});
