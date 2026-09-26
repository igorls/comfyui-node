import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ComfyApi } from "../client.js";
import { WorkflowCatalog } from "./workflow-catalog.js";
import { McpGenerationSession } from "./generation-session.js";
export interface ComfyMcpServerOptions {
    comfyUrl?: string;
    workflowDirs?: string[];
    client?: ComfyApi;
    session?: McpGenerationSession;
    catalog?: WorkflowCatalog;
    debug?: boolean;
    name?: string;
    version?: string;
}
/**
 * Factory creating the ComfyUI MCP Server instance with authoring, validation, and execution tools
 */
export declare function createComfyMcpServer(options?: ComfyMcpServerOptions): McpServer;
/**
 * Start stdio MCP server transport
 */
export declare function startComfyMcpStdioServer(options?: ComfyMcpServerOptions): Promise<McpServer>;
//# sourceMappingURL=server.d.ts.map