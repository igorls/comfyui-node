import { ComfyApi } from "../client.js";
import { HistoryEntry, HistoryResponse } from "../types/api.js";
import { FeatureBase } from "./base.js";
/** Access execution history entries (summary + individual). */
export declare class HistoryFeature extends FeatureBase {
    constructor(client: ComfyApi);
    /**
     * Retrieves the prompt execution history.
     * @param {number} [maxItems=200] The maximum number of items to retrieve.
     * @returns {Promise<HistoryResponse>} The prompt execution history.
     */
    getHistories(maxItems?: number): Promise<HistoryResponse>;
    /** Fetch a specific history entry by prompt id. */
    getHistory(promptId: string): Promise<HistoryEntry | undefined>;
}
//# sourceMappingURL=history.d.ts.map