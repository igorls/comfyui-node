import { WebSocket } from "ws";
import { ComfyApi } from "../client";

export interface ReconnectOptions {
  /** Maximum reconnection attempts before giving up (default 10) */
  maxAttempts?: number;
  /** Base delay in ms for backoff (default 1000) */
  baseDelayMs?: number;
  /** Maximum delay cap in ms (default 15000) */
  maxDelayMs?: number;
  /** Backoff strategy: exponential | linear | custom (default exponential) */
  strategy?: "exponential" | "linear" | "custom";
  /** Optional custom delay function: (attempt, opts) => ms (used when strategy==='custom') */
  customDelayFn?: (attempt: number, opts: Required<Pick<ReconnectOptions, "baseDelayMs" | "maxDelayMs">>) => number;
  /** Jitter percent (0 disables jitter). Default 30 (%) for exponential/linear */
  jitterPercent?: number;
  /** Emit disconnected/reconnecting events before first attempt */
  triggerEvents?: boolean;
  /** Custom scheduler for tests (signature mirrors setTimeout) */
  scheduler?: (fn: () => void, delay: number) => any;
}

/**
 * Exponential backoff (with ±30% jitter) WebSocket reconnection loop.
 * Delegates actual socket recreation to the provided factory (typically client.createSocket(true)).
 */
export interface ReconnectController { abort: () => void; attempts: () => number; }

export function runWebSocketReconnect(api: ComfyApi, factory: () => void, opts: ReconnectOptions = {}): ReconnectController {
  const {
    maxAttempts = 10,
    baseDelayMs = 1000,
    maxDelayMs = 15000,
    strategy = "exponential",
    customDelayFn,
    jitterPercent = 30,
    triggerEvents,
    scheduler = setTimeout
  } = opts;

  if (triggerEvents) {
    api.dispatchEvent(new CustomEvent("disconnected"));
    api.dispatchEvent(new CustomEvent("reconnecting"));
  }

  let attempt = 0;
  let aborted = false;
  let pendingTimer: any = null;

  const computeDelay = (): number => {
    if (strategy === "custom" && customDelayFn) {
      return Math.max(0, customDelayFn(attempt, { baseDelayMs, maxDelayMs }));
    }
    let raw: number;
    if (strategy === "linear") {
      raw = Math.min(baseDelayMs * attempt, maxDelayMs);
    } else { // exponential
      raw = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
    }
    if (jitterPercent > 0) {
      const jitter = raw * (jitterPercent / 100) * (Math.random() - 0.5);
      raw = raw + jitter;
    }
    return Math.max(0, raw);
  };

  const tryReconnect = () => {
    if (aborted) return;
    attempt++;
    api.dispatchEvent(new CustomEvent("log", { detail: { fnName: "ws-reconnect", message: `Attempt #${attempt}` } }));

    // Clean up existing socket if present
    const socket: any = (api as any).socket;
    if (socket) {
      try {
        if (typeof socket.terminate === "function") socket.terminate();
        socket.close?.();
      } catch {/* ignore */}
      (api as any).socket = null;
    }

    try {
      factory();
    } catch (err) {
      api.dispatchEvent(new CustomEvent("log", { detail: { fnName: "ws-reconnect", message: "Factory error", data: err } }));
    }

    if (!aborted && attempt < maxAttempts) {
      const delay = computeDelay();
      pendingTimer = scheduler(() => {
        if (aborted) return;
        const s: WebSocket | null = (api as any).socket;
        if (!s) {
          tryReconnect();
        } else if (s.readyState === WebSocket.OPEN || s.readyState === WebSocket.CONNECTING) {
          api.dispatchEvent(new CustomEvent("log", { detail: { fnName: "ws-reconnect", message: "Reconnection successful" } }));
        } else {
          tryReconnect();
        }
      }, delay);
    } else {
      if (!aborted) {
        api.dispatchEvent(new CustomEvent("reconnection_failed"));
      }
    }
  };

  tryReconnect();
  return {
    abort() {
      if (aborted) return;
      aborted = true;
      if (pendingTimer && typeof pendingTimer === "object" && "ref" in pendingTimer) {
        // Node.js Timeout object: clear via clearTimeout
        try { clearTimeout(pendingTimer as any); } catch {}
      }
      api.dispatchEvent(new CustomEvent("log", { detail: { fnName: "ws-reconnect", message: "Reconnection aborted" } }));
    },
    attempts() { return attempt; }
  };
}
