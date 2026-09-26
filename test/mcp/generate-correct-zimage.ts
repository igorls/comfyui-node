import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

async function runCorrectZImageTurbo() {
  console.log("=== Running Exact Correct Z-Image Turbo NVFP4 Pipeline via Bun Stdio MCP ===");

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
      clientInfo: { name: "z-image-correct-agent", version: "1.0.0" }
    });
    sendNotification("notifications/initialized");

    // 2. Correct Z-Image Turbo NVFP4 Workflow Architecture
    console.log("\n[2] Constructing Exact Correct Z-Image Turbo NVFP4 workflow graph...");
    const correctWorkflow = {
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
          text: "Dramatic black and white high fashion studio portrait, close-up bust shot, pale platinum blonde woman with sleek low ponytail, head tilted upward, eyes softly closed, wearing a fitted black turtleneck top. A large translucent pale white butterfly hovers gently right at her lips, delicate detailed wing veins visible. Hard rim light creates glowing bright white halo around her hair and face, deep inky pure black minimalist background, stark high contrast chiaroscuro lighting, film grain texture, moody ethereal atmosphere, monochrome, editorial fashion photography, shot on 35mm film, soft subtle skin texture, sharp focus on butterfly and facial profile, vertical composition, minimalist dark aesthetic, artistic surreal fashion",
          clip: ["3", 0]
        }
      },
      "6": {
        class_type: "ConditioningZeroOut",
        inputs: {
          conditioning: ["5", 0]
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
          seed: 314795221153419,
          steps: 8,
          cfg: 1.0,
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
          filename_prefix: "z-image-turbo-correct",
          images: ["9", 0]
        }
      }
    };

    // 3. Validate
    console.log("\n[3] Validating with comfy_validate...");
    const valResult = await sendRequest("tools/call", {
      name: "comfy_validate",
      arguments: { workflow: correctWorkflow }
    });
    const valData = JSON.parse(valResult.content[0].text);
    console.log("-> Validation valid:", valData.valid, "Detected outputs:", valData.detectedOutputs);

    // 4. Save to Storage
    console.log("\n[4] Saving workflow with comfy_workflows (action: save)...");
    await sendRequest("tools/call", {
      name: "comfy_workflows",
      arguments: {
        action: "save",
        name: "z_image_turbo_correct.json",
        workflow: correctWorkflow,
        slots: {
          prompt: "5.inputs.text",
          seed: "8.inputs.seed",
          steps: "8.inputs.steps",
          cfg: "8.inputs.cfg"
        },
        overwrite: true
      }
    });

    // 5. Generate Run 1: High Fashion Butterfly Portrait (CFG 1.0, 8 steps, ConditioningZeroOut)
    console.log("\n[5] Executing comfy_generate (Run 1: Butterfly Fashion Portrait)...");
    const genResult1 = await sendRequest("tools/call", {
      name: "comfy_generate",
      arguments: {
        workflow: "z_image_turbo_correct.json",
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

    // 6. Generate Run 2: Clean Unbaked Photorealism (Elderly Watchmaker with exact CFG 1.0, 8 steps, ConditioningZeroOut)
    console.log("\n[6] Executing comfy_generate (Run 2: Natural Unbaked Watchmaker Portrait)...");
    const genResult2 = await sendRequest("tools/call", {
      name: "comfy_generate",
      arguments: {
        workflow: "z_image_turbo_correct.json",
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

    // Save all review artifacts
    // Review images land here; override with COMFY_REVIEW_OUTPUT_DIR.
    const outputDir = path.resolve(process.env.COMFY_REVIEW_OUTPUT_DIR ?? "test-output/mcp");
    await fs.mkdir(outputDir, { recursive: true });
    if (reviewImage1) {
      await fs.writeFile(path.join(outputDir, "zimage_butterfly_fashion.jpg"), Buffer.from(reviewImage1, "base64"));
      console.log("-> Saved zimage_butterfly_fashion.jpg");
    }
    if (reviewImage2) {
      await fs.writeFile(path.join(outputDir, "zimage_watchmaker_unbaked.jpg"), Buffer.from(reviewImage2, "base64"));
      console.log("-> Saved zimage_watchmaker_unbaked.jpg");
    }

    // Crop inspection on Run 1
    if (runId1) {
      console.log("\n[7] Inspecting butterfly detail crop with comfy_inspect...");
      const cropResult = await sendRequest("tools/call", {
        name: "comfy_inspect",
        arguments: {
          runId: runId1,
          mode: "crop",
          crop: { x: 0.25, y: 0.35, width: 0.5, height: 0.5 }
        }
      });
      const cropImg = cropResult.content.find((c: any) => c.type === "image");
      if (cropImg?.data) {
        await fs.writeFile(path.join(outputDir, "zimage_butterfly_crop.jpg"), Buffer.from(cropImg.data, "base64"));
        console.log("-> Saved zimage_butterfly_crop.jpg");
      }
    }

    console.log("\n=== ALL CORRECT PIPELINE RUNS COMPLETED SUCCESSFULLY! ===");
  } catch (err: any) {
    console.error("Execution failed:", err);
  } finally {
    child.kill();
  }
}

runCorrectZImageTurbo();
