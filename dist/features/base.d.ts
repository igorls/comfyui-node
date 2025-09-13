import { ComfyApi } from "../client.js";
/**
 * Base class for all ComfyUI features.
 * Provides common functionality and interface for feature implementations.
 */
export declare class FeatureBase {
    /**
     * Indicates whether the feature is supported by the current client
     */
    isSupported: boolean;
    /**
     * The ComfyUI client instance
     */
    protected client: ComfyApi;
    /**
     * Creates a new FeatureBase instance
     * @param client - The ComfyUI client instance
     */
    constructor(client: ComfyApi);
    /**
     * Destroys the feature instance and cleans up resources
     */
    destroy(): void;
    /**
     * Checks if the feature is supported by the current client
     * @returns A promise that resolves to a boolean indicating whether the feature is supported
     */
    checkSupported(): Promise<boolean>;
}
//# sourceMappingURL=base.d.ts.map