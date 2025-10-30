import { describe, it, expect } from "bun:test";
import { WorkflowPool } from "../src/pool/WorkflowPool";
import { Workflow } from "../src/workflow";
import { EnqueueFailedError, WorkflowNotSupportedError } from "../src/types/error";
import type { WorkflowPoolEventMap } from "../src/pool/types/events";
import type { FailoverStrategy } from "../src/pool/failover/Strategy";
import { hashWorkflow } from "../src/pool/utils/hash";

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
    private appendPromptHandler?: (workflow: any) => Promise<{ prompt_id: string }>;

    constructor(id: string) {
        super();
        this.id = id;
        this.ext = {
            queue: {
                appendPrompt: async (workflow: any) => {
                    if (this.appendPromptHandler) {
                        return this.appendPromptHandler(workflow);
                    }
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

    setAppendPromptHandler(handler?: (workflow: any) => Promise<{ prompt_id: string }>) {
        this.appendPromptHandler = handler;
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

    async completePromptSilently(promptId: string, outputs: Record<string, any>) {
        if (!this.history.has(promptId)) {
            throw new Error(`Unknown prompt ${promptId}`);
        }
        this.queuePending = this.queuePending.filter((id) => id !== promptId);
        this.history.set(promptId, { status: { completed: true }, outputs });
        this.dispatchStatus();
    }

    simulateDisconnect() {
        this.dispatchEvent(new CustomEvent("disconnected"));
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

const EDIT_SAMPLE_WORKFLOW = {
    "91": { class_type: "LoadImage", inputs: { image: "placeholder" } },
    "207": { class_type: "SaveImage", inputs: { images: ["91", 0], filename_prefix: "edit" } }
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

    it("recovers a completed job after websocket disconnect", async () => {

        const client = new FakeWorkflowClient("client-disc");
        const pool = new WorkflowPool([client as any], { failoverStrategy, retryBackoffMs: 5 });
        await pool.ready();

        const workflow = Workflow.from(SAMPLE_WORKFLOW).output("result", "2");

        let sawFailure = false;
        pool.on("job:failed", () => {
            sawFailure = true;
        });

        pool.on("job:accepted", (ev) => {
            const promptId = ev.detail.job.promptId!;
            setTimeout(() => {
                client.simulateDisconnect();
                setTimeout(() => {
                    void client.completePromptSilently(promptId, { "2": { data: { recovered: true } } });
                }, 20);
            }, 10);
        });

        const completed = waitForEvent(pool, "job:completed");
        const jobId = await pool.enqueue(workflow, { includeOutputs: ["2"] });

        const { detail } = await completed;

        expect(sawFailure).toBe(false);
        expect(detail.job.jobId).toBe(jobId);
        expect(detail.job.status).toBe("completed");
        const recoveredValue = (detail.job.result as any).result?.data?.recovered ?? (detail.job.result as any)["2"].data.recovered;
        expect(recoveredValue).toBe(true);

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

    it("emits WorkflowNotSupportedError when all clients reject the workflow", async () => {

        const clientA = new FakeWorkflowClient("client-a");
        const clientB = new FakeWorkflowClient("client-b");
        const pool = new WorkflowPool([clientA as any, clientB as any], { failoverStrategy, retryBackoffMs: 5 });
        await pool.ready();

        const rejection = () => new EnqueueFailedError("Failed to queue prompt", {
            bodyJSON: { error: "value_not_in_list", message: "value_not_in_list" },
            reason: "value_not_in_list"
        });

        clientA.setAppendPromptHandler(async () => { throw rejection(); });
        clientB.setAppendPromptHandler(async () => { throw rejection(); });

        const workflow = Workflow.from(SAMPLE_WORKFLOW).output("result", "2");

        const finalFailure = new Promise<WorkflowPoolEventMap["job:failed"]>((resolve) => {
            pool.on("job:failed", (ev) => {
                if (!ev.detail.willRetry) {
                    resolve(ev as WorkflowPoolEventMap["job:failed"]);
                }
            });
        });

        const jobId = await pool.enqueue(workflow, { includeOutputs: ["2"], maxAttempts: 4 });

        const { detail } = await finalFailure;

        expect(detail.job.jobId).toBe(jobId);
        expect(detail.willRetry).toBe(false);
        expect(detail.job.status).toBe("failed");
        expect(detail.job.attempts).toBe(2);
        expect(new Set(detail.job.options.excludeClientIds)).toEqual(new Set(["client-a", "client-b"]));
        expect(detail.job.lastError).toBeInstanceOf(WorkflowNotSupportedError);
        const err = detail.job.lastError as WorkflowNotSupportedError;
        expect(err.workflowHash).toBe(detail.job.workflowHash);
        expect(Object.keys(err.reasons)).toEqual(expect.arrayContaining(["client-a", "client-b"]));
        expect(err.reasons["client-a"]).toContain("value_not_in_list");
        expect(err.reasons["client-b"]).toContain("value_not_in_list");

        await pool.shutdown();
    });

    it("respects job priority when processing queue", async () => {
        const client = new FakeWorkflowClient("client-priority");
        const pool = new WorkflowPool([client as any], { failoverStrategy });
        await pool.ready();

        const completionOrder: string[] = [];

        pool.on("job:accepted", (ev) => {
            const job = ev.detail.job;
            const name = job.options.metadata?.name as string;
            completionOrder.push(name);
            
            const promptId = job.promptId!;
            setTimeout(() => {
                void client.completePrompt(promptId, { "1": { data: { ok: true } } });
            }, 0);
        });

        // Enqueue all jobs quickly so they're in queue before processing starts
        const enqueuePromises = [
            pool.enqueue({ "1": { class_type: "test" } }, { 
                priority: 1,
                metadata: { name: "low-priority" }
            }),
            pool.enqueue({ "1": { class_type: "test" } }, { 
                priority: 10,
                metadata: { name: "high-priority" }
            }),
            pool.enqueue({ "1": { class_type: "test" } }, { 
                priority: 5,
                metadata: { name: "medium-priority" }
            })
        ];

        await Promise.all(enqueuePromises);

        // Wait for all jobs to complete
        await new Promise<void>((resolve) => {
            let completed = 0;
            pool.on("job:completed", () => {
                completed++;
                if (completed === 3) resolve();
            });
        });

        // Verify execution order respects priority (high > medium > low)
        expect(completionOrder).toEqual(["high-priority", "medium-priority", "low-priority"]);

        await pool.shutdown();
    });

    it("blocks follow-up jobs when the only compatible client stays busy (regression capture)", async () => {
        const genClient = new FakeWorkflowClient("host-gen");
        const editClient = new FakeWorkflowClient("host-edit");
        const spareClient = new FakeWorkflowClient("host-spare");

        const generationHash = hashWorkflow(SAMPLE_WORKFLOW);
        const editHash = hashWorkflow(EDIT_SAMPLE_WORKFLOW);

        const pool = new WorkflowPool([genClient as any, editClient as any, spareClient as any], {
            failoverStrategy,
            workflowAffinities: [
                { workflowHash: generationHash, preferredClientIds: ["host-gen"] },
                { workflowHash: editHash, preferredClientIds: ["host-edit"] }
            ]
        });
        await pool.ready();

        const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

        const offAccepted = pool.on("job:accepted", (ev) => {
            const job = ev.detail.job;
            const meta = job.options.metadata as Record<string, any> | undefined;
            if (meta?.type === "gen") {
                const promptId = job.promptId!;
                setTimeout(() => {
                    void genClient.completePrompt(promptId, { "2": { images: [{}] } });
                }, 0);
            } else if (meta?.type === "edit") {
                const promptId = job.promptId!;
                setTimeout(() => {
                    void editClient.completePrompt(promptId, { "207": { images: [{}] } });
                }, 0);
            }
        });

        let editEnqueued = false;
        const offCompleted = pool.on("job:completed", (ev) => {
            const job = ev.detail.job;
            const meta = job.options.metadata as Record<string, any> | undefined;
            if (!editEnqueued && meta?.type === "gen" && meta.index === 1) {
                editEnqueued = true;
                void pool.enqueue(Workflow.from(EDIT_SAMPLE_WORKFLOW).output("207"), {
                    includeOutputs: ["207"],
                    metadata: { type: "edit" },
                    preferredClientIds: ["host-edit"]
                });
            }
        });

        const waitForJobAccepted = async (jobId: string) => {
            const existing = pool.getJob(jobId);
            if (existing && existing.status !== "queued") {
                return { detail: { job: existing } } as WorkflowPoolEventMap["job:accepted"];
            }
            return new Promise<WorkflowPoolEventMap["job:accepted"]>((resolve) => {
                const off = pool.on("job:accepted", (ev) => {
                    if (ev.detail.job.jobId === jobId) {
                        off();
                        resolve(ev as WorkflowPoolEventMap["job:accepted"]);
                    }
                });
            });
        };

        const waitForJobCompleted = (jobId: string) =>
            new Promise<WorkflowPoolEventMap["job:completed"]>((resolve) => {
                const off = pool.on("job:completed", (ev) => {
                    if (ev.detail.job.jobId === jobId) {
                        off();
                        resolve(ev as WorkflowPoolEventMap["job:completed"]);
                    }
                });
            });

        const generationWorkflowA = Workflow.from(SAMPLE_WORKFLOW).output("2");
        const generationWorkflowB = Workflow.from(SAMPLE_WORKFLOW).output("2");

        const genJobA = await pool.enqueue(generationWorkflowA, {
            includeOutputs: ["2"],
            metadata: { type: "gen", index: 1 }
        });
        const genJobB = await pool.enqueue(generationWorkflowB, {
            includeOutputs: ["2"],
            metadata: { type: "gen", index: 2 }
        });

        const jobBAcceptedPromise = waitForJobAccepted(genJobB).then(() => "accepted");

        await waitForJobCompleted(genJobA);

        const raceResult = await Promise.race([jobBAcceptedPromise, delay(200).then(() => "timeout")]);

        offAccepted();
        offCompleted();
        await pool.shutdown();

        expect(raceResult).toBe("accepted");
    });
});
