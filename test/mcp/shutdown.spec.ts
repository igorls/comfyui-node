import { afterEach, describe, expect, it } from "bun:test";
import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import path from "path";
import { closeWhenInputEnds } from "../../src/mcp/server.js";

describe("closeWhenInputEnds", () => {
  function fakes() {
    const calls = { close: 0, destroy: 0 };
    const server = { close: async () => void calls.close++ };
    const client = { destroy: () => void calls.destroy++ };
    return { calls, server, client };
  }

  it("closes the server and destroys the owned client when input ends", async () => {
    const input = new EventEmitter();
    const { calls, server, client } = fakes();
    closeWhenInputEnds(input, server as any, client as any);

    input.emit("end");
    input.emit("close"); // hosts often send both; shutdown must run once
    await Bun.sleep(10);

    expect(calls).toEqual({ close: 1, destroy: 1 });
  });

  it("leaves a caller-provided client alone", async () => {
    const input = new EventEmitter();
    const { calls, server } = fakes();
    closeWhenInputEnds(input, server as any);

    input.emit("close");
    await Bun.sleep(10);

    expect(calls).toEqual({ close: 1, destroy: 0 });
  });

  it("still destroys the client when closing the server throws", async () => {
    const input = new EventEmitter();
    let destroyed = 0;
    closeWhenInputEnds(
      input,
      { close: async () => { throw new Error("transport already closed"); } } as any,
      { destroy: () => void destroyed++ } as any
    );

    input.emit("end");
    await Bun.sleep(10);

    expect(destroyed).toBe(1);
  });
});

describe("stdio CLI lifecycle", () => {
  const binPath = path.resolve("./dist/bin/comfyui-node.js");
  let child: ChildProcess | undefined;
  let comfy: ReturnType<typeof Bun.serve> | undefined;

  afterEach(() => {
    child?.kill();
    comfy?.stop(true);
  });

  /** Just enough of ComfyUI for the client to finish init() and hold its event WebSocket open. */
  function fakeComfy() {
    let sockets = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req, srv) {
        const { pathname } = new URL(req.url);
        if (pathname === "/ws" && srv.upgrade(req)) return;
        if (pathname === "/system_stats") return Response.json({ system: { os: "test" }, devices: [] });
        if (pathname === "/queue") return Response.json({ queue_running: [], queue_pending: [] });
        if (pathname === "/prompt") return Response.json({ exec_info: { queue_remaining: 0 } });
        return Response.json({});
      },
      websocket: {
        open() {
          sockets++;
        },
        message() {}
      }
    });
    return { server, sockets: () => sockets };
  }

  it("exits after its input closes, even with a live ComfyUI WebSocket", async () => {
    const fake = fakeComfy();
    comfy = fake.server;
    child = spawn(process.execPath, [binPath, "--url", `http://127.0.0.1:${fake.server.port}`, "--workflow-dir", "./test"]);

    let stdout = "";
    child.stdout!.on("data", d => (stdout += d.toString()));
    const send = (msg: object) => child!.stdin!.write(`${JSON.stringify(msg)}\n`);
    const waitFor = async (check: () => boolean, label: string, timeoutMs = 8000) => {
      const start = Date.now();
      while (!check()) {
        if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
        await Bun.sleep(25);
      }
    };

    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "lifecycle-test", version: "0" } } });
    await waitFor(() => stdout.includes('"id":1'), "initialize response");
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "comfy_info", arguments: { includeModels: false } } });
    await waitFor(() => stdout.includes('"id":2'), "comfy_info response");
    await waitFor(() => fake.sockets() > 0, "event WebSocket to open");

    const exited = new Promise<number | null>(resolve => child!.once("exit", code => resolve(code)));
    const closedAt = Date.now();
    child.stdin!.end();

    const code = await Promise.race([exited, Bun.sleep(5000).then(() => "still running" as const)]);
    expect(code).toBe(0);
    expect(Date.now() - closedAt).toBeLessThan(5000);
  }, 20000);
});
