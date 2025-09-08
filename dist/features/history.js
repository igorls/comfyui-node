import { FeatureBase } from "./base.js";
/** Access execution history entries (summary + individual). */
export class HistoryFeature extends FeatureBase {
    constructor(client) {
        super(client);
    }
    /**
     * Retrieves the prompt execution history.
     * @param {number} [maxItems=200] The maximum number of items to retrieve.
     * @returns {Promise<HistoryResponse>} The prompt execution history.
     */
    async getHistories(maxItems = 200) {
        const response = await this.client.fetchApi(`/history?max_items=${maxItems}`);
        return response.json();
    }
    /** Fetch a specific history entry by prompt id. */
    async getHistory(promptId) {
        const response = await this.client.fetchApi(`/history/${promptId}`);
        const history = await response.json();
        return history[promptId];
    }
}
//# sourceMappingURL=history.js.map