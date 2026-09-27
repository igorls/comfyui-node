#!/usr/bin/env node
import { startComfyMcpStdioServer } from "../mcp/server.js";
import { packageVersion } from "../mcp/package-version.js";
/** How long a closed-input server may take to release its handles before the CLI exits anyway. */
const EXIT_GRACE_MS = 2000;
function parseArgs() {
    const args = process.argv.slice(2);
    let comfyUrl = process.env.COMFYUI_URL || "http://127.0.0.1:8188";
    const workflowDirs = process.env.COMFYUI_WORKFLOW_DIR
        ? [process.env.COMFYUI_WORKFLOW_DIR]
        : [];
    let debug = false;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "mcp") {
            // Optional positional subcommand, ignore and continue
            continue;
        }
        else if (arg === "--url" && i + 1 < args.length) {
            comfyUrl = args[++i];
        }
        else if ((arg === "--workflow-dir" || arg === "-w") && i + 1 < args.length) {
            workflowDirs.push(args[++i]);
        }
        else if (arg === "--debug") {
            debug = true;
        }
        else if (arg === "--help" || arg === "-h") {
            process.stderr.write(`
comfyui-node MCP Server

Usage:
  npx -y comfyui-node [options]
  bunx comfyui-node [options]

Options:
  --url <url>             ComfyUI server URL (default: http://127.0.0.1:8188 or COMFYUI_URL)
  --workflow-dir <dir>    Workflow directory to scan (repeatable or COMFYUI_WORKFLOW_DIR)
  --debug                 Output debug diagnostic logs to stderr
  --help, -h              Show this help message
  --version, -v           Show version information

MCP Transport:
  Communicates over standard input/output (stdio) via Model Context Protocol.
`);
            process.exit(0);
        }
        else if (arg === "--version" || arg === "-v") {
            process.stderr.write(`comfyui-node v${packageVersion()}\n`);
            process.exit(0);
        }
    }
    if (workflowDirs.length === 0) {
        workflowDirs.push("./workflows", "./test");
    }
    return { comfyUrl, workflowDirs, debug };
}
async function main() {
    const { comfyUrl, workflowDirs, debug } = parseArgs();
    if (debug) {
        process.stderr.write(`[comfyui-node MCP] Starting stdio server on ${comfyUrl}, scanning workflow dirs: ${workflowDirs.join(", ")}\n`);
    }
    try {
        await startComfyMcpStdioServer({
            comfyUrl,
            workflowDirs,
            debug
        });
        if (debug) {
            process.stderr.write("[comfyui-node MCP] Server connected to stdio transport.\n");
        }
        // The server releases its ComfyUI client when stdin ends; if anything else still holds the
        // event loop after that, exit anyway rather than linger as an orphan of a departed host.
        process.stdin.once("end", () => {
            setTimeout(() => process.exit(0), EXIT_GRACE_MS).unref();
        });
    }
    catch (err) {
        process.stderr.write(`[comfyui-node MCP] Fatal error starting server: ${err.message || String(err)}\n`);
        process.exit(1);
    }
}
main().catch((err) => {
    process.stderr.write(`[comfyui-node MCP] Unhandled error: ${err.message || String(err)}\n`);
    process.exit(1);
});
//# sourceMappingURL=comfyui-node.js.map