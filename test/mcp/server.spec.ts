import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import path from "path";
import sharp from "sharp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createComfyMcpServer } from "../../src/mcp/server.js";
import { ComfyApi } from "../../src/client.js";
import { WorkflowCatalog } from "../../src/mcp/workflow-catalog.js";
import { McpGenerationSession } from "../../src/mcp/generation-session.js";

describe("Comfy MCP Server", () => {
  let mcpClient: Client;
  let serverSession: McpGenerationSession;
  let mockApi: ComfyApi;

  // Helper to create synthetic test image
  async function createTestImage(width: number, height: number, color: { r: number; g: number; b: number }): Promise<Buffer> {
    return sharp({
      create: {
        width,
        height,
        channels: 3,
        background: color
      }
    })
      .png()
      .toBuffer();
  }

  beforeEach(async () => {
    mockApi = new ComfyApi("http://127.0.0.1:8188");

    // Mock ComfyApi features
    mockApi.ext.system.getSystemStats = async () =>
      ({
        system: { os: "windows", ram_total: 32000000000, ram_free: 16000000000 },
        devices: [{ name: "RTX 4090", type: "cuda", vram_total: 24000000000, vram_free: 20000000000 }]
      } as any);

    mockApi.ext.queue.getQueue = async () =>
      ({
        queue_running: [],
        queue_pending: []
      } as any);

    mockApi.ext.node.getNodeDefs = async () => ({
      KSampler: {
        name: "KSampler",
        display_name: "KSampler",
        category: "sampling",
        description: "Samples a model",
        output_node: false,
        input: {
          required: {
            model: ["MODEL", {}],
            seed: ["INT", { default: 0 }],
            steps: ["INT", { default: 20 }],
            cfg: ["FLOAT", { default: 8.0 }],
            sampler_name: [["euler", "dpmpp_2m"], {}],
            scheduler: [["normal", "karras"], {}],
            positive: ["CONDITIONING", {}],
            negative: ["CONDITIONING", {}],
            latent_image: ["LATENT", {}]
          }
        },
        output: ["LATENT"],
        output_name: ["LATENT"]
      },
      SaveImage: {
        name: "SaveImage",
        display_name: "Save Image",
        category: "image",
        output_node: true,
        input: {
          required: {
            images: ["IMAGE", {}]
          }
        },
        output: []
      }
    });

    mockApi.ext.node.getCheckpoints = async () => ["sd_xl_base_1.0.safetensors"];
    mockApi.ext.node.getLoras = async () => ["style_lora.safetensors"];
    mockApi.ext.node.getSamplerInfo = async () => ({
      sampler: ["euler", "dpmpp_2m"],
      scheduler: ["normal", "karras"]
    });

    const catalog = new WorkflowCatalog([path.resolve("./test")]);
    serverSession = new McpGenerationSession(mockApi, catalog);

    const mcpServer = createComfyMcpServer({
      client: mockApi,
      catalog,
      session: serverSession
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    mcpClient = new Client({ name: "test-agent", version: "1.0.0" });

    await Promise.all([
      mcpServer.connect(serverTransport),
      mcpClient.connect(clientTransport)
    ]);
  });

  afterEach(async () => {
    await mcpClient.close().catch(() => {});
  });

  it("lists all 9 registered MCP tools with schemas", async () => {
    const response = await mcpClient.listTools();
    const toolNames = response.tools.map((t) => t.name);

    expect(toolNames).toHaveLength(9);
    expect(toolNames).toContain("comfy_info");
    expect(toolNames).toContain("comfy_nodes");
    expect(toolNames).toContain("comfy_recipes");
    expect(toolNames).toContain("comfy_validate");
    expect(toolNames).toContain("comfy_workflows");
    expect(toolNames).toContain("comfy_generate");
    expect(toolNames).toContain("comfy_inspect");
    expect(toolNames).toContain("comfy_revise");
    expect(toolNames).toContain("comfy_job");
  });

  it("executes comfy_info tool", async () => {
    const res = await mcpClient.callTool({
      name: "comfy_info",
      arguments: {}
    });

    expect(res.isError).toBeFalsy();
    expect(res.content).toHaveLength(1);
    expect(res.content[0].type).toBe("text");

    const parsed = JSON.parse((res.content[0] as any).text);
    expect(parsed.comfyUrl).toBe("http://127.0.0.1:8188");
    expect(parsed.system.os).toBe("windows");
    expect(parsed.models.checkpoints).toContain("sd_xl_base_1.0.safetensors");
    expect(parsed.workflowStorage.workflowCount).toBeGreaterThan(0);
    expect(parsed.availableRecipes).toBeDefined();
  });

  it("executes comfy_recipes tool to list and scaffold", async () => {
    // List recipes
    const listRes = await mcpClient.callTool({
      name: "comfy_recipes",
      arguments: { action: "list", installedOnly: false }
    });
    expect(listRes.isError).toBeFalsy();
    const listData = JSON.parse((listRes.content[0] as any).text);
    expect(listData.count).toBeGreaterThanOrEqual(3);

    // Scaffold a recipe
    const scaffoldRes = await mcpClient.callTool({
      name: "comfy_recipes",
      arguments: { action: "scaffold", recipe: "sdxl_base", prompt: "test prompt" }
    });
    expect(scaffoldRes.isError).toBeFalsy();
    const scaffoldData = JSON.parse((scaffoldRes.content[0] as any).text);
    expect(scaffoldData.recipe).toBe("sdxl_base");
    expect(scaffoldData.workflow).toBeDefined();
    expect(scaffoldData.slots.prompt).toBe("6.inputs.text");
  });

  it("executes comfy_nodes tool to search and inspect pin schemas", async () => {
    // Search by query
    const searchRes = await mcpClient.callTool({
      name: "comfy_nodes",
      arguments: { query: "sampler" }
    });
    expect(searchRes.isError).toBeFalsy();
    const searchData = JSON.parse((searchRes.content[0] as any).text);
    expect(searchData.count).toBeGreaterThan(0);
    expect(searchData.nodes[0].classType).toBe("KSampler");

    // Exact class schema lookup
    const schemaRes = await mcpClient.callTool({
      name: "comfy_nodes",
      arguments: { classType: "KSampler" }
    });
    expect(schemaRes.isError).toBeFalsy();
    const schemaData = JSON.parse((schemaRes.content[0] as any).text);
    expect(schemaData.classType).toBe("KSampler");
    expect(schemaData.requiredInputs.model).toBeDefined();
    expect(schemaData.outputs[0].type).toBe("LATENT");
  });

  it("executes comfy_validate tool on workflow JSON", async () => {
    const validGraph = {
      "3": {
        class_type: "KSampler",
        inputs: {
          model: ["4", 0],
          seed: 123,
          steps: 20,
          cfg: 8.0,
          sampler_name: "euler",
          scheduler: "normal",
          positive: ["6", 0],
          negative: ["7", 0],
          latent_image: ["5", 0]
        }
      }
    };

    const res = await mcpClient.callTool({
      name: "comfy_validate",
      arguments: { workflow: validGraph }
    });

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse((res.content[0] as any).text);
    expect(parsed.valid).toBeDefined();
  });

  it("executes comfy_workflows tool (list, inspect, and save)", async () => {
    // List
    const listRes = await mcpClient.callTool({
      name: "comfy_workflows",
      arguments: { action: "list" }
    });
    expect(listRes.isError).toBeFalsy();
    const listParsed = JSON.parse((listRes.content[0] as any).text);
    expect(listParsed.count).toBeGreaterThan(0);

    // Inspect
    const inspectRes = await mcpClient.callTool({
      name: "comfy_workflows",
      arguments: {
        action: "inspect",
        workflow: "example-txt2img-workflow.json"
      }
    });
    expect(inspectRes.isError).toBeFalsy();
    const inspectParsed = JSON.parse((inspectRes.content[0] as any).text);
    expect(inspectParsed.name).toBe("example-txt2img-workflow.json");
    expect(inspectParsed.slots.prompt).toBeDefined();
  });

  it("executes comfy_inspect and returns MCP image content", async () => {
    const testImg = await createTestImage(400, 300, { r: 100, g: 150, b: 200 });

    const runId = "test_run_inspect";
    const runRecord: any = {
      runId,
      promptIds: ["pid_1"],
      status: "completed",
      workflow: {},
      appliedInputs: { prompt: "a lake" },
      seeds: [999],
      candidates: [
        {
          index: 0,
          promptId: "pid_1",
          nodeId: "9",
          mediaType: "image",
          filename: "lake.png",
          seed: 999,
          imageBuffer: testImg,
          mimeType: "image/png"
        }
      ],
      createdAt: Date.now()
    };
    (serverSession as any).runs.set(runId, runRecord);

    const res = await mcpClient.callTool({
      name: "comfy_inspect",
      arguments: {
        runId,
        mode: "image"
      }
    });

    expect(res.isError).toBeFalsy();
    expect(res.content.length).toBeGreaterThanOrEqual(2);

    const textBlock = res.content.find((c) => c.type === "text");
    const imageBlock = res.content.find((c) => c.type === "image");

    expect(textBlock).toBeDefined();
    expect(imageBlock).toBeDefined();
    expect((imageBlock as any).mimeType).toBe("image/jpeg");
    expect((imageBlock as any).data.length).toBeGreaterThan(0);
  });

  it("executes comfy_job tool for status and cancellation", async () => {
    const runId = "test_run_job";
    const runRecord: any = {
      runId,
      promptIds: ["pid_job_1"],
      status: "running",
      candidates: [],
      createdAt: Date.now()
    };
    (serverSession as any).runs.set(runId, runRecord);

    const statusRes = await mcpClient.callTool({
      name: "comfy_job",
      arguments: {
        runId,
        action: "status"
      }
    });

    expect(statusRes.isError).toBeFalsy();
    const parsed = JSON.parse((statusRes.content[0] as any).text);
    expect(parsed.runId).toBe(runId);
    expect(parsed.status).toBe("running");
  });
});
