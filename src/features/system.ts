import { ComfyApi } from "../client";
import { SystemStatsResponse } from "../types/api";

import { FeatureBase } from "./base";

/** System stats & memory management (mirrors `/system_stats` & `/free`). */
export class SystemFeature extends FeatureBase {
  constructor(client: ComfyApi) {
    super(client);
  }

  /**
   * Retrieves system and device stats.
   * @returns {Promise<SystemStatsResponse>} The system stats.
   */
  async getSystemStats(): Promise<SystemStatsResponse> {
    const response = await this.client.fetchApi("/system_stats");
    return response.json();
  }

  /**
   * Frees memory by unloading models and freeing memory.
   *
   * @param unloadModels - A boolean indicating whether to unload models.
   * @param freeMemory - A boolean indicating whether to free memory.
   * @returns A promise that resolves to a boolean indicating whether the memory was successfully freed.
   */
  async freeMemory(unloadModels: boolean, freeMemory: boolean): Promise<boolean> {
    const payload = {
      unload_models: unloadModels,
      free_memory: freeMemory
    };

    try {
      const response = await this.client.fetchApi("/free", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }
}
