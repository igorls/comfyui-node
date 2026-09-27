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
 * Close the server when its input ends, and destroy the ComfyUI client if the server owns it.
 *
 * An MCP host signals that it is done by closing the server's stdin (it exited, restarted, or
 * dropped the server). The ComfyUI WebSocket would otherwise keep the process alive, leaving an
 * orphaned server behind after every host restart.
 *
 * @returns a function that runs the same shutdown on demand (idempotent)
 */
export declare function closeWhenInputEnds(input: Pick<NodeJS.EventEmitter, "once">, server: Pick<McpServer, "close">, ownedClient?: Pick<ComfyApi, "destroy">): () => Promise<void>;
/**
 * Start stdio MCP server transport. The server shuts down, and releases the ComfyUI client it
 * created, when stdin ends; a client passed in through `options.client` is left to its owner.
 */
export declare function startComfyMcpStdioServer(options?: ComfyMcpServerOptions): Promise<McpServer>;
//# sourceMappingURL=server.d.ts.map