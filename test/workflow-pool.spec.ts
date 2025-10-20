import { describe, it, expect } from "bun:test";
import { WorkflowPool } from "../src/pool/WorkflowPool";
import { Workflow } from "../src/workflow";
import type { WorkflowPoolEventMap } from "../src/pool/types/events";
import type { FailoverStrategy } from "../src/pool/failover/Strategy";

class NoopFailoverStrategy implements FailoverStrategy {
    shouldSkipClient() {
        return false;
    }
    recordFailure() { }
    recordSuccess() { }
    resetForWorkflow() { }
    isWorkflowBlocked() {
        return false;
    }
}

class FakeWorkflowClient extends EventTarget {
    public readonly id: string;
    public ext: any;
    private promptCounter = 0;
    private queuePending: string[] = [];
    private history = new Map<string, any>();
    public interrupted: string[] = [];

    constructor(id: string) {
        super();
        this.id = id;
        this.ext = {
            queue: {
                appendPrompt: async (workflow: any) => {
                    const prompt_id = `${this.id}-prompt-${++this.promptCounter}`;

                    this.queuePending.push(prompt_id);
                    this.history.set(prompt_id, { workflow, status: { completed: false }, outputs: {} });
                    this.dispatchStatus();
                    return { prompt_id };
                },
                interrupt: async (promptId: string) => {

                    this.interrupted.push(promptId);
                    this.queuePending = this.queuePending.filter((id) => id !== promptId);
                    this.dispatchStatus();
                }
            },
            history: {
                getHistory: async (promptId: string) => this.history.get(promptId)
            },
            node: {
                getNodeDefs: async () => ({})
            },
            file: {
                uploadImage: async () => { }
            }
        };
    }

    async init() {
        return this;
    }

    on(name: string, handler: (event: any) => void, options?: AddEventListenerOptions | boolean) {
        this.addEventListener(name, handler as EventListener, options);
        return () => this.removeEventListener(name, handler as EventListener, options as any);
    }

    async getQueue() {
        const pending = this.queuePending.map<[number, string]>((id, idx) => [idx, id]);

        return { queue_pending: pending, queue_running: [] as Array<[number, string]> };
    }

    async completePrompt(promptId: string, outputs: Record<string, any>) {
        if (!this.history.has(promptId)) {
            throw new Error(`Unknown prompt ${promptId}`);
        }
        this.queuePending = this.queuePending.filter((id) => id !== promptId);
        this.history.set(promptId, { status: { completed: true }, outputs });
        await Promise.resolve();
        const nodes = Object.keys(outputs);
        const nodeId = nodes[0] ?? "output";
        this.dispatchEvent(new CustomEvent("executing", { detail: { prompt_id: promptId, node: nodeId } }));
        this.dispatchEvent(new CustomEvent("progress", { detail: { prompt_id: promptId, node: nodeId, value: 1, max: 1 } }));
        for (const id of nodes) {
            this.dispatchEvent(new CustomEvent("executed", { detail: { prompt_id: promptId, node: id, output: outputs[id] } }));
        }
        this.dispatchEvent(new CustomEvent("execution_success", { detail: { prompt_id: promptId } }));
        this.dispatchStatus();
    }

    async failPrompt(promptId: string, message = "boom") {
        if (!this.history.has(promptId)) {
            throw new Error(`Unknown prompt ${promptId}`);
        }

        this.dispatchEvent(new CustomEvent("executing", { detail: { prompt_id: promptId, node: "fail" } }));
        this.dispatchEvent(
            new CustomEvent("execution_error", {
                detail: {
                    prompt_id: promptId,
                    exception_type: message,
                    exception_message: message,
                    traceback: [],
                    node_id: "fail",
                    node_type: "MockNode"
                }
            })
        );
        this.queuePending = this.queuePending.filter((id) => id !== promptId);
        this.dispatchStatus();
    }

    private dispatchStatus() {
        const detail = {
            queue_pending: this.queuePending.map<[number, string]>((id, idx) => [idx, id]),
            queue_running: [] as Array<[number, string]>
        };

        this.dispatchEvent(new CustomEvent("status", { detail }));
    }
}

