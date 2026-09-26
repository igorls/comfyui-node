import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ComfyApi } from "../client.js";
import { WorkflowCatalog } from "./workflow-catalog.js";
import { McpGenerationSession } from "./generation-session.js";
import { ComfyGenerateInputSchema, ComfyInfoInputSchema, ComfyInspectInputSchema, ComfyJobInputSchema, ComfyNodesInputSchema, ComfyRecipesInputSchema, ComfyReviseInputSchema, ComfyValidateInputSchema, ComfyWorkflowsInputSchema } from "./schemas.js";
/**
 * Factory creating the ComfyUI MCP Server instance with authoring, validation, and execution tools
 */
export function createComfyMcpServer(options = {}) {
    const comfyUrl = options.comfyUrl || process.env.COMFYUI_URL || "http://127.0.0.1:8188";
    const workflowDirs = options.workflowDirs || (process.env.COMFYUI_WORKFLOW_DIR ? [process.env.COMFYUI_WORKFLOW_DIR] : ["./workflows", "./test"]);
    const client = options.client || new ComfyApi(comfyUrl, undefined, { debug: options.debug });
    const catalog = options.catalog || new WorkflowCatalog(workflowDirs);
    const session = options.session || new McpGenerationSession(client, catalog);
    const server = new McpServer({
        name: options.name || "comfyui-node",
        version: options.version || "1.10.0"
    }, {
        capabilities: {
            tools: {}
        }
    });
    // 1. comfy_info
    server.registerTool("comfy_info", {
        title: "ComfyUI Server & Environment Info",
        description: "Confirm the local ComfyUI server connection, system stats, GPU devices, queue status, available checkpoints/models, and configured workflow directory count.",
        inputSchema: ComfyInfoInputSchema.shape
    }, async (args) => {
        try {
            const info = await session.getInfo(args);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(info, null, 2)
                    }
                ]
            };
        }
        catch (err) {
            return {
                isError: true,
                content: [{ type: "text", text: `comfy_info failed: ${err.message || String(err)}` }]
            };
        }
    });
    // 2. comfy_nodes
    server.registerTool("comfy_nodes", {
        title: "Discover and Inspect ComfyUI Node Schemas",
        description: "Search available core and custom nodes on the server, or retrieve detailed pin signatures (required/optional inputs, pin types, allowed values, outputs, output pin names/types, and defaults) for building custom workflows.",
        inputSchema: ComfyNodesInputSchema.shape
    }, async (args) => {
        try {
            const result = await session.searchNodes(args);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(result, null, 2)
                    }
                ]
            };
        }
        catch (err) {
            return {
                isError: true,
                content: [{ type: "text", text: `comfy_nodes failed: ${err.message || String(err)}` }]
            };
        }
    });
    // 3. comfy_recipes
    server.registerTool("comfy_recipes", {
        title: "Discover and Scaffold Curated Canonical Recipes",
        description: "Discover curated canonical model recipes (Krea 2, Z-Image Turbo, SDXL, Flux, Video, 3D) matching installed server models, or scaffold pre-wired validated workflow graphs with optional persistence to storage.",
        inputSchema: ComfyRecipesInputSchema.shape
    }, async (args) => {
        try {
            const result = await session.manageRecipes(args);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(result, null, 2)
                    }
                ]
            };
        }
        catch (err) {
            return {
                isError: true,
                content: [{ type: "text", text: `comfy_recipes failed: ${err.message || String(err)}` }]
            };
        }
    });
    // 4. comfy_validate
    server.registerTool("comfy_validate", {
        title: "Validate Workflow Graph against Server Nodes",
        description: "Perform deep validation on an API workflow JSON graph against live server node definitions, verifying node presence, input link integrity, pin type compatibility, required inputs, and available model files with actionable repair suggestions.",
        inputSchema: ComfyValidateInputSchema.shape
    }, async (args) => {
        try {
            const result = await session.validateWorkflow(args);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(result, null, 2)
                    }
                ]
            };
        }
        catch (err) {
            return {
                isError: true,
                content: [{ type: "text", text: `comfy_validate failed: ${err.message || String(err)}` }]
            };
        }
    });
    // 5. comfy_workflows
    server.registerTool("comfy_workflows", {
        title: "Manage Workflows (List, Inspect, Save, Delete)",
        description: "Manage workflows in the server's workflow storage: list available workflows, inspect workflow slots/nodes, save newly authored or modified workflows to disk, or delete workflows.",
        inputSchema: ComfyWorkflowsInputSchema.shape
    }, async (args) => {
        try {
            const result = await session.manageWorkflows(args);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(result, null, 2)
                    }
                ]
            };
        }
        catch (err) {
            return {
                isError: true,
                content: [{ type: "text", text: `comfy_workflows failed: ${err.message || String(err)}` }]
            };
        }
    });
    // 6. comfy_generate
    server.registerTool("comfy_generate", {
        title: "Generate Artifacts (Images, Videos, Audio, 3D, Files) from Workflow",
        description: "Execute any ComfyUI workflow (saved workflow or raw API JSON) with prompt and input overrides, candidate count, seed policy, and file attachments. Returns run status, prompt IDs, multi-modal artifacts, and vision review images.",
        inputSchema: ComfyGenerateInputSchema.shape
    }, async (args, extra) => {
        try {
            const progressToken = extra?._meta?.progressToken ??
                extra?.params?._meta?.progressToken ??
                args?._meta?.progressToken;
            const onProgress = progressToken
                ? (progress, total, message) => {
                    try {
                        server.server
                            .notification({
                            method: "notifications/progress",
                            params: {
                                progressToken,
                                progress,
                                total,
                                message
                            }
                        })
                            .catch(() => { });
                    }
                    catch {
                        // Non-fatal
                    }
                }
                : undefined;
            const runRecord = await session.generate(args, onProgress);
            const contentBlocks = [
                {
                    type: "text",
                    text: JSON.stringify({
                        runId: runRecord.runId,
                        status: runRecord.status,
                        promptIds: runRecord.promptIds,
                        workflowName: runRecord.workflowName,
                        structureHash: runRecord.structureHash,
                        candidateCount: runRecord.candidates.length,
                        candidates: runRecord.candidates.map((c) => ({
                            index: c.index,
                            filename: c.filename,
                            nodeId: c.nodeId,
                            mediaType: c.mediaType,
                            seed: c.seed,
                            url: c.url
                        })),
                        error: runRecord.error
                    }, null, 2)
                }
            ];
            // If completed with candidates, include review image rendition automatically
            if (runRecord.status === "completed" && runRecord.candidates.length > 0) {
                try {
                    const inspectRes = await session.inspect({
                        runId: runRecord.runId,
                        mode: runRecord.candidates.length > 1 ? "contact_sheet" : "image"
                    });
                    if (inspectRes.imageContent) {
                        contentBlocks.push(inspectRes.imageContent);
                    }
                }
                catch {
                    // Non-fatal if image rendition encoding fails
                }
            }
            return {
                content: contentBlocks
            };
        }
        catch (err) {
            return {
                isError: true,
                content: [{ type: "text", text: `comfy_generate failed: ${err.message || String(err)}` }]
            };
        }
    });
    // 7. comfy_inspect
    server.registerTool("comfy_inspect", {
        title: "Inspect Visual Outputs and Compare Lineage",
        description: "Return visual review renditions (contact sheet grid, bounded image, region crop, side-by-side revision comparison) or original paths for vision review.",
        inputSchema: ComfyInspectInputSchema.shape
    }, async (args) => {
        try {
            const result = await session.inspect(args);
            const contentBlocks = [
                {
                    type: "text",
                    text: JSON.stringify(result.metadata, null, 2)
                }
            ];
            if (result.imageContent) {
                contentBlocks.push(result.imageContent);
            }
            return {
                content: contentBlocks
            };
        }
        catch (err) {
            return {
                isError: true,
                content: [{ type: "text", text: `comfy_inspect failed: ${err.message || String(err)}` }]
            };
        }
    });
    // 8. comfy_revise
    server.registerTool("comfy_revise", {
        title: "Revise Previous Generation",
        description: "Branch a child run from a previous generation with targeted prompt or slot changes while preserving lineage and seed policies for iterative comparison.",
        inputSchema: ComfyReviseInputSchema.shape
    }, async (args, extra) => {
        try {
            const progressToken = extra?._meta?.progressToken ??
                extra?.params?._meta?.progressToken ??
                args?._meta?.progressToken;
            const onProgress = progressToken
                ? (progress, total, message) => {
                    try {
                        server.server
                            .notification({
                            method: "notifications/progress",
                            params: {
                                progressToken,
                                progress,
                                total,
                                message
                            }
                        })
                            .catch(() => { });
                    }
                    catch {
                        // Non-fatal
                    }
                }
                : undefined;
            const childRecord = await session.revise(args, onProgress);
            const contentBlocks = [
                {
                    type: "text",
                    text: JSON.stringify({
                        runId: childRecord.runId,
                        parentRunId: childRecord.parentRunId,
                        status: childRecord.status,
                        promptIds: childRecord.promptIds,
                        note: childRecord.note,
                        candidateCount: childRecord.candidates.length,
                        candidates: childRecord.candidates.map((c) => ({
                            index: c.index,
                            filename: c.filename,
                            nodeId: c.nodeId,
                            mediaType: c.mediaType,
                            seed: c.seed,
                            url: c.url
                        })),
                        error: childRecord.error
                    }, null, 2)
                }
            ];
            // Include side-by-side comparison or candidate image if completed
            if (childRecord.status === "completed" && childRecord.candidates.length > 0) {
                try {
                    const inspectRes = await session.inspect({
                        runId: childRecord.runId,
                        mode: "compare"
                    });
                    if (inspectRes.imageContent) {
                        contentBlocks.push(inspectRes.imageContent);
                    }
                }
                catch {
                    // Fallback to single candidate image if compare fails
                    try {
                        const inspectSingle = await session.inspect({
                            runId: childRecord.runId,
                            mode: "image"
                        });
                        if (inspectSingle.imageContent) {
                            contentBlocks.push(inspectSingle.imageContent);
                        }
                    }
                    catch {
                        // Non-fatal
                    }
                }
            }
            return {
                content: contentBlocks
            };
        }
        catch (err) {
            return {
                isError: true,
                content: [{ type: "text", text: `comfy_revise failed: ${err.message || String(err)}` }]
            };
        }
    });
    // 9. comfy_job
    server.registerTool("comfy_job", {
        title: "Check Status, Wait, or Cancel Job",
        description: "Query status, wait with timeout, or cancel an active ComfyUI run or prompt by run ID or prompt ID.",
        inputSchema: ComfyJobInputSchema.shape
    }, async (args) => {
        try {
            const runRecord = await session.job(args);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            runId: runRecord.runId,
                            parentRunId: runRecord.parentRunId,
                            status: runRecord.status,
                            progress: runRecord.progress,
                            promptIds: runRecord.promptIds,
                            candidateCount: runRecord.candidates.length,
                            candidates: runRecord.candidates.map((c) => ({
                                index: c.index,
                                filename: c.filename,
                                nodeId: c.nodeId,
                                mediaType: c.mediaType,
                                seed: c.seed,
                                url: c.url
                            })),
                            error: runRecord.error,
                            createdAt: runRecord.createdAt,
                            completedAt: runRecord.completedAt
                        }, null, 2)
                    }
                ]
            };
        }
        catch (err) {
            return {
                isError: true,
                content: [{ type: "text", text: `comfy_job failed: ${err.message || String(err)}` }]
            };
        }
    });
    return server;
}
/**
 * Start stdio MCP server transport
 */
export async function startComfyMcpStdioServer(options = {}) {
    const server = createComfyMcpServer(options);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return server;
}
//# sourceMappingURL=server.js.map