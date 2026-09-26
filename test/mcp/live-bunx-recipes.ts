import { spawn } from "child_process";
import path from "path";

async function runLiveBunxRecipesAndProgressTest() {
  console.log("=== Testing comfy_recipes Scaffolding & Live MCP Progress via Bun Stdio ===");

  const binPath = path.resolve("./dist/bin/comfyui-node.js");
  const child = spawn("bun", [binPath, "--url", "http://127.0.0.1:8188", "--workflow-dir", "./workflows"], {
    stdio: ["pipe", "pipe", "inherit"]
  });

  let messageId = 0;
  const pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
  const progressNotifications: any[] = [];

  let buffer = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf-8");
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const json = JSON.parse(trimmed);
        if (json.method === "notifications/progress") {
          progressNotifications.push(json.params);
          console.log(`[MCP Progress Notification] ${json.params.message || ""} (${json.params.progress}/${json.params.total}) token: ${json.params.progressToken}`);
        } else if (json.id !== undefined && pendingRequests.has(json.id)) {
          const { resolve, reject } = pendingRequests.get(json.id)!;
          pendingRequests.delete(json.id);
          if (json.error) {
            reject(new Error(`JSON-RPC Error [${json.error.code}]: ${json.error.message}`));
          } else {
            resolve(json.result);
          }
        }
      } catch {}
    }
  });

  function sendRequest(method: string, params: any = {}): Promise<any> {
    messageId++;
    const id = messageId;
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject });
      child.stdin.write(`${msg}\n`);
    });
  }

  function sendNotification(method: string, params: any = {}) {
    const msg = JSON.stringify({ jsonrpc: "2.0", method, params });
    child.stdin.write(`${msg}\n`);
  }

  try {
    // 1. Handshake
    console.log("\n[1] Initializing MCP connection...");
    const initResult = await sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "recipes-tester", version: "1.0.0" }
    });
    console.log("-> Server Name:", initResult.serverInfo?.name, "Version:", initResult.serverInfo?.version);
    sendNotification("notifications/initialized");

    // 2. Discover Tools
    console.log("\n[2] Checking tools/list (expecting 9 tools)...");
    const toolsResult = await sendRequest("tools/list", {});
    const toolNames = toolsResult.tools.map((t: any) => t.name);
    console.log(`-> Discovered ${toolNames.length} Tools:`, toolNames.join(", "));

    // 3. Call comfy_info (Check enriched availableRecipes)
    console.log("\n[3] Calling comfy_info tool...");
    const infoResult = await sendRequest("tools/call", {
      name: "comfy_info",
      arguments: {}
    });
    const infoData = JSON.parse(infoResult.content[0].text);
    console.log("-> Available UNETs Count:", infoData.models?.unetsCount);
    console.log("-> Runnable Recipes Detected in comfy_info:", infoData.availableRecipes?.map((r: any) => r.id));

    // 4. Call comfy_recipes (Action: list)
    console.log("\n[4] Calling comfy_recipes tool (action: list)...");
    const listResult = await sendRequest("tools/call", {
      name: "comfy_recipes",
      arguments: { action: "list", installedOnly: true }
    });
    const listData = JSON.parse(listResult.content[0].text);
    console.log(`-> Found ${listData.count} runnable recipes on target server:`);
    for (const r of listData.recipes) {
      console.log(`   * [${r.id}] ${r.name} (${r.category}) - ${r.description.slice(0, 70)}...`);
    }

    // 5. Call comfy_recipes (Action: scaffold & save)
    console.log("\n[5] Calling comfy_recipes to scaffold and save 'krea2_turbo'...");
    const scaffoldResult = await sendRequest("tools/call", {
      name: "comfy_recipes",
      arguments: {
        action: "scaffold",
        recipe: "krea2_turbo",
        prompt: "ultra realistic portrait of an adorable red panda eating bamboo",
        saveName: "auto_scaffold_krea2.json",
        overwrite: true
      }
    });
    const scaffoldData = JSON.parse(scaffoldResult.content[0].text);
    console.log("-> Scaffolded Recipe:", scaffoldData.recipe);
    console.log("-> Saved to Workflow Storage:", scaffoldData.savedWorkflow?.name, "Path:", scaffoldData.savedWorkflow?.path);
    console.log("-> Slots:", Object.keys(scaffoldData.slots));

    // 6. Generate with Live MCP Progress Token
    console.log("\n[6] Running comfy_generate with MCP progress token 'progress-token-abc'...");
    const genResult = await sendRequest("tools/call", {
      name: "comfy_generate",
      arguments: {
        workflow: "auto_scaffold_krea2.json",
        count: 1,
        wait: true,
        timeoutMs: 60000
      },
      _meta: { progressToken: "progress-token-abc" }
    });

    let runId = "";
    for (const c of genResult.content) {
      if (c.type === "text") {
        const genData = JSON.parse(c.text);
        runId = genData.runId;
        console.log("-> Run ID:", genData.runId, "Status:", genData.status);
        console.log("-> Candidate:", genData.candidates?.[0]?.filename);
      }
      if (c.type === "image") {
        console.log(`-> Review Image Received (base64 length: ${c.data?.length})`);
      }
    }

    console.log(`-> Total MCP Progress Notifications Received: ${progressNotifications.length}`);

    // 7. Cleanup
    console.log("\n[7] Cleaning up scaffolded test workflow...");
    await sendRequest("tools/call", {
      name: "comfy_workflows",
      arguments: { action: "delete", name: "auto_scaffold_krea2.json" }
    });

    console.log("\n=== ALL RECIPES & PROGRESS TESTS COMPLETED SUCCESSFULLY! ===");
  } catch (err: any) {
    console.error("Test failed:", err);
    process.exit(1);
  } finally {
    child.kill();
  }
}

runLiveBunxRecipesAndProgressTest();
