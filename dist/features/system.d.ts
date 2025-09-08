import { ComfyApi } from "../client.js";
import { SystemStatsResponse } from "../types/api.js";
import { FeatureBase } from "./base.js";
/** System stats & memory management (mirrors `/system_stats` & `/free`). */
export declare class SystemFeature extends FeatureBase {
    constructor(client: ComfyApi);
    /**
     * Retrieves system and device stats.
     * @returns {Promise<SystemStatsResponse>} The system stats.
     */
    getSystemStats(): Promise<SystemStatsResponse>;
    /**
     * Frees memory by unloading models and freeing memory.
     *
     * @param unloadModels - A boolean indicating whether to unload models.
     * @param freeMemory - A boolean indicating whether to free memory.
     * @returns A promise that resolves to a boolean indicating whether the memory was successfully freed.
     */
    freeMemory(unloadModels: boolean, freeMemory: boolean): Promise<boolean>;
}
//# sourceMappingURL=system.d.ts.map