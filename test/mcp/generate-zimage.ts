import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

async function generateZImageTurbo() {
  console.log("=== Launching comfyui-node stdio MCP for Z-Image Turbo NVFP4 ===");

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
      clientInfo: { name: "z-image-agent", version: "1.0.0" }
    });
    sendNotification("notifications/initialized");

    // 2. Define Z-Image Turbo NVFP4 Workflow
    console.log("\n[2] Constructing Z-Image Turbo NVFP4 workflow graph...");
    const zImageWorkflow = {
      "1": {
        class_type: "UNETLoader",
        inputs: {
          unet_name: "z_image_turbo_nvfp4.safetensors",
          weight_dtype: "default"
        }
      },
      "2": {
        class_type: "ModelSamplingAuraFlow",
        inputs: {
          shift: 3.0,
          model: ["1", 0]
        }
      },
      "3": {
        class_type: "CLIPLoader",
        inputs: {
          clip_name: "qwen_3_4b.safetensors",
          type: "lumina2",
          device: "default"
        }
      },
      "4": {
        class_type: "VAELoader",
        inputs: {
          vae_name: "ae.safetensors"
        }
      },
      "5": {
        class_type: "CLIPTextEncode",
        inputs: {
          text: "award-winning cinematic portrait of an elderly artisan watchmaker in a vintage Swiss workshop, intense focused expression, fine weathered wrinkles, authentic skin pores, holding fine precision tweezers working on a glowing tourbillon balance wheel. Soft golden dust motes illuminated by warm task lamp, dramatic chiaroscuro lighting, intricate brass and sapphire watch movements, shallow depth of field, 85mm f/1.2 lens, photorealistic 8k, raw color photography, mastercraftsmanship",
          clip: ["3", 0]
        }
      },
      "6": {
        class_type: "CLIPTextEncode",
        inputs: {
          text: "blurry, illustration, 3d render, painting, anime, plastic, smooth skin, cartoon, watermark, low quality, oversaturated, deformed hands, extra fingers",
          clip: ["3", 0]
        }
      },
      "7": {
        class_type: "EmptySD3LatentImage",
        inputs: {
          width: 1024,
          height: 1024,
          batch_size: 1
        }
      },
      "8": {
        class_type: "KSampler",
        inputs: {
          seed: Math.floor(Math.random() * 1000000000),
          steps: 20,
          cfg: 4.0,
          sampler_name: "res_multistep",
          scheduler: "simple",
          denoise: 1.0,
          model: ["2", 0],
          positive: ["5", 0],
          negative: ["6", 0],
          latent_image: ["7", 0]
        }
      },
      "9": {
        class_type: "VAEDecode",
        inputs: {
          samples: ["8", 0],
          vae: ["4", 0]
        }
      },
      "10": {
        class_type: "SaveImage",
        inputs: {
          filename_prefix: "ZImageTurbo_Masterpiece",
          images: ["9", 0]
        }
      }
    };

    // 3. Validate
    console.log("\n[3] Validating with comfy_validate...");
    const valResult = await sendRequest("tools/call", {
      name: "comfy_validate",
      arguments: { workflow: zImageWorkflow }
    });
    const valData = JSON.parse(valResult.content[0].text);
    console.log("-> Validation valid:", valData.valid, "Detected outputs:", valData.detectedOutputs);
    if (!valData.valid) {
      console.error("Validation errors:", valData.errors);
      return;
    }

    // 4. Save to Storage
    console.log("\n[4] Saving workflow with comfy_workflows (action: save)...");
    await sendRequest("tools/call", {
      name: "comfy_workflows",
      arguments: {
        action: "save",
        name: "z_image_turbo_photorealism.json",
        workflow: zImageWorkflow,
        slots: {
          prompt: "5.inputs.text",
          negative_prompt: "6.inputs.text",
          seed: "8.inputs.seed",
          steps: "8.inputs.steps",
          cfg: "8.inputs.cfg"
        },
        overwrite: true
      }
    });

    // 5. Generate
    console.log("\n[5] Executing comfy_generate with z_image_turbo_nvfp4 on GPU...");
    const genResult = await sendRequest("tools/call", {
      name: "comfy_generate",
      arguments: {
        workflow: "z_image_turbo_photorealism.json",
        count: 1,
        wait: true,
        timeoutMs: 120000
      }
    });

    let runId = "";
    let reviewImageBase64 = "";
    for (const c of genResult.content) {
      if (c.type === "text") {
        const parsed = JSON.parse(c.text);
        runId = parsed.runId;
        console.log("-> Generation Status:", parsed.status);
        console.log("-> Candidates:", JSON.stringify(parsed.candidates, null, 2));
      }
      if (c.type === "image") {
        reviewImageBase64 = c.data;
        console.log(`-> Review Image received! MIME: ${c.mimeType}, base64 length: ${c.data.length}`);
      }
    }

    // 6. Inspect Fine-Grain Details (Macro Crop)
    if (runId) {
      console.log("\n[6] Inspecting fine detail crop with comfy_inspect...");
      const cropResult = await sendRequest("tools/call", {
        name: "comfy_inspect",
        arguments: {
          runId,
          mode: "crop",
          crop: { x: 0.3, y: 0.3, width: 0.4, height: 0.4 }
        }
      });
      const cropImg = cropResult.content.find((c: any) => c.type === "image");
      if (cropImg) {
        console.log(`-> Crop review image received! Base64 length: ${cropImg.data.length}`);
      }

      // Save images to brain directory for artifact presentation
      // Review images land here; override with COMFY_REVIEW_OUTPUT_DIR.
      const outputDir = path.resolve(process.env.COMFY_REVIEW_OUTPUT_DIR ?? "test-output/mcp");
      await fs.mkdir(outputDir, { recursive: true });
      if (reviewImageBase64) {
        await fs.writeFile(path.join(outputDir, "zimage_turbo_masterpiece.jpg"), Buffer.from(reviewImageBase64, "base64"));
        console.log("-> Saved review image to artifact brain directory!");
      }
      if (cropImg?.data) {
        await fs.writeFile(path.join(outputDir, "zimage_turbo_crop.jpg"), Buffer.from(cropImg.data, "base64"));
        console.log("-> Saved detail crop image to artifact brain directory!");
      }
    }

    console.log("\n=== Z-IMAGE TURBO GENERATION & INSPECTION COMPLETED SUCCESSFULLY! ===");
  } catch (err: any) {
    console.error("Execution failed:", err);
  } finally {
    child.kill();
  }
}

generateZImageTurbo();
