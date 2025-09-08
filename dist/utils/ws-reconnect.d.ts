import { ComfyApi } from "../client.js";
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
export interface ReconnectController {
    abort: () => void;
    attempts: () => number;
}
export declare function runWebSocketReconnect(api: ComfyApi, factory: () => void, opts?: ReconnectOptions): ReconnectController;
//# sourceMappingURL=ws-reconnect.d.ts.map