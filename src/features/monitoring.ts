import { AbstractFeature } from "./abstract";
import { FetchOptions } from "./manager";

const SYSTEM_MONITOR_EXTENSION = encodeURIComponent("Primitive boolean [Crystools]");

export type TMonitorEvent = {
  cpu_utilization: number;
  ram_total: number;
  ram_used: number;
  ram_used_percent: number;
  hdd_total: number;
  hdd_used: number;
  hdd_used_percent: number;
  device_type: "cuda";
  gpus: Array<{
    gpu_utilization: number;
    gpu_temperature: number;
    vram_total: number;
    vram_used: number;
    vram_used_percent: number;
  }>;
};

export type TMonitorEventMap = {
  system_monitor: CustomEvent<TMonitorEvent>;
};

export class MonitoringFeature extends AbstractFeature {
  private resources?: TMonitorEvent;
  private listeners: {
    event: keyof TMonitorEventMap;
    options?: AddEventListenerOptions | boolean;
    handler: (event: TMonitorEventMap[keyof TMonitorEventMap]) => void;
  }[] = [];
  private bound = false;

  async checkSupported() {
  // Use feature namespace directly to avoid triggering deprecated wrapper
  const data = await this.client.ext.node.getNodeDefs(SYSTEM_MONITOR_EXTENSION);
    if (data) {
      this.supported = true;
      this.bind();
    }
    return this.supported;
  }

  public destroy(): void {
    this.listeners.forEach((listener) => {
      this.off(listener.event, listener.handler, listener.options);
    });
    this.listeners = [];
  }

  private async fetchApi(path: string, options?: FetchOptions) {
    if (!this.supported) {
      return false;
    }
    return this.client.fetchApi(path, options);
  }

  public on<K extends keyof TMonitorEventMap>(
    type: K,
    callback: (event: TMonitorEventMap[K]) => void,
    options?: AddEventListenerOptions | boolean
  ) {
    this.addEventListener(type, callback as any, options);
    this.listeners.push({ event: type, options, handler: callback });
    return () => this.off(type, callback);
  }

  public off<K extends keyof TMonitorEventMap>(
    type: K,
    callback: (event: TMonitorEventMap[K]) => void,
    options?: EventListenerOptions | boolean
  ): void {
    this.removeEventListener(type, callback as any, options);
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
  async setConfig(
    config?: Partial<{
      /**
       * Refresh per second (Default 0.5)
       */
      rate: number;
      /**
       * Switch to enable/disable CPU monitoring
       */
      switchCPU: boolean;
      /**
       * Switch to enable/disable GPU monitoring
       */
      switchHDD: boolean;
      /**
       * Switch to enable/disable RAM monitoring
       */
      switchRAM: boolean;
      /**
       * Path of HDD to monitor HDD usage (use getHddList to get the pick-able list)
       */
      whichHDD: string;
    }>
  ) {
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
  async switch(active: boolean) {
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
  async getHddList(): Promise<null | Array<string>> {
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
  async getGpuList(): Promise<null | Array<{ index: number; name: string }>> {
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
  async setGpuConfig(index: number, config: Partial<{ utilization: boolean; vram: boolean; temperature: boolean }>) {
    if (!this.supported) {
      return false;
    }
    return this.fetchApi(`/api/crystools/monitor/GPU/${index}`, {
      method: "PATCH",
      body: JSON.stringify(config)
    });
  }

  private bind() {
    if (this.bound) {
      return;
    } else {
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
