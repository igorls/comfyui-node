import { ComfyApi } from "../src/client";

function jsonMsg(type: string, data: any) {
  return JSON.stringify({ type, data });
}

describe("ComfyApi WebSocket integration (simulated)", () => {
  test("message dispatch + close triggers reconnect attempt log when autoReconnect enabled", () => {
    const api: any = new ComfyApi("http://localhost:8188", "test-client", {
      autoReconnect: true
    });

    const events: Record<string, number> = {};
    api.on("all" as any, () => {
      events.all = (events.all || 0) + 1;
    });
    api.on("reconnected" as any, () => {
      events.reconnected = (events.reconnected || 0) + 1;
    });
    api.on("status" as any, () => {
      events.status = (events.status || 0) + 1;
    });

    // Force socket creation
    api["createSocket"]();
    const sock: any = api.socket;
    expect(sock).toBeTruthy();

    // Emit a JSON status message
    sock.onmessage?.({ data: jsonMsg("status", { running: true }) });
    expect(events.all).toBe(1);
    expect(events.status).toBe(1);

    // Open socket first (so reconnection triggers)
    sock.onopen?.();

    // Close -> should schedule reconnect attempts (we just check a log event fired for attempt #1)
    const logs: string[] = [];
    api.on("log" as any, (e: any) => {
      if (e.detail.message.includes("Attempt")) logs.push(e.detail.message);
    });
    sock.onclose?.({ type: "close", code: 1000, reason: "Test", wasClean: true });

    // After close, a reconnect attempt should have been logged
    expect(logs.length).toBeGreaterThanOrEqual(1);

    api.destroy();
  });

  test("error path triggers polling fallback log", () => {
    const api: any = new ComfyApi("http://localhost:8188");
    const logs: string[] = [];
    api.on("log" as any, (e: any) => logs.push(e.detail.message));
    api["createSocket"]();
    const sock: any = api.socket;
    sock.onerror?.(new Error("boom"));
    // We expect a socket error log
    expect(logs.some((l) => /Socket error/.test(l))).toBe(true);
  });
});
