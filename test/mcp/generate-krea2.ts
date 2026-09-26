import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

async function runKrea2Test() {
  console.log("=== Launching Krea2 Turbo NVFP4 Pipeline via Bun Stdio MCP ===");

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
    await sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "krea2-agent", version: "1.0.0" }
    });
    sendNotification("notifications/initialized");

    // 2. Krea2 Turbo Pipeline Architecture
    console.log("\n[2] Constructing Krea2 Turbo NVFP4 workflow graph...");
    const krea2Workflow = {
      "29": {
        class_type: "SaveImage",
        inputs: {
          filename_prefix: "Krea2_turbo",
          images: ["57", 0]
        }
      },
      "54": {
        class_type: "CLIPTextEncode",
        inputs: {
          text: "ultra realistic portrait of a cat on the lap of a girl vesper",
          clip: ["74", 0]
        }
      },
      "55": {
        class_type: "EmptyLatentImage",
        inputs: {
          width: 1024,
          height: 1024,
          batch_size: 1
        }
      },
      "56": {
        class_type: "KSampler",
        inputs: {
          seed: 1018287161243782,
          steps: 8,
          cfg: 1.0,
          sampler_name: "euler",
          scheduler: "beta57",
          denoise: 1.0,
          model: ["58", 0],
          positive: ["72", 0],
          negative: ["59", 0],
          latent_image: ["55", 0]
        }
      },
      "57": {
        class_type: "VAEDecode",
        inputs: {
          samples: ["56", 0],
          vae: ["75", 0]
        }
      },
      "58": {
        class_type: "UNETLoader",
        inputs: {
          unet_name: "krea2TurboOfficialComfy_krea2TurboNvfp4.safetensors",
          weight_dtype: "default"
        }
      },
      "59": {
        class_type: "ConditioningZeroOut",
        inputs: {
          conditioning: ["54", 0]
        }
      },
      "72": {
        class_type: "ConditioningKrea2Rebalance",
        inputs: {
          multiplier: 3.0,
          per_layer_weights: "1.0,1.0,1.0,1.0,1.0,1.0,1.0,2.5,5.0,1.1,4.0,1.0",
          conditioning: ["54", 0]
        }
      },
      "74": {
        class_type: "CLIPLoader",
        inputs: {
          clip_name: "qwen3_vl_4b_nvfp4_full.safetensors",
          type: "krea2",
          device: "default"
        }
      },
      "75": {
        class_type: "VAELoader",
        inputs: {
          vae_name: "krea2RealVae_v10.safetensors"
        }
      }
    };

    // 3. Validate
    console.log("\n[3] Validating with comfy_validate...");
    const valResult = await sendRequest("tools/call", {
      name: "comfy_validate",
      arguments: { workflow: krea2Workflow }
    });
    const valData = JSON.parse(valResult.content[0].text);
    console.log("-> Validation valid:", valData.valid, "Detected outputs:", valData.detectedOutputs);

    // 4. Save to Storage
    console.log("\n[4] Saving workflow with comfy_workflows (action: save)...");
    await sendRequest("tools/call", {
      name: "comfy_workflows",
      arguments: {
        action: "save",
        name: "krea2_turbo.json",
        workflow: krea2Workflow,
        slots: {
          prompt: "54.inputs.text",
          seed: "56.inputs.seed",
          steps: "56.inputs.steps",
          cfg: "56.inputs.cfg"
        },
        overwrite: true
      }
    });

    // 5. Generate Run 1: Cat on lap of girl vesper
    console.log("\n[5] Executing comfy_generate (Run 1: Cat on lap of girl)...");
    const genResult1 = await sendRequest("tools/call", {
      name: "comfy_generate",
      arguments: {
        workflow: "krea2_turbo.json",
        count: 1,
        wait: true,
        timeoutMs: 120000
      }
    });

    let runId1 = "";
    let reviewImage1 = "";
    for (const c of genResult1.content) {
      if (c.type === "text") {
        const parsed = JSON.parse(c.text);
        runId1 = parsed.runId;
        console.log("-> Run 1 Status:", parsed.status);
        console.log("-> Candidates:", JSON.stringify(parsed.candidates, null, 2));
      }
      if (c.type === "image") {
        reviewImage1 = c.data;
        console.log(`-> Review Image 1 received (base64 length: ${c.data.length})`);
      }
    }

    // 6. Generate Run 2: Side-by-Side Comparison Benchmark (Elderly Watchmaker with Krea2)
    console.log("\n[6] Executing comfy_generate (Run 2: Watchmaker Portrait on Krea2)...");
    const genResult2 = await sendRequest("tools/call", {
      name: "comfy_generate",
      arguments: {
        workflow: "krea2_turbo.json",
        inputs: {
          prompt: "Award-winning natural 35mm film photograph, intimate portrait of an elderly Swiss watchmaker in his wooden workshop, gentle focused expression, natural authentic skin with soft pores and fine wrinkles, examining a delicate tourbillon watch mechanism with precision tweezers under warm soft desk lamp. Natural soft lighting, subtle film grain, organic colors, master craftsmanship, sharp focus, 85mm lens, Kodachrome film look",
          seed: 428917203
        },
        count: 1,
        wait: true,
        timeoutMs: 120000
      }
    });

    let runId2 = "";
    let reviewImage2 = "";
    for (const c of genResult2.content) {
      if (c.type === "text") {
        const parsed = JSON.parse(c.text);
        runId2 = parsed.runId;
        console.log("-> Run 2 Status:", parsed.status);
        console.log("-> Candidates:", JSON.stringify(parsed.candidates, null, 2));
      }
      if (c.type === "image") {
        reviewImage2 = c.data;
        console.log(`-> Review Image 2 received (base64 length: ${c.data.length})`);
      }
    }

    // Save artifacts for comparison
    // Review images land here; override with COMFY_REVIEW_OUTPUT_DIR.
    const outputDir = path.resolve(process.env.COMFY_REVIEW_OUTPUT_DIR ?? "test-output/mcp");
    await fs.mkdir(outputDir, { recursive: true });
    if (reviewImage1) {
      await fs.writeFile(path.join(outputDir, "krea2_cat_girl.jpg"), Buffer.from(reviewImage1, "base64"));
      console.log("-> Saved krea2_cat_girl.jpg");
    }
    if (reviewImage2) {
      await fs.writeFile(path.join(outputDir, "krea2_watchmaker.jpg"), Buffer.from(reviewImage2, "base64"));
      console.log("-> Saved krea2_watchmaker.jpg");
    }

    // Inspect fine detail crop on Run 1
    if (runId1) {
      console.log("\n[7] Inspecting cat & girl detail crop with comfy_inspect...");
      const cropResult = await sendRequest("tools/call", {
        name: "comfy_inspect",
        arguments: {
          runId: runId1,
          mode: "crop",
          crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }
        }
      });
      const cropImg = cropResult.content.find((c: any) => c.type === "image");
      if (cropImg?.data) {
        await fs.writeFile(path.join(outputDir, "krea2_cat_crop.jpg"), Buffer.from(cropImg.data, "base64"));
        console.log("-> Saved krea2_cat_crop.jpg");
      }
    }

    console.log("\n=== ALL KREA2 PIPELINE RUNS COMPLETED SUCCESSFULLY! ===");
  } catch (err: any) {
    console.error("Execution failed:", err);
  } finally {
    child.kill();
  }
}

runKrea2Test();
