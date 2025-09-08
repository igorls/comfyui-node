import { ComfyApi } from "../client.js";
import { FeatureBase } from "./base.js";
export interface ServerFeatureFlags {
    [key: string]: boolean | string | number | object | null;
}
/**
 * Access server feature flags exposed at /features
 */
export declare class FeatureFlagsFeature extends FeatureBase {
    constructor(client: ComfyApi);
    getServerFeatures(): Promise<ServerFeatureFlags>;
    checkSupported(): Promise<boolean>;
}
//# sourceMappingURL=feature-flags.d.ts.map