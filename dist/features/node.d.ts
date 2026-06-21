import { ComfyApi } from "../client.js";
import { NodeDefsResponse } from "../types/api.js";
import { FeatureBase } from "./base.js";
/** Node definition introspection + model/sampler metadata helpers. */
export declare class NodeFeature extends FeatureBase {
    constructor(client: ComfyApi);
    /**
     * Retrieves node object definitions for the graph.
     * @returns {Promise<NodeDefsResponse>} The node definitions.
     */
    getNodeDefs(nodeName?: string): Promise<NodeDefsResponse | null>;
    /**
     * Retrieves the checkpoints from the server.
     * @returns A promise that resolves to an array of strings representing the checkpoints.
     */
    getCheckpoints(): Promise<string[]>;
    /**
     * Retrieves the Loras from the node definitions.
     * @returns A Promise that resolves to an array of strings representing the Loras.
     */
    getLoras(): Promise<string[]>;
    /**
     * Retrieves the sampler information.
     * @returns An object containing the sampler and scheduler information.
     */
    getSamplerInfo(): Promise<{
        sampler?: undefined;
        scheduler?: undefined;
    } | {
        sampler: import("../types/api.js").NodeInputSpec;
        scheduler: import("../types/api.js").NodeInputSpec;
    }>;
}
//# sourceMappingURL=node.d.ts.map