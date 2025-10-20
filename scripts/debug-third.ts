import { CallWrapper } from "../src/call-wrapper";
import { PromptBuilder } from "../src/prompt-builder";
import { FailedCacheError } from "../src/types/error";

class FakeApi extends EventTarget {
  ext: any;
  queue = { queue_pending: [] as any[], queue_running: [] as any[] };
  historyMap: Record<string, any> = {};
  constructor() {
    super();
    this.ext = {
      queue: {
        appendPrompt: async () => {
          const id = "pid-cache-fail";
          this.queue.queue_pending.push([0, id]);
          return { prompt_id: id };
        }
      },
      history: { getHistory: async (id: string) => this.historyMap[id] },
      node: { getNodeDefs: async () => ({}) }
    };
  }
  async getQueue() {
    return this.queue;
  }
  on(name: string, fn: any) {
    this.addEventListener(name, fn as any);
    return () => this.removeEventListener(name, fn as any);
  }
  emit(name: string, detail: any) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }
}

async function main() {
  const api = new FakeApi();
  const builder = new PromptBuilder<any, any, any>({
    A: { class_type: "TypeA", inputs: {} },
    B: { class_type: "TypeB", inputs: {} }
  } as any, ["in"], ["out"]).setRawOutputNode("out", "B");

  api.historyMap["pid-cache-fail"] = { status: { completed: true }, outputs: {} };

  const wrapper = new CallWrapper(api as any, builder)
    .onPending((id) => {
      setTimeout(() => api.emit("executing", { prompt_id: id }), 0);
    })
    .onFailed((err) => {
      console.log("failed", err instanceof FailedCacheError, err.name, err.message);
    });

  const result = await wrapper.run();
  console.log("result", result);
}

main().catch((err) => {
  console.error("main error", err);
});
