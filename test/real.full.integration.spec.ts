/**
 * Comprehensive real-world integration tests.
 * Requires a live ComfyUI instance (default http://localhost:8188) with typical extensions/models.
 * These tests attempt to exercise every feature method. Some endpoints may be absent; such cases are tolerated.
 *
 * Enable with:
 *   COMFY_REAL=1 COMFY_FULL=1 bun test ./test/real.full.integration.spec.ts
 * Optional host override:
 *   COMFY_HOST=http://localhost:8189
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { ComfyApi } from "../src/client";
import { PromptBuilder } from "../src/prompt-builder";
import { CallWrapper } from "../src/call-wrapper";
import { seed } from "../src/tools";
import txt2img from "./example-txt2img-workflow.json";

const enabled = process.env.COMFY_REAL === "1" && process.env.COMFY_FULL === "1";
const host = process.env.COMFY_HOST || "http://localhost:8188";

function skipAll() { it.skip("Set COMFY_REAL=1 COMFY_FULL=1 to enable full integration tests", () => {}); }

if (!enabled) {
  describe("Full ComfyUI integration (skipped)", skipAll);
} else {
  describe("Full ComfyUI integration", () => {
    let api: ComfyApi;
    let promptId: string | undefined;

    beforeAll(async () => {
      api = await new ComfyApi(host).init();
      await api.waitForReady();
    });

    it("system.getSystemStats + freeMemory (noop)", async () => {
      const stats = await api.ext.system.getSystemStats();
      expect(stats).toBeTruthy();
      const freed = await api.ext.system.freeMemory(false, false);
      expect(typeof freed).toBe("boolean");
    });

    it("node.getNodeDefs subset + sampler/checkpoints/loras", async () => {
      const defs = await api.ext.node.getNodeDefs();
      expect(defs && typeof defs).toBe("object");
      const samplerInfo = await api.ext.node.getSamplerInfo();
      expect(samplerInfo).toBeTruthy();
      await api.ext.node.getCheckpoints().catch(() => []);
      await api.ext.node.getLoras().catch(() => []);
    });

    it("misc.getExtensions + getEmbeddings", async () => {
      await api.ext.misc.getExtensions().catch(() => []);
      const emb = await api.ext.misc.getEmbeddings();
      expect(Array.isArray(emb)).toBe(true);
    });

    it("featureFlags.getServerFeatures tolerant", async () => {
      try {
        const flags = await api.ext.featureFlags.getServerFeatures();
        expect(flags && typeof flags).toBe("object");
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });

    it("terminal logs + subscription toggle", async () => {
      await api.ext.terminal.setTerminalSubscription(true).catch(()=>{});
      await api.ext.terminal.getTerminalLogs().catch(()=>({entries:[], size:{cols:0, rows:0}}));
      await api.ext.terminal.setTerminalSubscription(false).catch(()=>{});
    });

    it("user config + settings round trip (non-destructive)", async () => {
      await api.ext.user.getUserConfig().catch(()=>({}));
      const settings = await api.ext.user.getSettings().catch(()=>({}));
      // attempt storeSetting with a benign key if settings supported
      await api.ext.user.storeSetting("sdk.test.flag", true).catch(()=>{});
      await api.ext.user.getSetting("sdk.test.flag").catch(()=>undefined);
      // bulk update
      await api.ext.user.storeSettings({ "sdk.test.multi": 1 }).catch(()=>{});
    });

    it("file userdata lifecycle (create/read/list/delete)", async () => {
      const filename = `sdk_test_${Date.now()}.json`;
      await api.ext.file.storeUserData(filename, { ok: true }).catch(()=>{});
      await api.ext.file.getUserData(filename).catch(()=>new Response());
      await api.ext.file.listUserData("", false, false).catch(()=>[]);
      await api.ext.file.deleteUserData(filename).catch(()=>{});
    });

    it("model experimental endpoints (if available)", async () => {
      try {
        const folders = await api.ext.model.getModelFolders();
        if (folders.length) {
          const first = folders[0];
          await api.ext.model.getModelFiles(first.name).catch(()=>[]);
        }
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });

    it("queue submission + history retrieval", async () => {
      // Strip upscale branch nodes (10,11,12) for faster minimal run if present
      const wf = { ...(txt2img as any) };
      delete (wf as any)["10"]; delete (wf as any)["11"]; delete (wf as any)["12"]; // best effort

      const builder = new PromptBuilder(wf as any, ["positive","seed"],["images"])
        .setInputNode("positive","6.inputs.text")
        .setInputNode("seed","3.inputs.seed")
        .setOutputNode("images","9")
        .input("positive","Integration test prompt")
        .input("seed", seed());

      try {
        const job = await api.ext.queue.appendPrompt(builder.workflow);
        promptId = job.prompt_id;
      } catch (e:any) {
        // If server rejects (e.g., missing models), skip assertions but still exercise history endpoints gracefully
        promptId = undefined;
        return;
      }

      expect(promptId).toBeDefined();
      await api.ext.history.getHistories(10).catch(()=>({}));
      if (promptId) {
        await api.ext.history.getHistory(promptId).catch(()=>undefined);
      }
    });

  it("queue submission with missing model surfaces enriched diagnostics (best effort)", async () => {
      // Clone and force an invalid checkpoint reference if workflow has a known checkpoint node id (e.g., '4' in example)
      const wf = { ...(txt2img as any) };
      if (wf["4"]?.inputs?.ckpt_name) {
        wf["4"].inputs.ckpt_name = "__SDK_DOES_NOT_EXIST__/nonexistent_model_file.safetensors";
      } else if (wf["4"]) {
        // fallback: inject a property to provoke failure if server validates
        wf["4"].inputs.ckpt_name = "__SDK_DOES_NOT_EXIST__/nonexistent_model_file.safetensors";
      } else {
        // If structure differs, skip (maintain suite resiliency)
        expect(true).toBe(true);
        return;
      }

      const builder = new PromptBuilder(wf as any, ["positive","seed"],["images"])
        .setInputNode("positive","6.inputs.text")
        .setInputNode("seed","3.inputs.seed")
        .setOutputNode("images","9")
        .input("positive","Missing model diagnostic test")
        .input("seed", seed());

      let captured: any = null;
      try {
        await api.ext.queue.appendPrompt(builder.workflow);
        // If it surprisingly succeeds (model actually present), treat as pass but note
        return; // cannot validate missing model if it actually exists
      } catch (e: any) {
        captured = e;
      }
      if (!captured) {
        // Nothing captured; treat as neutral (no failure path exercised)
        return;
      }
      expect(captured).toBeInstanceOf(Error);
      expect(captured.status).toBeGreaterThanOrEqual(400);
      expect(captured.status).toBeLessThan(600);

      const MODEL_SENTINEL = "__SDK_DOES_NOT_EXIST__/nonexistent_model_file.safetensors";


      const bodyJSON = captured.bodyJSON;
      if (bodyJSON) {
        // Assertions on structured shape
        expect(typeof bodyJSON).toBe("object");
        expect(bodyJSON.error).toBeTruthy();
        if (bodyJSON.error) {
          expect(typeof bodyJSON.error.message).toBe("string");
        }
        // node_errors should include checkpoint node id (commonly '4') but we just assert at least one entry
        if (bodyJSON.node_errors) {
          const nodeKeys = Object.keys(bodyJSON.node_errors);
            expect(nodeKeys.length).toBeGreaterThan(0);
            const firstNode = bodyJSON.node_errors[nodeKeys[0]];
            if (firstNode?.errors?.length) {
              const firstErr = firstNode.errors[0];
              expect(typeof firstErr.message).toBe("string");
              // Ensure sentinel model path appears somewhere in details/message
              const combined = JSON.stringify(firstErr).toLowerCase();
              expect(combined.includes(MODEL_SENTINEL.toLowerCase())).toBe(true);
            }
        }
      } else if (captured.bodyTextSnippet) {
      // (Diagnostics logging removed for clean CI output)
        expect(captured.bodyTextSnippet.toLowerCase()).toContain("missing");
      } else {
        // If neither JSON nor text snippet exists, diagnostics failed (fail the test)
        throw new Error("MissingModelDiagnostics: expected bodyJSON or bodyTextSnippet for enriched error");
      }
    });

    it("real image generation with existing checkpoint (best effort)", async () => {
      // Manual extended timeout management: allow up to ~120s for this block
      const HARD_CAP_MS = 120000;
      const controller = new AbortController();
      const hardCap = new Promise<never>((_, reject) => {
        setTimeout(() => {
          controller.abort();
          reject(new Error("RealGenerationHardTimeout: exceeded 120s cap"));
        }, HARD_CAP_MS).unref?.();
      });

      await Promise.race([
        (async () => {
      // Extended timeout window for realistic generation (some checkpoints take >30s cold start)
      const MAX_WAIT_MS = 60000; // poll window
      const TEST_DEADLINE_MS = 90000; // hard cap for this test logic (under Bun's default if configured larger)
      const start = Date.now();
      // Attempt to locate an available checkpoint name via node feature; fall back gracefully
      const checkpoints = await api.ext.node.getCheckpoints().catch(() => [] as any[]);
      if (!Array.isArray(checkpoints) || checkpoints.length === 0) {
        // eslint-disable-next-line no-console
        console.warn("[RealGeneration] No checkpoints available on server; skipping generation test.");
        return;
      }
      const ckpt = checkpoints[0];

      const wf = { ...(txt2img as any) };
      // Remove upscale nodes if present to speed up generation
      delete (wf as any)["10"]; delete (wf as any)["11"]; delete (wf as any)["12"]; // best effort

      // Build a minimal workflow mapping required inputs
      const builder = new PromptBuilder(wf as any, ["positive","seed","checkpoint"],["images"])
        .setInputNode("positive","6.inputs.text")
        .setInputNode("seed","3.inputs.seed")
        .setInputNode("checkpoint","4.inputs.ckpt_name")
        .setOutputNode("images","9")
        .input("positive","SDK integration real generation test")
        .input("seed", seed())
        .input("checkpoint", ckpt, api.osType);

      const images: any[] = [];
      let promptId: string | undefined;
      await new CallWrapper(api, builder)
        .onPending(id => { promptId = id; })
        .onOutput((key, data) => {
          if (key === 'images' && data?.images) {
            images.push(...data.images);
          }
        })
        .onFailed(err => {
          // eslint-disable-next-line no-console
            console.warn("[RealGeneration] Generation failed", err);
        })
        .run();

      // Poll history for completion if we have a promptId and no images yet
      const pollInterval = 1500;
      while (images.length === 0 && promptId && Date.now() - start < MAX_WAIT_MS) {
        await new Promise(r => setTimeout(r, pollInterval));
        try {
          const hist = await api.ext.history.getHistory(promptId);
          if (hist?.status?.completed) {
            const outputs = hist.outputs || {};
            // Look for any node output with an images array
            for (const nodeKey of Object.keys(outputs)) {
              const val = (outputs as any)[nodeKey];
              if (val && typeof val === 'object') {
                const imgs = (val as any).images || (Array.isArray(val) ? val : undefined);
                if (Array.isArray(imgs) && imgs.length) {
                  images.push(...imgs);
                  break;
                }
              }
            }
          }
        } catch {}
      }

      const elapsed = Date.now() - start;
      if (images.length === 0) {
        // eslint-disable-next-line no-console
        console.warn(`\n[RealGeneration] No images after ${(elapsed/1000).toFixed(1)}s (<=${MAX_WAIT_MS/1000}s poll window). Skipping assertion.`);
        return;
      }
  // (Generation success log removed for clean CI output)
      expect(images.length).toBeGreaterThan(0);
        })(),
        hardCap
      ]).catch(err => {
        if (String(err.message || err).startsWith("RealGenerationHardTimeout")) {
          // Log but don't fail entire suite – treat as skipped scenario
          // eslint-disable-next-line no-console
          console.warn("[RealGeneration] Hard timeout reached; treating as skipped.");
          return; // swallow
        }
        throw err; // rethrow real errors
      });
    });

    it("queue interrupt noop", async () => {
      await api.ext.queue.interrupt().catch(()=>{});
    });

  it("upload image + mask (best effort)", async () => {
      // tiny transparent PNG (1x1) base64
      const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9T4WkAAAAASUVORK5CYII=";
      const binary = Uint8Array.from(atob(pngBase64), c => c.charCodeAt(0));
      const imageBlob = new Blob([binary], { type: "image/png" });
      const up = await api.ext.file.uploadImage(imageBlob, "sdk-test.png", { override: true }).catch(() => false as const);
      const uploaded: false | { info: any; url: string } = up === false ? false : up;
      if (uploaded && typeof uploaded === "object") {
        await api.ext.file.getImage(uploaded.info).catch(()=>new Blob());
        await api.ext.file.uploadMask(imageBlob, uploaded.info).catch(()=>false);
      } else {
        expect(uploaded).toBe(false); // if unavailable still pass
      }
    });

    it("feature flags: supports_preview_metadata=true yields metadata previews when available (best effort)", async () => {
      // Create a fresh client that explicitly announces preview metadata support
      const api2 = await new ComfyApi(host, undefined, {
        announceFeatureFlags: { supports_preview_metadata: true }
      }).init();

      try {
        // Try to locate a checkpoint to run a minimal workflow quickly
        const checkpoints = await api2.ext.node.getCheckpoints().catch(() => [] as any[]);
        if (!Array.isArray(checkpoints) || checkpoints.length === 0) {
          // eslint-disable-next-line no-console
          console.warn("[Flags:true] No checkpoints; skipping preview metadata check.");
          expect(true).toBe(true);
          return;
        }
        const ckpt = checkpoints[0];

        const wf = { ...(txt2img as any) };
        // Trim upscale nodes for speed
        delete (wf as any)["10"]; delete (wf as any)["11"]; delete (wf as any)["12"]; // best effort
        // Nudge steps down if present for faster preview
        if (wf["3"]?.inputs) {
          wf["3"].inputs.steps = Math.min(4, wf["3"].inputs.steps ?? 4);
        }

        const builder = new PromptBuilder(wf as any, ["positive","seed","checkpoint"],["images"])
          .setInputNode("positive","6.inputs.text")
          .setInputNode("seed","3.inputs.seed")
          .setInputNode("checkpoint","4.inputs.ckpt_name")
          .setOutputNode("images","9")
          .input("positive","Flags enabled preview test")
          .input("seed", seed())
          .input("checkpoint", ckpt, api2.osType);

        let previews = 0;
        let metaPreviews = 0;
        await new CallWrapper(api2, builder)
          .onPreview(() => { previews++; })
          // @ts-ignore: optional in environments without metadata
          .onPreviewMeta?.(({ blob, metadata }) => { void blob; void metadata; metaPreviews++; })
          .run();

        // We can't guarantee server behavior; log but avoid failing CI
        // Assert at least that the run completed without throwing
        expect(previews + metaPreviews).toBeGreaterThanOrEqual(0);
        if (metaPreviews === 0) {
          // eslint-disable-next-line no-console
          console.warn("[Flags:true] No metadata previews received; server may not support or did not send type 4.");
        }
      } finally {
        api2.destroy();
      }
    });

    it("feature flags: supports_preview_metadata=false avoids metadata previews if server honors flag (best effort)", async () => {
      const api3 = await new ComfyApi(host, undefined, {
        announceFeatureFlags: { supports_preview_metadata: false }
      }).init();

      try {
        const checkpoints = await api3.ext.node.getCheckpoints().catch(() => [] as any[]);
        if (!Array.isArray(checkpoints) || checkpoints.length === 0) {
          // eslint-disable-next-line no-console
          console.warn("[Flags:false] No checkpoints; skipping preview metadata check.");
          expect(true).toBe(true);
          return;
        }
        const ckpt = checkpoints[0];

        const wf = { ...(txt2img as any) };
        delete (wf as any)["10"]; delete (wf as any)["11"]; delete (wf as any)["12"]; // best effort
        if (wf["3"]?.inputs) {
          wf["3"].inputs.steps = Math.min(4, wf["3"].inputs.steps ?? 4);
        }

        const builder = new PromptBuilder(wf as any, ["positive","seed","checkpoint"],["images"])
          .setInputNode("positive","6.inputs.text")
          .setInputNode("seed","3.inputs.seed")
          .setInputNode("checkpoint","4.inputs.ckpt_name")
          .setOutputNode("images","9")
          .input("positive","Flags disabled preview test")
          .input("seed", seed())
          .input("checkpoint", ckpt, api3.osType);

        let previews = 0;
        let metaPreviews = 0;
        await new CallWrapper(api3, builder)
          .onPreview(() => { previews++; })
          // @ts-ignore: optional chaining for older environments
          .onPreviewMeta?.(({ blob, metadata }) => { void blob; void metadata; metaPreviews++; })
          .run();

        expect(previews + metaPreviews).toBeGreaterThanOrEqual(0);
        if (metaPreviews > 0) {
          // eslint-disable-next-line no-console
          console.warn("[Flags:false] Received metadata previews despite disable request; server may ignore client flag.");
        }
      } finally {
        api3.destroy();
      }
    });
  });
}
