import { ComfyApi } from "../client";
import { HistoryEntry, HistoryResponse } from "../types/api";

import { FeatureBase } from "./base";

export class HistoryFeature extends FeatureBase {
  constructor(client: ComfyApi) {
    super(client);
  }

  /**
   * Retrieves the prompt execution history.
   * @param {number} [maxItems=200] The maximum number of items to retrieve.
   * @returns {Promise<HistoryResponse>} The prompt execution history.
   */
  async getHistories(maxItems: number = 200): Promise<HistoryResponse> {
    const response = await this.client.fetchApi(`/history?max_items=${maxItems}`);
    return response.json();
  }

  /**
   * Retrieves the history entry for a given prompt ID.
   * @param promptId - The ID of the prompt.
   * @returns A Promise that resolves to the HistoryEntry object.
   */
  async getHistory(promptId: string): Promise<HistoryEntry | undefined> {
    const response = await this.client.fetchApi(`/history/${promptId}`);
    const history: HistoryResponse = await response.json();
    return history[promptId];
  }
}
