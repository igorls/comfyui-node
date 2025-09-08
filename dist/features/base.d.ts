import { ComfyApi } from "../client.js";
export declare class FeatureBase {
    isSupported: boolean;
    protected client: ComfyApi;
    constructor(client: ComfyApi);
    destroy(): void;
    checkSupported(): Promise<boolean>;
}
//# sourceMappingURL=base.d.ts.map