// Debug script to inspect monitoring-related node defs and endpoints
// Usage: bun run scripts/debug-monitoring.ts [host]
// Set COMFY_HOST env or pass host arg (default http://127.0.0.1:8188)

import { ComfyApi } from "../src/index.ts";

const host = process.env.COMFY_HOST || process.argv[2] || "http://127.0.0.1:8188";

(async () => {
  console.log("[debug-monitoring] Host:", host);
  const api = new ComfyApi(host, undefined, { listenTerminal: false });
  await api.init();
  await api.waitForReady();
  console.log("[debug-monitoring] Ready. Fetching global node defs...");
  let all: any = null;
  try {
    all = await api.ext.node.getNodeDefs();
  } catch (e) {
    console.error("[debug-monitoring] Failed to fetch global node defs", e);
  }
  if (all) {
    const keys = Object.keys(all);
    const crystools = keys.filter(k => k.toLowerCase().includes("cryst"));
    console.log(`[debug-monitoring] Total node defs: ${keys.length}`);
    console.log(`[debug-monitoring] Crystools-like node defs (${crystools.length}):`);
    crystools.slice(0, 50).forEach(k => console.log("  -", k));
  }

  const encodedName = encodeURIComponent("Primitive boolean [Crystools]");
  const rawName = "Primitive boolean [Crystools]";
  async function probe(name: string, label: string) {
    try {
      const d = await api.ext.node.getNodeDefs(name);
      if (!d) {
        console.log(`[debug-monitoring] ${label} returned null/empty`);
      } else {
        console.log(`[debug-monitoring] ${label} keys:`, Object.keys(d));
      }
    } catch (e) {
      console.log(`[debug-monitoring] ${label} error`, e);
    }
  }
  await probe(encodedName, "encoded lookup");
  await probe(rawName, "raw lookup");

  // Probe REST endpoints
  for (const path of ["/api/crystools/monitor", "/api/crystools/monitor/switch", "/api/crystools/monitor/HDD", "/api/crystools/monitor/GPU"]) {
    try {
      const res = await api.fetchApi(path, path.endsWith("/switch") ? { method: "POST", body: JSON.stringify({ monitor: true }) } : undefined);
      console.log(`[debug-monitoring] GET/POST ${path} ->`, res.status, res.statusText);
      if (res.ok) {
        try { console.log("  body:", await res.clone().text()); } catch {}
      }
    } catch (e) {
      console.log(`[debug-monitoring] fetch error ${path}`, e);
    }
  }

  console.log("[debug-monitoring] Done. Exiting.");
  process.exit(0);
})();
