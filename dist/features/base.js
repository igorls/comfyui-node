/**
 * Base class for all ComfyUI features.
 * Provides common functionality and interface for feature implementations.
 */
export class FeatureBase {
    /**
     * Indicates whether the feature is supported by the current client
     */
    isSupported = false;
    /**
     * The ComfyUI client instance
     */
    client;
    /**
     * Creates a new FeatureBase instance
     * @param client - The ComfyUI client instance
     */
    constructor(client) {
        this.client = client;
    }
    /**
     * Destroys the feature instance and cleans up resources
     */
    destroy() {
        // Base destroy method
    }
    /**
     * Checks if the feature is supported by the current client
     * @returns A promise that resolves to a boolean indicating whether the feature is supported
     */
    async checkSupported() {
        // Base checkSupported method does nothing; concrete features override.
        return this.isSupported;
    }
}
//# sourceMappingURL=base.js.map