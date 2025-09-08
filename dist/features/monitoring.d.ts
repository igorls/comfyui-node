import { AbstractFeature } from "./abstract.js";
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
/** Crystools system monitoring (GPU/CPU/RAM/HDD + streaming events). */
export declare class MonitoringFeature extends AbstractFeature {
    private resources?;
    private listeners;
    private bound;
    checkSupported(): Promise<boolean>;
    destroy(): void;
    private fetchApi;
    on<K extends keyof TMonitorEventMap>(type: K, callback: (event: TMonitorEventMap[K]) => void, options?: AddEventListenerOptions | boolean): () => void;
    off<K extends keyof TMonitorEventMap>(type: K, callback: (event: TMonitorEventMap[K]) => void, options?: EventListenerOptions | boolean): void;
    /**
     * Gets the monitor data.
     *
     * @returns The monitor data if supported, otherwise false.
     */
    get monitorData(): false | TMonitorEvent | undefined;
    /**
     * Sets the monitor configuration.
     */
    setConfig(config?: Partial<{
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
    }>): Promise<false | Response>;
    /**
     * Switches the monitor on or off.
     */
    switch(active: boolean): Promise<false | Response>;
    /**
     * Gets the list of HDDs.
     */
    getHddList(): Promise<null | Array<string>>;
    /**
     * Gets the list of GPUs.
     */
    getGpuList(): Promise<null | Array<{
        index: number;
        name: string;
    }>>;
    /**
     * Config gpu monitoring
     * @param index Index of the GPU
     * @param config Configuration of monitoring, set to `true` to enable monitoring
     */
    setGpuConfig(index: number, config: Partial<{
        utilization: boolean;
        vram: boolean;
        temperature: boolean;
    }>): Promise<false | Response>;
    private bind;
}
//# sourceMappingURL=monitoring.d.ts.map