function waitForEvent<K extends keyof WorkflowPoolEventMap>(pool: WorkflowPool, event: K) {
    return new Promise<WorkflowPoolEventMap[K]>((resolve) => {
        pool.once(event, (ev) => resolve(ev as WorkflowPoolEventMap[K]));
    });
}

const SAMPLE_WORKFLOW = {
    "1": { class_type: "EmptyLatentImage", inputs: { width: 8, height: 8, batch_size: 1 } },
    "2": { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "demo" } }
};

describe("WorkflowPool", () => {
    const failoverStrategy = new NoopFailoverStrategy();

    it("executes a workflow job and collects outputs", async () => {

        const client = new FakeWorkflowClient("client-a");
        const pool = new WorkflowPool([client as any], { failoverStrategy });
        await pool.ready();

        const workflow = Workflow.from(SAMPLE_WORKFLOW).output("result", "2");
        pool.on("job:accepted", (ev) => {

            const promptId = ev.detail.job.promptId!;
            setTimeout(() => {
                void client.completePrompt(promptId, { "2": { data: { ok: true } } });
            }, 0);
        });

        const completion = waitForEvent(pool, "job:completed");
        const jobId = await pool.enqueue(workflow, { includeOutputs: ["2"] });

        const { detail } = await completion;


        expect(detail.job.jobId).toBe(jobId);
        expect(detail.job.status).toBe("completed");
        expect(detail.job.result).toBeTruthy();
        expect((detail.job.result as any).result?.data?.ok ?? (detail.job.result as any)["2"].data.ok).toBe(true);
        expect((detail.job.result as any)._nodes).toContain("2");
        expect((detail.job.result as any)._aliases["2"]).toBe("result");

        await pool.shutdown();
    });

    it("retries a job after failure and eventually succeeds", async () => {

        const client = new FakeWorkflowClient("client-retry");
        const pool = new WorkflowPool([client as any], { retryBackoffMs: 10, failoverStrategy });
        await pool.ready();

        const workflow = Workflow.from(SAMPLE_WORKFLOW).output("result", "2");
        let attempt = 0;
        pool.on("job:accepted", (ev) => {
            const promptId = ev.detail.job.promptId!;
            attempt = ev.detail.job.attempts;

            setTimeout(() => {
                if (attempt === 1) {
                    void client.failPrompt(promptId, "first-attempt");
                } else {
                    void client.completePrompt(promptId, { "2": { data: { attempt } } });
                }
            }, 10);
        });
        pool.on("job:failed", (ev) => {

        });
        pool.on("job:retrying", (ev) => {

        });
        pool.on("job:queued", (ev) => {

        });

        const retrying = waitForEvent(pool, "job:retrying");
        const completed = waitForEvent(pool, "job:completed");

        const jobId = await pool.enqueue(workflow, { includeOutputs: ["2"], maxAttempts: 2 });


        await retrying;
        const { detail } = await completed;


        expect(detail.job.jobId).toBe(jobId);
        expect(detail.job.status).toBe("completed");
        expect(detail.job.attempts).toBe(2);
        expect((detail.job.result as any).result?.data?.attempt ?? (detail.job.result as any)["2"].data.attempt).toBe(2);

        await pool.shutdown();
    });

    it("cancels an active job and interrupts the client", async () => {

        const client = new FakeWorkflowClient("client-cancel");
        const pool = new WorkflowPool([client as any], { failoverStrategy });
        await pool.ready();

        const workflow = Workflow.from(SAMPLE_WORKFLOW).output("result", "2");

        const accepted = waitForEvent(pool, "job:accepted");
        const jobId = await pool.enqueue(workflow, { includeOutputs: ["2"] });

        const { detail } = await accepted;
        const promptId = detail.job.promptId!;


        // Wait for job to be fully active (added to activeJobs map)
        await new Promise((resolve) => setTimeout(resolve, 10));

        const cancelled = waitForEvent(pool, "job:cancelled");
        const success = await pool.cancel(jobId);
        expect(success).toBe(true);


        const { detail: cancelDetail } = await cancelled;

        expect(cancelDetail.job.status).toBe("cancelled");
        expect(promptId).toBeTruthy();
        expect(client.interrupted).toContain(promptId);

        await pool.shutdown();
    });
});
