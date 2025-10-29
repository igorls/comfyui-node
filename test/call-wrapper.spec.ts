import { describe, it, expect } from "bun:test";
import { CallWrapper } from "../src/call-wrapper";
import { PromptBuilder } from "../src/prompt-builder";
import {
  WentMissingError,
  FailedCacheError,
  ExecutionFailedError,
  ExecutionInterruptedError,
  CustomEventError,
  MissingNodeError
} from "../src/types/error";

// EventTarget-based fake API with minimal surface for CallWrapper
class FakeApi extends EventTarget {
  id = "fake";
  ext: any;
  osType: any = undefined;
  private queue: any = { queue_pending: [], queue_running: [] };
  private historyMap: Record<string, any>;
  constructor(historyMap: Record<string, any> = {}, opts: { pushToQueue?: boolean } = {}) {
    super();
    this.historyMap = historyMap;
    this.ext = {
      queue: {
        appendPrompt: async () => {
          const id = `pid-${Math.random().toString(36).slice(2)}`;
          if (opts.pushToQueue !== false) {
            this.queue.queue_pending.push([0, id]);
          }
          return { prompt_id: id };
        }
      },
      history: { getHistory: async (id: string) => this.historyMap[id] },
      node: { getNodeDefs: async () => ({}) }
    };
  }
  async getQueue() { return this.queue; }
  on(name: string, fn: any) { this.addEventListener(name, fn as any); return () => this.removeEventListener(name, fn as any); }
  emit(name: string, detail: any) { this.dispatchEvent(new CustomEvent(name, { detail })); }
  setHistory(id: string, data: any) { this.historyMap[id] = data; }
  removeFromQueue(id: string) {
    this.queue.queue_pending = this.queue.queue_pending.filter((q: any) => q[1] !== id);
    this.queue.queue_running = this.queue.queue_running.filter((q: any) => q[1] !== id);
  }
}

function baseBuilder() {
  const wf = { A: { class_type: "TypeA", inputs: {} }, B: { class_type: "TypeB", inputs: {} } } as any;
  return new PromptBuilder<any, any, any>(wf, ["in"], ["out"]).setRawOutputNode("out", "B");
}

