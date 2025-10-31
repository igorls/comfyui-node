import { MultiWorkflowPool } from "src/multipool/multi-workflow-pool.js";
import { ComfyApi } from "src/client.js";
export declare class ClientRegistry {
    pool: MultiWorkflowPool;
    clients: Set<string>;
    comfyApiMap: Map<string, ComfyApi>;
    constructor(pool: MultiWorkflowPool);
    addClient(clientUrl: string): void;
    removeClient(clientUrl: string): void;
    getQueueStatus(clientUrl: string): Promise<import("../types/api.js").QueueResponse>;
}
//# sourceMappingURL=client-registry.d.ts.map