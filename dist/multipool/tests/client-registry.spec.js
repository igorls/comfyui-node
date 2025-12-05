import { describe, it, expect, beforeEach, jest } from "bun:test";
import { ClientRegistry } from "../client-registry.js";
// Mock dependencies
const createPoolMock = () => ({});
const createEventManagerMock = () => ({
    emitEvent: jest.fn(),
});
const createWorkflowMock = (hash) => {
    const mock = {
        structureHash: hash,
        updateHash: jest.fn(),
    };
    mock.updateHash.mockImplementation(() => {
        mock.structureHash = "mock-hash";
    });
    return mock;
};
describe("ClientRegistry", () => {
    let poolMock;
    let eventsMock;
    let registry;
    beforeEach(() => {
        poolMock = createPoolMock();
        eventsMock = createEventManagerMock();
        registry = new ClientRegistry(poolMock, eventsMock);
        jest.clearAllMocks();
    });
    describe("addClient", () => {
        it("should add a client without options", () => {
            const clientUrl = "http://localhost:8188";
            registry.addClient(clientUrl);
            expect(registry.clients.has(clientUrl)).toBe(true);
            const client = registry.clients.get(clientUrl);
            expect(client.url).toBe(clientUrl);
            expect(client.state).toBe("idle");
            expect(client.nodeName).toBe("localhost");
            expect(client.priority).toBeUndefined();
            expect(client.workflowAffinity).toBeUndefined();
        });
        it("should add a client with priority", () => {
            const clientUrl = "http://localhost:8188";
            registry.addClient(clientUrl, { priority: 5 });
            const client = registry.clients.get(clientUrl);
            expect(client.priority).toBe(5);
        });
        it("should add a client with workflow affinity", () => {
            const clientUrl = "http://localhost:8188";
            const workflow = createWorkflowMock("hash1");
            registry.addClient(clientUrl, { workflowAffinity: [workflow] });
            const client = registry.clients.get(clientUrl);
            expect(client.workflowAffinity).toEqual(new Set(["hash1"]));
            expect(registry.workflowAffinityMap.get("hash1")).toEqual(new Set([clientUrl]));
        });
        it("should update hash if not present in workflow", () => {
            const clientUrl = "http://localhost:8188";
            const workflow = createWorkflowMock(); // no hash
            registry.addClient(clientUrl, { workflowAffinity: [workflow] });
            expect(workflow.updateHash).toHaveBeenCalled();
            const client = registry.clients.get(clientUrl);
            expect(client.workflowAffinity).toEqual(new Set(["mock-hash"]));
        });
        it("should throw error if workflow has no hash after update", () => {
            const clientUrl = "http://localhost:8188";
            const workflow = createWorkflowMock();
            workflow.updateHash.mockImplementation(() => {
                // don't set hash
            });
            expect(() => registry.addClient(clientUrl, { workflowAffinity: [workflow] })).toThrow("Workflow must have a valid structure hash for affinity.");
        });
    });
    describe("removeClient", () => {
        it("should remove a client", () => {
            const clientUrl = "http://localhost:8188";
            registry.addClient(clientUrl);
            expect(registry.clients.has(clientUrl)).toBe(true);
            registry.removeClient(clientUrl);
            expect(registry.clients.has(clientUrl)).toBe(false);
        });
    });
    describe("getQueueStatus", () => {
        it("should return queue status for existing client", async () => {
            const clientUrl = "http://localhost:8188";
            registry.addClient(clientUrl);
            const mockQueue = { queue_running: [], queue_pending: [] };
            const client = registry.clients.get(clientUrl);
            jest.spyOn(client.api, 'getQueue').mockResolvedValue(mockQueue);
            const result = await registry.getQueueStatus(clientUrl);
            expect(result).toBe(mockQueue);
        });
        it("should throw error for non-existing client", async () => {
            await expect(registry.getQueueStatus("http://nonexistent:8188")).rejects.toThrow("Client http://nonexistent:8188 not found");
        });
    });
    describe("getOptimalClient", () => {
        it("should return null if no workflow hash", () => {
            const workflow = createWorkflowMock();
            workflow.updateHash.mockImplementation(() => {
                // no hash
            });
            expect(() => registry.getOptimalClient(workflow)).toThrow("Workflow must have a valid structure hash.");
        });
        it("should return null if no suitable idle clients with affinity", () => {
            const workflow = createWorkflowMock("hash1");
            registry.addClient("http://client1:8188", { workflowAffinity: [workflow] });
            registry.clients.get("http://client1:8188").state = "busy";
            const result = registry.getOptimalClient(workflow);
            expect(result).toBeNull();
            expect(eventsMock.emitEvent).toHaveBeenCalledWith({ type: "debug", payload: "No suitable clients found for workflow hash1." });
        });
        it("should return the highest priority idle client with affinity", () => {
            const workflow = createWorkflowMock("hash1");
            registry.addClient("http://client1:8188", { workflowAffinity: [workflow], priority: 1 });
            registry.addClient("http://client2:8188", { workflowAffinity: [workflow], priority: 3 });
            registry.addClient("http://client3:8188", { workflowAffinity: [workflow], priority: 2 });
            const result = registry.getOptimalClient(workflow);
            expect(result.url).toBe("http://client2:8188"); // highest priority
        });
        it("should return idle client even if no affinity specified", () => {
            const workflow = createWorkflowMock("hash1");
            registry.addClient("http://client1:8188"); // no affinity
            registry.clients.get("http://client1:8188").workflowAffinity = undefined; // ensure no affinity
            // Since no affinity, suitableClients will be empty
            const result = registry.getOptimalClient(workflow);
            expect(result).toBeNull();
        });
    });
    describe("hasClientsForWorkflow", () => {
        it("should return true if clients have affinity for workflow", () => {
            const workflow = createWorkflowMock("hash1");
            registry.addClient("http://client1:8188", { workflowAffinity: [workflow] });
            expect(registry.hasClientsForWorkflow("hash1")).toBe(true);
        });
        it("should return false if no clients have affinity", () => {
            expect(registry.hasClientsForWorkflow("hash1")).toBe(false);
        });
    });
    describe("getOptimalIdleClient", () => {
        it("should return the highest priority idle client", async () => {
            registry.addClient("http://client1:8188", { priority: 1 });
            registry.addClient("http://client2:8188", { priority: 3 });
            registry.addClient("http://client3:8188", { priority: 2 });
            // Mock getQueue to return empty for all clients
            for (const client of registry.clients.values()) {
                jest.spyOn(client.api, 'getQueue').mockResolvedValue({ queue_running: [], queue_pending: [] });
            }
            const result = await registry.getOptimalIdleClient(createWorkflowMock());
            expect(result.url).toBe("http://client2:8188");
        });
        it("should return null if no idle clients", async () => {
            registry.addClient("http://client1:8188");
            registry.clients.get("http://client1:8188").state = "busy";
            const result = await registry.getOptimalIdleClient(createWorkflowMock());
            expect(result).toBeNull();
        });
        it("should check queue state and update client state", async () => {
            registry.addClient("http://client1:8188");
            const client = registry.clients.get("http://client1:8188");
            jest.spyOn(client.api, 'getQueue').mockResolvedValue({ queue_running: [{}], queue_pending: [] });
            const result = await registry.getOptimalIdleClient(createWorkflowMock());
            expect(client.state).toBe("busy");
            expect(result).toBeNull();
        });
    });
    describe("markClientIncompatibleWithWorkflow", () => {
        it("should remove affinity for the workflow", () => {
            const workflow = createWorkflowMock("hash1");
            registry.addClient("http://client1:8188", { workflowAffinity: [workflow] });
            registry.markClientIncompatibleWithWorkflow("http://client1:8188", "hash1");
            const client = registry.clients.get("http://client1:8188");
            expect(client.workflowAffinity.has("hash1")).toBe(false);
            expect(registry.workflowAffinityMap.has("hash1")).toBe(false);
        });
    });
    describe("getAllEligibleClientsForWorkflow", () => {
        it("should return clients with affinity for the workflow", () => {
            const workflow = createWorkflowMock("hash1");
            registry.addClient("http://client1:8188", { workflowAffinity: [workflow] });
            registry.addClient("http://client2:8188");
            const result = registry.getAllEligibleClientsForWorkflow(workflow);
            expect(result).toHaveLength(1);
            expect(result[0].url).toBe("http://client1:8188");
        });
        it("should throw if workflow has no hash", () => {
            const workflow = createWorkflowMock();
            workflow.updateHash.mockImplementation(() => { });
            expect(() => registry.getAllEligibleClientsForWorkflow(workflow)).toThrow("Workflow must have a valid structure hash.");
        });
    });
});
//# sourceMappingURL=client-registry.spec.js.map