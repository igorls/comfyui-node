import { describe, it, expect } from "bun:test";
import { spawn } from "child_process";
import path from "path";
import pkg from "../../package.json" with { type: "json" };

describe("stdio CLI executable integration", () => {
  const binPath = path.resolve("./dist/bin/comfyui-node.js");

  it("handles --help flag via stderr and exits with 0", async () => {
    const child = spawn(process.execPath, [binPath, "--help"]);

    let stderr = "";
    let stdout = "";

    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });

    const exitCode = await new Promise<number>((resolve) => {
      child.on("exit", (code) => resolve(code ?? 0));
    });

    expect(exitCode).toBe(0);
    expect(stderr).toContain("comfyui-node MCP Server");
    expect(stderr).toContain("Options:");
    expect(stdout).toBe(""); // stdout strictly empty
  });

  it("handles --version flag via stderr and exits with 0", async () => {
    const child = spawn(process.execPath, [binPath, "--version"]);

    let stderr = "";
    let stdout = "";

    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });

    const exitCode = await new Promise<number>((resolve) => {
      child.on("exit", (code) => resolve(code ?? 0));
    });

    expect(exitCode).toBe(0);
    expect(stderr).toContain(`comfyui-node v${pkg.version}`);
    expect(stdout).toBe(""); // stdout strictly empty
  });

  it("performs MCP initialize and tools/list handshake over stdio", async () => {
    const child = spawn(process.execPath, [binPath, "--workflow-dir", "./test"]);

    let buffer = "";
    const messages: any[] = [];

    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          try {
            messages.push(JSON.parse(trimmed));
          } catch {
            // Ignore non-json lines if any
          }
        }
      }
    });

    // Send initialize request
    const initReq = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "test-integration-agent",
          version: "1.0.0"
        }
      }
    });
    child.stdin.write(`${initReq}\n`);

    // Wait for initialize response
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timeout waiting for initialize response")), 10000);
      const interval = setInterval(() => {
        const initResp = messages.find((m) => m.id === 1);
        if (initResp) {
          clearTimeout(timeout);
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });

    const initResp = messages.find((m) => m.id === 1);
    expect(initResp).toBeDefined();
    expect(initResp.result).toBeDefined();
    expect(initResp.result.serverInfo.name).toBe("comfyui-node");
    expect(initResp.result.serverInfo.version).toBe(pkg.version);
    expect(initResp.result.capabilities.tools).toBeDefined();

    // Send initialized notification
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

    // Send tools/list request
    const toolsReq = JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {}
    });
    child.stdin.write(`${toolsReq}\n`);

    // Wait for tools/list response
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timeout waiting for tools/list response")), 10000);
      const interval = setInterval(() => {
        const toolsResp = messages.find((m) => m.id === 2);
        if (toolsResp) {
          clearTimeout(timeout);
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });

    const toolsResp = messages.find((m) => m.id === 2);
    expect(toolsResp).toBeDefined();
    expect(toolsResp.result).toBeDefined();
    expect(toolsResp.result.tools).toHaveLength(9);

    const toolNames = toolsResp.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain("comfy_info");
    expect(toolNames).toContain("comfy_nodes");
    expect(toolNames).toContain("comfy_recipes");
    expect(toolNames).toContain("comfy_validate");
    expect(toolNames).toContain("comfy_workflows");
    expect(toolNames).toContain("comfy_generate");
    expect(toolNames).toContain("comfy_inspect");
    expect(toolNames).toContain("comfy_revise");
    expect(toolNames).toContain("comfy_job");

    child.kill();
  });
});
