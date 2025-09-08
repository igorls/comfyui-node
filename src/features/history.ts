import { ComfyApi } from "../client.js";
import { HistoryEntry, HistoryResponse } from "../types/api.js";

import { FeatureBase } from "./base.js";

/** Access execution history entries (summary + individual). */
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

  /** Fetch a specific history entry by prompt id. */
  async getHistory(promptId: string): Promise<HistoryEntry | undefined> {
    const response = await this.client.fetchApi(`/history/${promptId}`);
    const history: HistoryResponse = await response.json();
    return history[promptId];
  }
}
