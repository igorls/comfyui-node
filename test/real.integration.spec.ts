/**
 * Real-world integration smoke test against a locally running ComfyUI instance.
 *
 * By default this spec SKIPS all tests unless the environment variable COMFY_REAL=1
 * is provided. This prevents accidental network dependency during normal unit runs.
 *
 * Usage:
 *   COMFY_REAL=1 bun test ./test/real.integration.spec.ts
 *   # Optional override of host:
 *   COMFY_REAL=1 COMFY_HOST=http://localhost:8189 bun test ./test/real.integration.spec.ts
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { ComfyApi } from "../src/client";

const enabled = process.env.COMFY_REAL === "1";
const host = process.env.COMFY_HOST || "http://localhost:8188";

function skipNote(msg: string) {
  // Provide a single skipped test so runner output shows intent.
  it.skip(msg, () => {});
}

// Basic guard: don't even construct if not enabled.
if (!enabled) {
  describe("Real ComfyUI integration (skipped)", () => {
    skipNote("Set COMFY_REAL=1 to enable real server tests.");
  });
} else {
  describe("Real ComfyUI integration", () => {
    let api: ComfyApi;
    // Initialize once before tests
    beforeAll(async () => {
      api = await new ComfyApi(host).init();
    });

    it("is initialized & ready", async () => {
      await api.waitForReady();
      expect(api.isReady).toBe(true);
    });

    it("fetches system stats", async () => {
      const stats = await api.ext.system.getSystemStats();
      expect(stats).toBeTruthy();
      expect(stats.system || stats.devices).toBeDefined();
    });

    it("retrieves node definitions subset", async () => {
      const defs = await api.ext.node.getNodeDefs();
      // Real server returns an object keyed by node type names.
      expect(defs && typeof defs).toBe("object");
    });

    it("lists checkpoints (if extension present)", async () => {
      try {
        const cps = await api.ext.node.getCheckpoints();
        expect(Array.isArray(cps)).toBe(true);
      } catch (e) {
        // Some instances may not expose model listing endpoints; allow.
        expect(e).toBeInstanceOf(Error);
      }
    });

    it("returns embeddings list (new or legacy)", async () => {
      const emb = await api.ext.misc.getEmbeddings();
      expect(Array.isArray(emb)).toBe(true);
    });

    it("reports feature flags (if supported)", async () => {
      try {
        const flags = await api.ext.featureFlags.getServerFeatures();
        expect(flags && typeof flags).toBe("object");
      } catch (e) {
        // Older servers may not have /features endpoint.
        expect(e).toBeInstanceOf(Error);
      }
    });
  });
}
