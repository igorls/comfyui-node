import { ComfyApi } from "../client.js";
export declare abstract class AbstractFeature extends EventTarget {
    protected client: ComfyApi;
    protected supported: boolean;
    constructor(client: ComfyApi);
    get isSupported(): boolean;
    on(type: string, callback: (event: any) => void, options?: AddEventListenerOptions | boolean): () => void;
    off(type: string, callback: (event: any) => void, options?: EventListenerOptions | boolean): void;
    abstract destroy(): void;
    /**
     * Check if this feature is supported by the current client
     */
    abstract checkSupported(): Promise<boolean>;
}
//# sourceMappingURL=abstract.d.ts.map