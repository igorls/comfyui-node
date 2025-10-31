import { describe, it, expect, beforeEach, jest } from "bun:test";
import { JobQueueProcessor } from "../job-queue-processor.js";
import { Workflow } from "../workflow.js";
import { Logger } from "../logger.js";
// Mock dependencies
const createJobStateRegistryMock = () => ({
    getJobStatus: jest.fn().mockReturnValue("pending"),
    setJobStatus: jest.fn(),
    setPromptId: jest.fn(),
    updateJobAutoSeeds: jest.fn(),
    setJobFailure: jest.fn(),
});
const createClientRegistryMock = () => ({
    getOptimalClient: jest.fn(),
    getOptimalIdleClient: jest.fn(),
    clients: new Map(),
    markClientIncompatibleWithWorkflow: jest.fn(),
    getAllEligibleClientsForWorkflow: jest.fn().mockReturnValue([]),
});
const createLoggerMock = () => new Logger("test", "silent");
describe("JobQueueProcessor", () => {
    let jobStateRegistryMock;
    let clientRegistryMock;
    let loggerMock;
    beforeEach(() => {
        jobStateRegistryMock = createJobStateRegistryMock();
        clientRegistryMock = createClientRegistryMock();
        loggerMock = createLoggerMock();
    });
    const createProcessor = (hash = "test-hash") => new JobQueueProcessor(jobStateRegistryMock, clientRegistryMock, hash, loggerMock);
    it("should enqueue a job and trigger processing", async () => {
        const processor = createProcessor();
        const processQueueSpy = jest.spyOn(processor, "processQueue").mockImplementation(async () => { });
        await processor.enqueueJob("job-1", new Workflow({}));
        expect(processor.queue).toHaveLength(1);
        expect(processor.queue[0].jobId).toBe("job-1");
        expect(processQueueSpy).toHaveBeenCalled();
    });
    it("should not process queue if already processing", async () => {
        const processor = createProcessor();
        processor.isProcessing = true;
        const loggerSpy = jest.spyOn(loggerMock, 'debug');
        await processor.processQueue();
        expect(loggerSpy).toHaveBeenCalledWith(`Job queue for workflow hash test-hash is already being processed, skipping.`);
    });
    it("should assign a job to an optimal client and run it successfully", async () => {
        const processor = createProcessor();
        const workflow = new Workflow({});
        workflow.uploadAssets = jest.fn().mockResolvedValue(undefined);
        const jobId = "job-1";
        const clientMock = {
            url: "http://localhost:8188",
            nodeName: "test-client",
            state: "idle",
            api: {
                getQueue: jest.fn().mockResolvedValue({ queue_running: [], queue_pending: [] }),
                ext: { queue: { queuePrompt: jest.fn().mockResolvedValue({ prompt_id: "prompt-1" }) } },
            },
        };
        clientRegistryMock.getOptimalClient.mockReturnValue(clientMock);
        processor.queue.push({ jobId, workflow, attempts: 1 });
        await processor.processQueue();
        expect(clientRegistryMock.getOptimalClient).toHaveBeenCalledWith(workflow);
        expect(jobStateRegistryMock.setJobStatus).toHaveBeenCalledWith(jobId, "assigned", clientMock.url);
        expect(workflow.uploadAssets).toHaveBeenCalledWith(clientMock.api);
        expect(clientMock.api.ext.queue.queuePrompt).toHaveBeenCalled();
        expect(jobStateRegistryMock.setPromptId).toHaveBeenCalledWith(jobId, "prompt-1");
        expect(jobStateRegistryMock.setJobStatus).toHaveBeenCalledWith(jobId, "running");
        expect(clientMock.state).toBe("busy");
    });
    it("should re-queue a job if no idle clients are available", async () => {
        const processor = createProcessor();
        const workflow = new Workflow({});
        const jobId = "job-1";
        clientRegistryMock.getOptimalClient.mockReturnValue(null);
        processor.queue.push({ jobId, workflow, attempts: 1 });
        await processor.processQueue();
        expect(jobStateRegistryMock.setJobStatus).toHaveBeenCalledWith(jobId, "pending");
        expect(processor.queue).toHaveLength(1);
        expect(processor.isProcessing).toBe(false);
    });
    it("should dequeue a job", () => {
        const processor = createProcessor();
        processor.queue = [{ jobId: "job-1", workflow: new Workflow({}), attempts: 1 }];
        processor.dequeueJob("job-1");
        expect(processor.queue).toHaveLength(0);
    });
});
//# sourceMappingURL=job-queue-processor.spec.js.map