describe("CallWrapper branches", () => {
  it("bypass missing node triggers MissingNodeError", async () => {
    const api = new FakeApi();
    const wf = { A: { class_type: "X", inputs: {} } } as any;
    const builder = new PromptBuilder<any, any, any>(wf, ["in"], ["out"]).setRawOutputNode("out", "A").bypass("B");
    let err: any = null;
    const wrapper = new CallWrapper(api as any, builder).onFailed((e) => (err = e));
    const res = await wrapper.run();
    expect(res).toBe(false);
    expect(err).toBeInstanceOf(MissingNodeError);
  });

  it("cached output success returns immediately", async () => {
    const history: Record<string, any> = {};
    const api = new FakeApi(history);
    let jobId: string | undefined;
    // Override append to inject history before executing phase
    (api as any).ext.queue.appendPrompt = async () => {
      jobId = "pid-cached";
      history[jobId] = { status: { completed: true }, outputs: { B: { val: 1 } } };
      // push queue entry so status handler sees it (won't matter since output cached)
      return { prompt_id: jobId };
    };
    const builder = baseBuilder();
    let finished: any = null;
    const wrapper = new CallWrapper(api as any, builder)
      .onPending(() => setTimeout(() => api.emit("executing", { prompt_id: jobId }), 0))
      .onFinished((out) => (finished = out));
    const res = await wrapper.run();
    expect(res).toBeTruthy();
    expect(finished.out.val).toBe(1);
  });

  it("cached output missing mapped nodes triggers FailedCacheError", async () => {
    const history: Record<string, any> = {};
    const api = new FakeApi(history);
    let jobId: string | undefined;
    (api as any).ext.queue.appendPrompt = async () => {
      jobId = "pid-cache-fail";
      history[jobId] = { status: { completed: true }, outputs: { /* no B */ } };
      return { prompt_id: jobId };
    };
    const builder = baseBuilder();
    let err: any = null;
    const wrapper = new CallWrapper(api as any, builder)
      .onPending(() => setTimeout(() => api.emit("executing", { prompt_id: jobId }), 0))
      .onFailed((e) => (err = e));
    const res = await wrapper.run();
    expect(res).toBe(false);
    expect(err).toBeInstanceOf(FailedCacheError);
  });

  it.skip("execution success after emitted executed event resolves output", async () => {
    const history: Record<string, any> = {};
    const api = new FakeApi(history);
    let jobId: string | undefined;
    const builder = baseBuilder();
    let finished: any = null;
    const wrapper = new CallWrapper(api as any, builder)
      .onPending((id) => {
        jobId = id;
        queueMicrotask(() => {
          api.emit("executing", { prompt_id: jobId });
          api.emit("progress", { prompt_id: jobId, value: 0 });
          queueMicrotask(() => {
            api.emit("executed", { prompt_id: jobId, node: "B", output: { data: 42 } });
            api.emit("execution_success", { prompt_id: jobId });
          });
        });
      })
      .onFinished((o) => (finished = o));
    
    // Add timeout to prevent infinite hang
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Test timeout')), 1000));
    const res = await Promise.race([wrapper.run(), timeout]);
    expect(res).toBeTruthy();
    expect(finished.out.data).toBe(42);
  }, 2000); // 2 second test timeout

  it.skip("handles execution events emitted immediately after queueing", async () => {
    const history: Record<string, any> = {};
    const api = new FakeApi(history);
    let jobId: string | undefined;
    const builder = baseBuilder();
    const wrapper = new CallWrapper(api as any, builder).onPending((id) => {
      jobId = id;
      setTimeout(() => {
        api.emit("executing", { prompt_id: jobId, node: "B" });
        api.emit("executed", { prompt_id: jobId, node: "B", output: { value: 7 } });
        api.emit("execution_success", { prompt_id: jobId });
      }, 0);
    });

    const result = (await wrapper.run()) as any;
    expect(result?.out?.value).toBe(7);
  });

  it.skip("execution_success without executed nodes triggers ExecutionFailedError", async () => {
    const history: Record<string, any> = {};
    const api = new FakeApi(history);
    let jobId: string | undefined;
    let err: any = null;
    const builder = baseBuilder();
    const wrapper = new CallWrapper(api as any, builder)
      .onPending((id) => {
        jobId = id;
        setTimeout(() => {
          api.emit("executing", { prompt_id: jobId });
          setTimeout(() => api.emit("execution_success", { prompt_id: jobId }), 0);
        }, 0);
      })
      .onFailed((e) => (err = e));
    const res = await wrapper.run();
    expect(res).toBe(false);
    expect(err).toBeInstanceOf(ExecutionFailedError);
  });

  it.skip("execution_interrupted triggers ExecutionInterruptedError", async () => {
    const history: Record<string, any> = {};
    const api = new FakeApi(history);
    let jobId: string | undefined;
    let err: any = null;
    const builder = baseBuilder();
    const wrapper = new CallWrapper(api as any, builder)
      .onPending((id) => {
        jobId = id;
        setTimeout(() => {
          api.emit("executing", { prompt_id: jobId });
          setTimeout(() => api.emit("execution_interrupted", { prompt_id: jobId, reason: "test" }), 0);
        }, 0);
      })
      .onFailed((e) => (err = e));
    const res = await wrapper.run();
    expect(res).toBe(false);
    expect(err).toBeInstanceOf(ExecutionInterruptedError);
  });

  it.skip("execution_error triggers CustomEventError", async () => {
    const history: Record<string, any> = {};
    const api = new FakeApi(history);
    let jobId: string | undefined;
    let err: any = null;
    const builder = baseBuilder();
    const wrapper = new CallWrapper(api as any, builder)
      .onPending((id) => {
        jobId = id;
        setTimeout(() => {
          api.emit("executing", { prompt_id: jobId });
          setTimeout(() => api.emit("execution_error", { prompt_id: jobId, exception_type: "Boom" }), 0);
        }, 0);
      })
      .onFailed((e) => (err = e));
    const res = await wrapper.run();
    expect(res).toBe(false);
    expect(err).toBeInstanceOf(CustomEventError);
  });

  it.skip("went missing triggers WentMissingError", async () => {
    const history: Record<string, any> = {};
    // Do not push to queue so status event finds no entry
    const api = new FakeApi(history, { pushToQueue: false });
    let jobId: string | undefined;
    let err: any = null;
    const builder = baseBuilder();
    const wrapper = new CallWrapper(api as any, builder)
      .onPending((id) => {
        jobId = id;
        setTimeout(() => {
          api.emit("status", { queue_pending: [], queue_running: [] });
        }, 0);
      })
      .onFailed((e) => (err = e));
    const res = await wrapper.run();
    expect(res).toBe(false);
    expect(err).toBeInstanceOf(WentMissingError);
  });

  it.skip("streams progress & preview events and finishes", async () => {
    const history: Record<string, any> = {};
    const api = new FakeApi(history);
    let jobId: string | undefined;
    const builder = baseBuilder();
    // Track callbacks
    let progressEvents = 0;
    let previewEvents = 0;
    let finished: any = null;

    const wrapper = new CallWrapper(api as any, builder)
      .onPending((id) => {
        jobId = id;
        setTimeout(() => {
          api.emit("executing", { prompt_id: jobId });
          // simulate progress steps
          for (let v = 1; v <= 3; v++) {
            setTimeout(() => api.emit("progress", { prompt_id: jobId, value: v, max: 3 }), v * 5);
          }
          // emit two preview frames interleaved
          setTimeout(() => api.dispatchEvent(new CustomEvent("b_preview", { detail: new Blob([new Uint8Array([1,2,3])], { type: "image/jpeg" }) })), 8);
          setTimeout(() => api.dispatchEvent(new CustomEvent("b_preview", { detail: new Blob([new Uint8Array([4,5,6])], { type: "image/png" }) })), 15);
          // executed + success
          setTimeout(() => {
            api.emit("executed", { prompt_id: jobId, node: "B", output: { images: [{ filename: "x.png", subfolder: "", type: "output" }] } });
            api.emit("execution_success", { prompt_id: jobId });
          }, 25);
        }, 0);
      })
      .onProgress(() => progressEvents++)
      .onPreview(() => previewEvents++)
      .onFinished((o) => (finished = o));

    const res = await wrapper.run();
    expect(res).toBeTruthy();
    expect(finished).toBeTruthy();
    expect(progressEvents).toBeGreaterThanOrEqual(3);
    expect(previewEvents).toBeGreaterThanOrEqual(2);
  });
});
