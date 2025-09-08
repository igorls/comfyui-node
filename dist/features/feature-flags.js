import { FeatureBase } from "./base.js";
/**
 * Access server feature flags exposed at /features
 */
export class FeatureFlagsFeature extends FeatureBase {
    constructor(client) {
        super(client);
    }
    async getServerFeatures() {
        const res = await this.client.fetchApi("/features");
        if (!res.ok) {
            throw new Error(`Failed to fetch feature flags: ${res.status}`);
        }
        return res.json();
    }
    async checkSupported() {
        try {
            await this.getServerFeatures();
            this.isSupported = true;
        }
        catch {
            this.isSupported = false;
        }
        return this.isSupported;
    }
}
//# sourceMappingURL=feature-flags.js.map