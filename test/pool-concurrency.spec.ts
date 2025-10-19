import { describe, it, expect } from "bun:test";
import { ComfyPool, EQueueMode } from "../src/pool";
import { CallWrapper } from "../src/call-wrapper";
import { PromptBuilder } from "../src/prompt-builder";

class MockConcurrentApi extends EventTarget {
	public id: string;
	public osType = "posix";
	public ext: any;
	private queueList: string[] = [];
	private jobCounter = 0;
	private history: Record<string, any> = {};

	constructor(id: string) {
		super();
		this.id = id;
		this.ext = {
			monitor: { isSupported: false, on: () => () => {} },
			queue: { appendPrompt: async (wf: any) => this.appendPrompt(wf) },
			history: { getHistory: async (pid: string) => this.history[pid] },
			node: { getNodeDefs: async () => ({}) }
		};
	}

	async init() {
		this.emitStatus(0);
		return this;
	}

	destroy() {
		this.queueList = [];
	}

	on(type: string, fn: (ev: CustomEvent) => void) {
		const handler = (ev: Event) => fn(ev as CustomEvent);
		this.addEventListener(type as any, handler as EventListener);
		return () => this.removeEventListener(type as any, handler as EventListener);
	}

	async getQueue() {
		return {
			queue_pending: this.queueList.map((pid, idx) => [idx, pid]) as Array<[number, string]>,
			queue_running: [] as Array<[number, string]>
		};
	}

	private async appendPrompt(_workflow: any) {
		const promptId = `${this.id}-job-${++this.jobCounter}`;
		this.history[promptId] = { status: { completed: false }, outputs: { B: { images: [] } } };
		this.queueList.push(promptId);
		this.emitStatus(this.queueList.length);
		return { prompt_id: promptId };
	}

	async completeJob(promptId: string) {
		if (!this.queueList.includes(promptId)) {
			return;
		}

		const run = () => {
			this.dispatchEvent(new CustomEvent("executing", { detail: { prompt_id: promptId, node: "B" } }));
			this.dispatchEvent(new CustomEvent("progress", { detail: { prompt_id: promptId, node: "B", value: 1, max: 1 } }));
			const output = { images: [{ promptId, client: this.id }] };
			this.dispatchEvent(new CustomEvent("executed", { detail: { prompt_id: promptId, node: "B", output } }));
			this.history[promptId] = { status: { completed: true }, outputs: { B: output } };
			this.queueList = this.queueList.filter((pid) => pid !== promptId);
			this.emitStatus(this.queueList.length);
		};

		await Promise.resolve();
		run();
	}

	private emitStatus(queueRemaining: number) {
		this.dispatchEvent(
			new CustomEvent("status", {
				detail: { status: { exec_info: { queue_remaining: queueRemaining } } }
			})
		);
	}
}

function buildWorkflow() {
	return {
		A: { class_type: "EmptyLatentImage", inputs: { width: 8, height: 8, batch_size: 1 } },
		B: { class_type: "SaveImage", inputs: { images: ["A", 0], filename_prefix: "x" } }
	} as any;
}

function createBuilder() {
	let builder = new PromptBuilder(buildWorkflow(), [], ["out"]);
	builder = builder.setOutputNode("out", "B");
	return builder;
}

function createLatch(count: number) {
	let remaining = count;
	let resolve!: () => void;
	const promise = new Promise<void>((res) => {
		resolve = res;
	});
	return {
		promise,
		signal() {
			remaining -= 1;
			if (remaining === 0) {
				resolve();
			}
		}
	};
}

describe("ComfyPool concurrency", () => {
	it("processes more jobs than clients without dropping events", async () => {
		const clientA = new MockConcurrentApi("c0");
		const clientB = new MockConcurrentApi("c1");
		const pool = new ComfyPool([clientA as any, clientB as any], EQueueMode.PICK_ROUTINE);

			await new Promise<void>((resolve) => {
				pool.addEventListener("init", () => resolve(), { once: true });
			});

			const assignments: Array<{ label: string; clientId: string; promptId: string }> = [];
			const telemetry: Record<string, { progress: number; outputs: number; finished: boolean; failure?: Error }> = {};
			const latch = createLatch(3);

			const runJob = (label: string) =>
				pool.run(async (api: any) => {
					telemetry[label] = { progress: 0, outputs: 0, finished: false };
					const wrapper = new CallWrapper(api, createBuilder())
									.onPending((pid) => {
							assignments.push({ label, clientId: api.id, promptId: pid! });
							latch.signal();
						})
						.onProgress(() => {
							telemetry[label].progress++;
						})
						.onOutput(() => {
							telemetry[label].outputs++;
						})
									.onFinished(() => {
							telemetry[label].finished = true;
						})
									.onFailed((err) => {
							telemetry[label].failure = err as Error;
						});

					return wrapper.run();
				});

			const jobPromises = ["req1", "req2", "req3"].map((label) => runJob(label));

			try {
				await latch.promise;

				expect(assignments.length).toBe(3);

				const clientCount = new Set(assignments.map((a) => a.clientId)).size;
				expect(clientCount).toBe(2);

				const byClient: Record<string, MockConcurrentApi> = {
					[clientA.id]: clientA,
					[clientB.id]: clientB
				};

				const grouped: Record<string, Array<{ label: string; promptId: string }>> = {};
				for (const assignment of assignments) {
					if (!grouped[assignment.clientId]) {
						grouped[assignment.clientId] = [];
					}
					grouped[assignment.clientId].push({ label: assignment.label, promptId: assignment.promptId });
				}

				const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

				const completionTasks = Object.entries(grouped).map(([clientId, prompts], clientIdx) =>
					(async () => {
						let tick = 1;
						for (const { promptId } of prompts) {
							await delay(20 * (clientIdx + tick));
							await byClient[clientId].completeJob(promptId);
							tick++;
						}
					})()
				);

				await Promise.all(completionTasks);

				const results = await Promise.all(jobPromises);

				expect(results.length).toBe(3);
				for (const label of ["req1", "req2", "req3"]) {
					expect(telemetry[label].finished).toBe(true);
					expect(telemetry[label].progress).toBeGreaterThan(0);
					expect(telemetry[label].outputs).toBeGreaterThan(0);
					if (telemetry[label].failure) {
						throw telemetry[label].failure;
					}
				}
			} finally {
				pool.destroy();
			}
	});
});

