import { ComfyApi } from "../client.js";
import { FeatureBase } from "./base.js";
/** Terminal log retrieval & subscription control. */
export declare class TerminalFeature extends FeatureBase {
    constructor(client: ComfyApi);
    /**
     * Retrieves the terminal logs from the server.
     */
    getTerminalLogs(): Promise<{
        entries: Array<{
            t: string;
            m: string;
        }>;
        size: {
            cols: number;
            rows: number;
        };
    }>;
    /**
     * Sets the terminal subscription status.
     * Enable will subscribe to terminal logs from the websocket.
     */
    setTerminalSubscription(subscribe: boolean): Promise<void>;
}
//# sourceMappingURL=terminal.d.ts.map