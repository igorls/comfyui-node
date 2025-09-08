import { ComfyApi } from "../client.js";
import { FeatureBase } from "./base.js";
/** Miscellaneous endpoints (extensions list, embeddings with legacy fallback). */
export declare class MiscFeature extends FeatureBase {
    constructor(client: ComfyApi);
    /**
     * Retrieves a list of extension URLs.
     * @returns {Promise<string[]>} A list of extension URLs.
     */
    getExtensions(): Promise<string[]>;
    /**
     * Retrieves a list of embedding names.
     * @returns {Promise<string[]>} A list of embedding names.
     */
    getEmbeddings(): Promise<string[]>;
}
//# sourceMappingURL=misc.d.ts.map