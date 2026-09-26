import { spawn } from "child_process";
import path from "path";

/**
 * End-to-End Live MCP Test using the real CLI executable over Stdio JSON-RPC
 */
async function runLiveBunxStdioTest() {
  console.log("=== Launching CLI Stdio MCP Server via Bun against http://127.0.0.1:8188 ===");

  const binPath = path.resolve("./dist/bin/comfyui-node.js");
  const child = spawn("bun", [binPath, "--url", "http://127.0.0.1:8188", "--workflow-dir", "./workflows"], {
    stdio: ["pipe", "pipe", "inherit"]
  });

  let messageId = 0;
  const pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();

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
        if (json.id !== undefined && pendingRequests.has(json.id)) {
          const { resolve, reject } = pendingRequests.get(json.id)!;
          pendingRequests.delete(json.id);
          if (json.error) {
            reject(new Error(`JSON-RPC Error [${json.error.code}]: ${json.error.message}`));
          } else {
            resolve(json.result);
          }
        }
      } catch (err) {
        console.error("Non-JSON stdout line:", trimmed);
      }
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
    // 1. Initialize Handshake
    console.log("\n[Step 1] Initializing MCP connection...");
    const initResult = await sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "live-bunx-test-agent", version: "1.0.0" }
    });
    console.log("-> Server Name:", initResult.serverInfo?.name, "Version:", initResult.serverInfo?.version);
    sendNotification("notifications/initialized");

    // 2. List Tools
    console.log("\n[Step 2] Querying tools/list...");
    const toolsResult = await sendRequest("tools/list", {});
    const toolNames = toolsResult.tools.map((t: any) => t.name);
    console.log("-> Discovered Tools (" + toolNames.length + "):", toolNames.join(", "));

    // 3. Call comfy_info
    console.log("\n[Step 3] Calling comfy_info tool...");
    const infoResult = await sendRequest("tools/call", {
      name: "comfy_info",
      arguments: {}
    });
    const infoData = JSON.parse(infoResult.content[0].text);
    console.log("-> ComfyUI Host OS:", infoData.system?.os);
    console.log("-> GPU:", infoData.devices?.[0]?.name);
    console.log("-> Available Checkpoints:", infoData.models?.checkpoints);
    console.log("-> Storage Directories:", infoData.workflowStorage?.configuredDirectories);

    // 4. Call comfy_nodes (Search & Schema Inspection)
    console.log("\n[Step 4] Calling comfy_nodes to discover nodes & inspect schema...");
    const searchResult = await sendRequest("tools/call", {
      name: "comfy_nodes",
      arguments: { query: "sampler", limit: 5 }
    });
    const searchData = JSON.parse(searchResult.content[0].text);
    console.log(`-> Found ${searchData.count} sampler nodes. Top node: ${searchData.nodes?.[0]?.displayName} (${searchData.nodes?.[0]?.classType})`);

    const schemaResult = await sendRequest("tools/call", {
      name: "comfy_nodes",
      arguments: { classType: "KSampler" }
    });
    const schemaData = JSON.parse(schemaResult.content[0].text);
    console.log("-> KSampler Required Input Pins:", Object.keys(schemaData.requiredInputs));
    console.log("-> KSampler Output Pins:", schemaData.outputs.map((o: any) => `${o.name} (${o.type})`));

    // 5. Build & Validate a Custom Workflow Graph
    console.log("\n[Step 5] Building & Validating custom workflow graph with comfy_validate...");
    const customWorkflow = {
      "3": {
        class_type: "KSampler",
        inputs: {
          seed: 424242,
          steps: 8,
          cfg: 5.0,
          sampler_name: "euler",
          scheduler: "normal",
          denoise: 1.0,
          model: ["4", 0],
          positive: ["6", 0],
          negative: ["7", 0],
          latent_image: ["5", 0]
        }
      },
      "4": {
        class_type: "CheckpointLoaderSimple",
        inputs: {
          ckpt_name: infoData.models?.checkpoints?.[2] || infoData.models?.checkpoints?.[0] || "oneObsession_v24.safetensors"
        }
      },
      "5": {
        class_type: "EmptyLatentImage",
        inputs: {
          width: 512,
          height: 512,
          batch_size: 1
        }
      },
      "6": {
        class_type: "CLIPTextEncode",
        inputs: {
          text: "a glowing neon cybernetic gemstone, cinematic lighting, 8k octane render",
          clip: ["4", 1]
        }
      },
      "7": {
        class_type: "CLIPTextEncode",
        inputs: {
          text: "blurry, low quality, dark",
          clip: ["4", 1]
        }
      },
      "8": {
        class_type: "VAEDecode",
        inputs: {
          samples: ["3", 0],
          vae: ["4", 2]
        }
      },
      "9": {
        class_type: "SaveImage",
        inputs: {
          filename_prefix: "AgentTest",
          images: ["8", 0]
        }
      }
    };

    const validateResult = await sendRequest("tools/call", {
      name: "comfy_validate",
      arguments: { workflow: customWorkflow }
    });
    const validateData = JSON.parse(validateResult.content[0].text);
    console.log("-> Validation Valid:", validateData.valid, "Detected Outputs:", validateData.detectedOutputs);
    if (validateData.errors?.length > 0) {
      console.error("-> Validation Errors:", validateData.errors);
    }

    // 6. Save the Workflow via comfy_workflows
    console.log("\n[Step 6] Persisting workflow to storage with comfy_workflows (action: save)...");
    const saveResult = await sendRequest("tools/call", {
      name: "comfy_workflows",
      arguments: {
        action: "save",
        name: "agent_custom_txt2img.json",
        workflow: customWorkflow,
        slots: {
          prompt: "6.inputs.text",
          negative_prompt: "7.inputs.text",
          seed: "3.inputs.seed"
        },
        overwrite: true
      }
    });
    const saveData = JSON.parse(saveResult.content[0].text);
    console.log("-> Workflow saved successfully:", saveData.workflow?.name, "Path:", saveData.workflow?.path);

    // 7. Execute Generation with the Saved Workflow
    console.log("\n[Step 7] Running comfy_generate with the newly saved workflow...");
    const genResult = await sendRequest("tools/call", {
      name: "comfy_generate",
      arguments: {
        workflow: "agent_custom_txt2img.json",
        inputs: {
          prompt: "a majestic holographic crystal sculpture on black glass, vibrant prismatic colors",
          steps: 8
        },
        count: 1,
        wait: true,
        timeoutMs: 60000
      }
    });

    let runId = "";
    for (const c of genResult.content) {
      if (c.type === "text") {
        const genData = JSON.parse(c.text);
        runId = genData.runId;
        console.log("-> Run ID:", genData.runId, "Status:", genData.status);
        console.log("-> Output Candidates:", genData.candidates);
      }
      if (c.type === "image") {
        console.log(`-> Review Image Received! MIME: ${c.mimeType}, Base64 Data Length: ${c.data?.length} characters`);
      }
    }

    // 8. Visual Inspection & Revision
    if (runId) {
      console.log("\n[Step 8] Inspecting region crop with comfy_inspect...");
      const cropResult = await sendRequest("tools/call", {
        name: "comfy_inspect",
        arguments: {
          runId,
          mode: "crop",
          crop: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 }
        }
      });
      const cropImage = cropResult.content.find((c: any) => c.type === "image");
      console.log(`-> Crop Image Received! Base64 Data Length: ${cropImage?.data?.length} characters`);
    }

    // 9. Clean up test workflow
    console.log("\n[Step 9] Cleaning up test workflow with comfy_workflows (action: delete)...");
    const deleteResult = await sendRequest("tools/call", {
      name: "comfy_workflows",
      arguments: {
        action: "delete",
        name: "agent_custom_txt2img.json"
      }
    });
    console.log("-> Delete Result:", JSON.parse(deleteResult.content[0].text));

    console.log("\n=== ALL LIVE BUNX STDIO TESTS COMPLETED SUCCESSFULLY! ===");
  } catch (err: any) {
    console.error("Test failed with error:", err);
    process.exit(1);
  } finally {
    child.kill();
  }
}

runLiveBunxStdioTest();
