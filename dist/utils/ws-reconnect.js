import { WebSocket } from "ws";
export function runWebSocketReconnect(api, factory, opts = {}) {
    const { maxAttempts = 10, baseDelayMs = 1000, maxDelayMs = 15000, strategy = "exponential", customDelayFn, jitterPercent = 30, triggerEvents, scheduler = setTimeout } = opts;
    if (triggerEvents) {
        api.dispatchEvent(new CustomEvent("disconnected"));
        api.dispatchEvent(new CustomEvent("reconnecting"));
    }
    let attempt = 0;
    let aborted = false;
    let pendingTimer = null;
    const computeDelay = () => {
        if (strategy === "custom" && customDelayFn) {
            return Math.max(0, customDelayFn(attempt, { baseDelayMs, maxDelayMs }));
        }
        let raw;
        if (strategy === "linear") {
            raw = Math.min(baseDelayMs * attempt, maxDelayMs);
        }
        else { // exponential
            raw = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
        }
        if (jitterPercent > 0) {
            const jitter = raw * (jitterPercent / 100) * (Math.random() - 0.5);
            raw = raw + jitter;
        }
        return Math.max(0, raw);
    };
    const tryReconnect = () => {
        if (aborted)
            return;
        attempt++;
        api.dispatchEvent(new CustomEvent("log", { detail: { fnName: "ws-reconnect", message: `Attempt #${attempt}` } }));
        // Clean up existing socket if present
        const socket = api.socket;
        if (socket) {
            try {
                if (typeof socket.terminate === "function")
                    socket.terminate();
                socket.close?.();
            }
            catch { /* ignore */ }
            api.socket = null;
        }
        try {
            factory();
        }
        catch (err) {
            api.dispatchEvent(new CustomEvent("log", { detail: { fnName: "ws-reconnect", message: "Factory error", data: err } }));
        }
        if (!aborted && attempt < maxAttempts) {
            const delay = computeDelay();
            pendingTimer = scheduler(() => {
                if (aborted)
                    return;
                const s = api.socket;
                if (!s) {
                    tryReconnect();
                }
                else if (s.readyState === WebSocket.OPEN || s.readyState === WebSocket.CONNECTING) {
                    api.dispatchEvent(new CustomEvent("log", { detail: { fnName: "ws-reconnect", message: "Reconnection successful" } }));
                }
                else {
                    tryReconnect();
                }
            }, delay);
        }
        else {
            if (!aborted) {
                api.dispatchEvent(new CustomEvent("reconnection_failed"));
            }
        }
    };
    tryReconnect();
    return {
        abort() {
            if (aborted)
                return;
            aborted = true;
            if (pendingTimer && typeof pendingTimer === "object" && "ref" in pendingTimer) {
                // Node.js Timeout object: clear via clearTimeout
                try {
                    clearTimeout(pendingTimer);
                }
                catch { }
            }
            api.dispatchEvent(new CustomEvent("log", { detail: { fnName: "ws-reconnect", message: "Reconnection aborted" } }));
        },
        attempts() { return attempt; }
    };
}
//# sourceMappingURL=ws-reconnect.js.map