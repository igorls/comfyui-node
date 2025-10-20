import { WorkflowPool } from "../src/pool/WorkflowPool";
import { Workflow } from "../src/workflow";
import type { WorkflowPoolEventMap } from "../src/pool/types/events";

const TIMEOUT_MS = Number(process.env.DEBUG_TIMEOUT_MS ?? 20_000);
const EVENT_TIMEOUT_MS = Number(process.env.EVENT_TIMEOUT_MS ?? 5_000);
const timeout = setTimeout(() => {
  console.error(`[workflow-pool-debug] Timeout (${TIMEOUT_MS}ms) reached, forcing exit.`);
  process.exit(2);
}, TIMEOUT_MS);
(timeout as any).unref?.();

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
          console.log(`[client:${this.id}] interrupt ${promptId}`);
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
        uploadImage: async () => {}
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
    console.log(`[client:${this.id}] completing ${promptId} with nodes ${nodes.join(",")}`);
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
    console.log(`[client:${this.id}] failing ${promptId} with ${message}`);
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

const SAMPLE_WORKFLOW = {
  "1": { class_type: "EmptyLatentImage", inputs: { width: 8, height: 8, batch_size: 1 } },
  "2": { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "demo" } }
};

function waitForEvent<K extends keyof WorkflowPoolEventMap>(pool: WorkflowPool, event: K) {
  return new Promise<WorkflowPoolEventMap[K]>((resolve) => {
    pool.once(event, (ev) => resolve(ev as WorkflowPoolEventMap[K]));
  });
}

async function withTimeout<T>(promise: Promise<T>, label: string, ms = EVENT_TIMEOUT_MS): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`[timeout] ${label} after ${ms}ms`));
    }, ms);
    (timeoutId as any)?.unref?.();
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    return result;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function scenarioSuccess() {
  console.log("[scenarioSuccess] start");
  const client = new FakeWorkflowClient("success-client");
  const pool = new WorkflowPool([client as any]);
  await pool.ready();
  const wf = Workflow.from(SAMPLE_WORKFLOW).output("result", "2");

  const offAccepted = pool.on("job:accepted", (ev) => {
    console.log(`[scenarioSuccess] accepted job ${ev.detail.job.jobId} attempts=${ev.detail.job.attempts}`);
    const promptId = ev.detail.job.promptId!;
    queueMicrotask(() => {
      void client.completePrompt(promptId, { "2": { data: { ok: true } } });
    });
  });

  const completionPromise = withTimeout(waitForEvent(pool, "job:completed"), "job:completed");
  const jobId = await pool.enqueue(wf, { includeOutputs: ["2"] });
  console.log("[scenarioSuccess] enqueued", jobId);
  const completed = await completionPromise;
  console.log("[scenarioSuccess] completed", completed.detail.job.result);
  offAccepted();
  await pool.shutdown();
}

async function scenarioRetry() {
  console.log("[scenarioRetry] start");
  const client = new FakeWorkflowClient("retry-client");
  const pool = new WorkflowPool([client as any], { retryBackoffMs: 10 });
  await pool.ready();
  const wf = Workflow.from(SAMPLE_WORKFLOW).output("result", "2");

  const offFailed = pool.on("job:failed", (ev) => {
    console.log(`[scenarioRetry] job failed attempt=${ev.detail.job.attempts} willRetry=${ev.detail.willRetry}`);
  });
  const offQueued = pool.on("job:queued", (ev) => {
    console.log(`[scenarioRetry] job queued status=${ev.detail.job.status} attempt=${ev.detail.job.attempts}`);
  });
  const offAccepted = pool.on("job:accepted", (ev) => {
    console.log(`[scenarioRetry] accepted job ${ev.detail.job.jobId} attempt=${ev.detail.job.attempts}`);
    const promptId = ev.detail.job.promptId!;
    queueMicrotask(() => {
      if (ev.detail.job.attempts === 1) {
        void client.failPrompt(promptId, "first-attempt");
      } else {
        void client.completePrompt(promptId, { "2": { data: { attempt: ev.detail.job.attempts } } });
      }
    });
  });

  const retrying = withTimeout(waitForEvent(pool, "job:retrying"), "job:retrying");
  const completed = withTimeout(waitForEvent(pool, "job:completed"), "job:completed(retry)");

  const jobId = await pool.enqueue(wf, { includeOutputs: ["2"], maxAttempts: 2 });
  console.log("[scenarioRetry] enqueued", jobId);

  const retryEvent = await retrying;
  console.log("[scenarioRetry] retrying", retryEvent.detail.job.attempts, retryEvent.detail.delayMs);
  const completedEvent = await completed;
  console.log("[scenarioRetry] completed", completedEvent.detail.job.result);

  offQueued();
  offFailed();
  offAccepted();
  await pool.shutdown();
}

async function scenarioCancel() {
  console.log("[scenarioCancel] start");
  const client = new FakeWorkflowClient("cancel-client");
  const pool = new WorkflowPool([client as any]);
  await pool.ready();
  const wf = Workflow.from(SAMPLE_WORKFLOW).output("result", "2");

  const accepted = withTimeout(waitForEvent(pool, "job:accepted"), "job:accepted(cancel)");
  const jobId = await pool.enqueue(wf, { includeOutputs: ["2"] });
  console.log("[scenarioCancel] enqueued", jobId);
  const { detail } = await accepted;
  console.log("[scenarioCancel] accepted", detail.job.promptId);

  const cancelled = withTimeout(waitForEvent(pool, "job:cancelled"), "job:cancelled");
  const success = await pool.cancel(jobId);
  console.log("[scenarioCancel] cancel() returned", success);
  const cancelEvent = await cancelled;
  console.log("[scenarioCancel] cancelled event", cancelEvent.detail.job.status, client.interrupted);

  await pool.shutdown();
}

(async () => {
  try {
    await scenarioSuccess();
    await scenarioRetry();
    await scenarioCancel();
    clearTimeout(timeout);
    console.log("[workflow-pool-debug] All scenarios completed");
    process.exit(0);
  } catch (error) {
    console.error("[workflow-pool-debug] Error", error);
    process.exit(1);
  }
})();
