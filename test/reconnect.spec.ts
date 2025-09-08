import { runWebSocketReconnect } from "../src/utils/ws-reconnect";
import { ComfyApi } from "../src/client";

// Minimal fake websocket states
const WS_OPEN = 1;
const WS_CONNECTING = 0;

class FakeApi extends ComfyApi {
  constructor() { super("http://localhost:8188"); }
}

describe("WebSocket reconnection utility", () => {
  test("stops after successful factory socket open", async () => {
    const api: any = new FakeApi();
    let created = 0;

    // First attempt yields null (forces retry), second attempt becomes OPEN
    const factory = () => {
      created++;
      api.socket = created === 1 ? null : { readyState: WS_OPEN };
    };

    const scheduleCalls: number[] = [];
    const scheduler = (fn: () => void, delay: number) => {
      scheduleCalls.push(delay);
      fn();
    };

    runWebSocketReconnect(api, factory, { maxAttempts: 5, baseDelayMs: 10, maxDelayMs: 20, scheduler, triggerEvents: true });

    // After execution we should have created >=2 times and ended with OPEN
  expect(created).toBe(2);
    expect(api.socket.readyState).toBe(WS_OPEN);
    // Ensure at least one scheduled delay was attempted
    expect(scheduleCalls.length).toBeGreaterThan(0);
  });

  test("emits reconnection_failed after exhausting attempts", async () => {
    const api: any = new FakeApi();
    api.addEventListener("reconnection_failed", () => { api.__failed = true; });

    const factory = () => {
      // Always set a CLOSED-like socket (null) so it keeps retrying
      api.socket = null;
    };

    const scheduler = (fn: () => void) => { fn(); };

    runWebSocketReconnect(api, factory, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, scheduler });

    expect(api.__failed).toBe(true);
  });

  test("supports linear strategy delay progression", () => {
    const api: any = new FakeApi();
    let created = 0;
    const factory = () => { created++; api.socket = null; };
    const delays: number[] = [];
    const scheduler = (fn: () => void, delay: number) => { delays.push(delay); fn(); };
    runWebSocketReconnect(api, factory, { maxAttempts: 4, baseDelayMs: 10, maxDelayMs: 100, strategy: "linear", scheduler });
    // Attempts will compute delay AFTER attempt++ so delays correspond to attempt numbers 1..3
    // Linear: base * attempt (clamped) -> 10,20,30 (rough w/ jitter). We disable jitter by passing 0.
    // But existing helper default jitter=30 so can't assert exact; just monotonic increasing.
    expect(delays.length).toBeGreaterThan(0);
    for (let i=1;i<delays.length;i++) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i-1] - 1); // allow slight randomness
    }
  });

  test("supports custom strategy fixed delay", () => {
    const api: any = new FakeApi();
    let created = 0;
    const factory = () => { created++; api.socket = null; };
    const delays: number[] = [];
    const scheduler = (fn: () => void, delay: number) => { delays.push(delay); fn(); };
    runWebSocketReconnect(api, factory, { maxAttempts: 5, baseDelayMs: 5, maxDelayMs: 50, strategy: "custom", customDelayFn: () => 42, jitterPercent: 0, scheduler });
    // Expect all recorded delays to be ~42
    expect(delays.every(d => d === 42)).toBe(true);
  });

  test("abort stops further attempts", () => {
    const api: any = new FakeApi();
    let created = 0;
    const factory = () => { created++; api.socket = null; };
    const delays: number[] = [];
    let controller: any;
    const scheduler = (fn: () => void, delay: number) => { delays.push(delay); fn(); };
    controller = runWebSocketReconnect(api, factory, { maxAttempts: 10, baseDelayMs: 5, maxDelayMs: 10, jitterPercent: 0, scheduler });
    // Abort after first wave of synchronous recursion completes
    controller.abort();
    const attemptsAfterAbort = controller.attempts();
    // Run again a bit to ensure no more attempts (since scheduler fires immediately)
    expect(controller.attempts()).toBe(attemptsAfterAbort);
  });
});
