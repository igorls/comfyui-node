import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { ComfyApi } from "../src/client";

/**
 * Regression tests for event sockets that silently stop delivering events after the
 * ComfyUI server restarts. They run against real local servers rather than mocks, since
 * the failures depend on actual socket lifecycles.
 */

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) {
    try {
      cleanups.pop()!();
    } catch {
      // best-effort teardown
    }
  }
});

async function waitFor(condition: () => boolean, timeoutMs = 4000, label = "condition"): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await Bun.sleep(20);
  }
}

/** A minimal ComfyUI-like /ws endpoint that can be stopped and restarted on the same port. */
function restartableWsServer() {
  let opens = 0;
  let upgrades = 0;
  let server: ReturnType<typeof Bun.serve> | null = null;
  let port = 0;
  const start = () => {
    server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch(req, srv) {
        if (req.headers.get("upgrade") === "websocket") upgrades++;
        if (srv.upgrade(req)) return;
        return new Response("not found", { status: 404 });
      },
      websocket: {
        open() {
          opens++;
        },
        message() {}
      }
    });
    port = server.port!;
  };
  start();
  cleanups.push(() => server?.stop(true));
  return {
    get port() {
      return port;
    },
    get opens() {
      return opens;
    },
    /** Connection attempts, including ones torn down before they opened. */
    get upgrades() {
      return upgrades;
    },
    stop: () => server?.stop(true),
    start
  };
}

function client(port: number, opts: ConstructorParameters<typeof ComfyApi>[2] = {}) {
  const api = new ComfyApi(`http://127.0.0.1:${port}`, `liveness-${crypto.randomUUID()}`, {
    reconnect: { baseDelayMs: 20, maxDelayMs: 50, jitterPercent: 0, maxAttempts: 50 },
    ...opts
  });
  cleanups.push(() => api.destroy());
  return api;
}

describe("WebSocket liveness", () => {
  test("reconnects every time the server restarts, not only the first", async () => {
    const server = restartableWsServer();
    const api = client(server.port);
    (api as any).createSocket();
    await waitFor(() => api.isConnected(), 4000, "initial connection");

    for (let restart = 1; restart <= 3; restart++) {
      // Let the previous reconnect loop finish first. In production drops are minutes apart,
      // so the socket that drops next is always one the loop already handed over and forgot.
      await Bun.sleep(300);
      server.stop();
      await waitFor(() => !api.isConnected(), 4000, `drop #${restart}`);
      server.start();
      await waitFor(() => api.isConnected() && server.opens === restart + 1, 4000, `reconnect #${restart}`);
    }
    expect(api.connectionState).toBe("connected");
  });

  test("detects a socket whose peer stopped answering and reconnects", async () => {
    // A raw TCP server that completes the WebSocket handshake and then goes silent: it never
    // answers pings and never closes. This is what a socket looks like after its server went away
    // without the client seeing a close frame.
    let handshakes = 0;
    const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    const tcp = Bun.listen<{ upgraded: boolean }>({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(sock) {
          sock.data = { upgraded: false };
        },
        data(sock, data) {
          if (sock.data.upgraded) return; // swallow every frame, including pings
          const key = /Sec-WebSocket-Key:\s*(\S+)/i.exec(data.toString())?.[1];
          if (!key) return;
          const accept = createHash("sha1").update(key + GUID).digest("base64");
          sock.write(
            `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
          );
          sock.data.upgraded = true;
          handshakes++;
        }
      }
    });
    cleanups.push(() => tcp.stop(true));

    const api = client(tcp.port, { wsTimeout: 300 });
    (api as any).createSocket();
    await waitFor(() => handshakes === 1 && api.isConnected(), 4000, "zombie handshake");
    await waitFor(() => handshakes >= 2, 8000, "reconnect after unanswered ping");
  }, 15000);

  test("reconnectWs replaces a live socket with exactly one new socket", async () => {
    const server = restartableWsServer();
    const api = client(server.port);
    (api as any).createSocket();
    await waitFor(() => api.isConnected(), 4000, "initial connection");

    await api.reconnectWs();
    await waitFor(() => api.isConnected() && server.opens === 2, 4000, "replacement socket");
    // The old socket's close handler must not start another reconnect that tears this one down.
    await Bun.sleep(500);
    expect(server.upgrades).toBe(2);
    expect(server.opens).toBe(2);
    expect(api.isConnected()).toBe(true);
  });

  test("a closed socket left in place does not block creating a new one", async () => {
    const server = restartableWsServer();
    const api = client(server.port);
    (api as any).socket = {
      readyState: 3, // CLOSED
      onclose: null,
      onerror: null,
      onmessage: null,
      onopen: null,
      close() {},
      terminate() {}
    };
    (api as any).createSocket();
    await waitFor(() => api.isConnected() && server.opens === 1, 4000, "new socket");
  });
});
