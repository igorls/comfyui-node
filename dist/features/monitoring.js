import { AbstractFeature } from "./abstract.js";
// Crystools exposes a node named exactly: "Primitive boolean [Crystools]"
// Original implementation encoded the name before querying object_info which caused
// lookups to fail on some servers (object_info expects the raw node name segment).
// We'll keep both raw and encoded forms for defensive compatibility.
const SYSTEM_MONITOR_RAW = "Primitive boolean [Crystools]";
const SYSTEM_MONITOR_ENCODED = encodeURIComponent(SYSTEM_MONITOR_RAW);
/** Crystools system monitoring (GPU/CPU/RAM/HDD + streaming events). */
export class MonitoringFeature extends AbstractFeature {
    resources;
    listeners = [];
    bound = false;
    /** Enable verbose debug logs (env: COMFY_MONITOR_DEBUG=1) */
    debug = false;
    constructor(client) {
        super(client);
        // Detect debug flag (works in Node; ignored in browsers unless global set)
        try {
            // @ts-ignore
            if (typeof process !== "undefined" && process?.env?.COMFY_MONITOR_DEBUG)
                this.debug = true;
            // Allow global override (e.g., globalThis.COMFY_MONITOR_DEBUG = true)
            // @ts-ignore
            if (typeof globalThis !== "undefined" && globalThis.COMFY_MONITOR_DEBUG)
                this.debug = true;
        }
        catch { }
        // Always bind early in sniff mode so that even if feature probing fails we can auto‑promote on first event.
        this.bind(true);
    }
    async checkSupported() {
        if (this.supported)
            return true;
        const debug = (...args) => this.debug && console.log("[monitoring]", ...args);
        let matched = false;
        // Heuristic 1: Encoded (original implementation behaviour)
        try {
            const enc = await this.client.ext.node.getNodeDefs(SYSTEM_MONITOR_ENCODED);
            if (enc && enc[SYSTEM_MONITOR_ENCODED]) {
                matched = true;
                debug("Detected via encoded node name");
            }
        }
        catch (e) {
            const err = e;
            debug("Encoded lookup failed", err?.message || err);
        }
        // Heuristic 2: Raw name
        if (!matched) {
            try {
                const raw = await this.client.ext.node.getNodeDefs(SYSTEM_MONITOR_RAW);
                if (raw && raw[SYSTEM_MONITOR_RAW]) {
                    matched = true;
                    debug("Detected via raw node name");
                }
            }
            catch (e) {
                const err = e;
                debug("Raw lookup failed", err?.message || err);
            }
        }
        // Heuristic 3: REST endpoint probe
        if (!matched) {
            try {
                const res = await this.client.fetchApi(`/api/crystools/monitor`);
                if (res && res.ok) {
                    matched = true;
                    debug("Detected via /api/crystools/monitor endpoint");
                }
                else {
                    debug("Monitor endpoint status", res?.status);
                }
            }
            catch (e) {
                const err = e;
                debug("Endpoint probe failed", err?.message || err);
            }
        }
        // Heuristic 4: Global node scan (last resort)
        if (!matched) {
            try {
                const all = await this.client.ext.node.getNodeDefs();
                if (all) {
                    for (const key of Object.keys(all)) {
                        const lower = key.toLowerCase();
                        if (lower.includes("crystools") && (lower.includes("boolean") || lower.includes("monitor"))) {
                            matched = true;
                            debug("Detected via global scan key=", key);
                            break;
                        }
                    }
                }
            }
            catch (e) {
                const err = e;
                debug("Global scan failed", err?.message || err);
            }
        }
        if (matched) {
            this.supported = true;
            // Ensure binding (already bound in constructor sniff mode, but keep call for future logic consistency)
            this.bind();
        }
        else {
            debug("Not detected during probing – will rely on runtime event sniffing");
        }
        return this.supported;
    }
    destroy() {
        this.listeners.forEach((listener) => {
            this.off(listener.event, listener.handler, listener.options);
        });
        this.listeners = [];
    }
    async fetchApi(path, options) {
        if (!this.supported) {
            return false;
        }
        return this.client.fetchApi(path, options);
    }
    on(type, callback, options) {
        this.addEventListener(type, callback, options);
        this.listeners.push({ event: type, options, handler: callback });
        return () => this.off(type, callback);
    }
    off(type, callback, options) {
        this.removeEventListener(type, callback, options);
        this.listeners = this.listeners.filter((listener) => listener.event !== type && listener.handler !== callback);
    }
    /**
     * Gets the monitor data.
     *
     * @returns The monitor data if supported, otherwise false.
     */
    get monitorData() {
        if (!this.supported) {
            return false;
        }
        return this.resources;
    }
    /**
     * Sets the monitor configuration.
     */
    async setConfig(config) {
        if (!this.supported) {
            return false;
        }
        return this.fetchApi(`/api/crystools/monitor`, {
            method: "PATCH",
            body: JSON.stringify(config)
        });
    }
    /**
     * Switches the monitor on or off.
     */
    async switch(active) {
        if (!this.supported) {
            return false;
        }
        return this.fetchApi(`/api/crystools/monitor/switch`, {
            method: "POST",
            body: JSON.stringify({ monitor: active })
        });
    }
    /**
     * Gets the list of HDDs.
     */
    async getHddList() {
        if (!this.supported) {
            return null;
        }
        const data = await this.fetchApi(`/api/crystools/monitor/HDD`);
        if (data) {
            return data.json();
        }
        return null;
    }
    /**
     * Gets the list of GPUs.
     */
    async getGpuList() {
        if (!this.supported) {
            return null;
        }
        const data = await this.fetchApi(`/api/crystools/monitor/GPU`);
        if (data) {
            return data.json();
        }
        return null;
    }
    /**
     * Config gpu monitoring
     * @param index Index of the GPU
     * @param config Configuration of monitoring, set to `true` to enable monitoring
     */
    async setGpuConfig(index, config) {
        if (!this.supported) {
            return false;
        }
        return this.fetchApi(`/api/crystools/monitor/GPU/${index}`, {
            method: "PATCH",
            body: JSON.stringify(config)
        });
    }
    bind(sniffOnly = false) {
        if (this.bound)
            return;
        this.bound = true;
        const debug = (...args) => this.debug && console.log("[monitoring]", ...args);
        const seenTypes = new Set();
        this.client.on("all", (ev) => {
            const msg = ev.detail;
            if (!msg || !msg.type)
                return;
            // Debug: log first 30 distinct types when debugging
            if (this.debug && seenTypes.size < 30 && !seenTypes.has(msg.type)) {
                seenTypes.add(msg.type);
                debug("ws type:", msg.type);
            }
            // Accept canonical type or relaxed pattern (some forks may rename)
            const isMonitorType = msg.type === "crystools.monitor" || /crystools.*monitor/i.test(msg.type);
            if (isMonitorType) {
                this.resources = msg.data;
                if (!this.supported) {
                    this.supported = true; // auto‑promote feature when first event arrives
                    debug("Auto‑promoted monitoring feature via event sniffing", { type: msg.type });
                }
                try {
                    this.dispatchEvent(new CustomEvent("system_monitor", { detail: msg.data }));
                }
                catch (e) {
                    const err = e;
                    debug("Dispatch error", err?.message || err);
                }
            }
        });
    }
}
//# sourceMappingURL=monitoring.js.map