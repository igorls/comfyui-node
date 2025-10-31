import { ComfyApi } from "src/client.js";
export class ClientRegistry {
    pool;
    clients = new Set();
    comfyApiMap = new Map();
    constructor(pool) {
        this.pool = pool;
    }
    addClient(clientUrl) {
        this.clients.add(clientUrl);
        const comfyApi = new ComfyApi(clientUrl);
        this.comfyApiMap.set(clientUrl, comfyApi);
    }
    removeClient(clientUrl) {
        this.clients.delete(clientUrl);
        this.comfyApiMap.delete(clientUrl);
    }
    async getQueueStatus(clientUrl) {
        const comfyApi = this.comfyApiMap.get(clientUrl);
        if (!comfyApi) {
            throw new Error(`Client ${clientUrl} not found`);
        }
        return comfyApi.getQueue();
    }
}
//# sourceMappingURL=client-registry.js.map