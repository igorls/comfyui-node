import { AbstractFeature } from "./abstract.js";
const SYSTEM_MONITOR_EXTENSION = encodeURIComponent("Primitive boolean [Crystools]");
/** Crystools system monitoring (GPU/CPU/RAM/HDD + streaming events). */
export class MonitoringFeature extends AbstractFeature {
    resources;
    listeners = [];
    bound = false;
    async checkSupported() {
        // Use feature namespace directly to avoid triggering deprecated wrapper
        const data = await this.client.ext.node.getNodeDefs(SYSTEM_MONITOR_EXTENSION);
        if (data) {
            this.supported = true;
            this.bind();
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
    bind() {
        if (this.bound) {
            return;
        }
        else {
            this.bound = true;
        }
        this.client.on("all", (ev) => {
            const msg = ev.detail;
            if (msg.type === "crystools.monitor") {
                this.resources = msg.data;
                this.dispatchEvent(new CustomEvent("system_monitor", { detail: msg.data }));
            }
        });
    }
}
//# sourceMappingURL=monitoring.js.map