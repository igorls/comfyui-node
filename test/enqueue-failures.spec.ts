import { describe, it, expect, beforeEach } from "bun:test";
import { buildEnqueueFailedError } from "../src/utils/response-error";
import { EnqueueFailedError } from "../src/types/error";
import { PromptBuilder } from "../src/prompt-builder";
import { CallWrapper } from "../src/call-wrapper";
import { ComfyApi } from "../src/client";

// Lightweight workflow: one node with no real execution expected (we will force failures before real run)
const dummyWorkflow: any = { 1: { class_type: "LoadImage", inputs: {} } };

// We'll monkey patch queue.appendPrompt for controlled failures
function makeApi(): ComfyApi {
  const api = new ComfyApi("http://localhost:8188", "test-client");
  const ext: any = {};
  // minimal history feature
  ext.history = { getHistory: async () => ({ status: { completed: false } }) };
  // queue feature placeholder (appendPrompt will be patched per test)
  ext.queue = { appendPrompt: async () => ({ prompt_id: "dummy" }) };
  // Attach ext via defineProperty to bypass readonly typing in tests
  Object.defineProperty(api, 'ext', { value: ext, configurable: true });
  return api;
}

describe("enqueue failure diagnostics", () => {
  let api: ComfyApi;
  beforeEach(() => { api = makeApi(); });

  it("captures JSON error body fields (status, reason, bodyJSON)", async () => {
    const jsonBody = { error: "Model missing", info: { path: "x" } };
    // mock queue.appendPrompt to throw Response with JSON
    (api as any).ext.queue.appendPrompt = async () => {
      const resp = new Response(JSON.stringify(jsonBody), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
      throw resp;
    };

    let captured: any = null;
    const builder = new PromptBuilder(dummyWorkflow, ["input"], ["out"] as any);
    const wrapper = new CallWrapper(api, builder)
      .onFailed((err) => { captured = err; });

    const res = await wrapper.run();
    expect(res).toBe(false);
    expect(captured).toBeInstanceOf(EnqueueFailedError);
    expect(captured.status).toBe(400);
    expect(captured.bodyJSON).toEqual(jsonBody);
    expect(captured.reason).toContain("Model missing");
  });

  it("falls back to text body snippet when JSON parse unavailable", async () => {
    const textBody = "Some plain failure text about missing dependency";
    (api as any).ext.queue.appendPrompt = async () => {
      const resp = new Response(textBody, {
        status: 500,
        headers: { "content-type": "text/plain" },
      });
      throw resp;
    };

    let captured: any = null;
    const builder = new PromptBuilder(dummyWorkflow, ["input"], ["out"] as any);
    const wrapper = new CallWrapper(api, builder).onFailed((err) => { captured = err; });
    const res = await wrapper.run();
    expect(res).toBe(false);
    expect(captured).toBeInstanceOf(EnqueueFailedError);
    expect(captured.status).toBe(500);
    expect(captured.bodyJSON).toBeUndefined();
    expect(captured.bodyTextSnippet).toContain("Some plain failure text");
    expect(captured.reason).toContain("Some plain failure text");
  });
});

describe("buildEnqueueFailedError standalone", () => {
  it("derives reason from nested errors array first entry object", async () => {
    const resp = new Response(JSON.stringify({ errors: [{ message: "Inner boom" }] }), {
      status: 422,
      headers: { "content-type": "application/json" },
    });
    const err = await buildEnqueueFailedError(resp);
    expect(err).toBeInstanceOf(EnqueueFailedError);
    expect(err.status).toBe(422);
    expect(err.reason).toBe("Inner boom");
    expect(err.bodyJSON.errors[0].message).toBe("Inner boom");
  });

  it("handles non-json body gracefully", async () => {
    const resp = new Response("<html>Bad Gateway</html>", { status: 502, headers: { "content-type": "text/html" } });
    const err = await buildEnqueueFailedError(resp);
    expect(err).toBeInstanceOf(EnqueueFailedError);
    expect(err.status).toBe(502);
    expect(err.bodyJSON).toBeUndefined();
    expect(err.bodyTextSnippet).toContain("Bad Gateway");
  });
});

describe("Workflow.run() error handling without pool", () => {
  it("gracefully handles enqueue failures without crashing", async () => {
    const { Workflow } = await import("../src/workflow");
    const api = makeApi();
    const jsonBody = { error: { type: "prompt_validation_failed", message: "Invalid prompt" } };
    
    // mock queue.appendPrompt to throw Response with JSON
    (api as any).ext.queue.appendPrompt = async () => {
      const resp = new Response(JSON.stringify(jsonBody), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
      throw resp;
    };

    const wf = Workflow.from(dummyWorkflow);
    
    // This should NOT crash with unhandled promise rejection
    // Instead, it should properly reject the promise returned by run()
    let caughtError: any = null;
    let didCatch = false;
    try {
      const job = await wf.run(api as any);
      // The run() should reject during enqueue, so we shouldn't get here
      console.log("[TEST] Got job:", job);
    } catch (err) {
      didCatch = true;
      caughtError = err;
      console.log("[TEST] Caught error:", err?.constructor?.name);
    }
    
    // Verify the error was properly caught
    expect(didCatch).toBe(true);
    expect(caughtError).toBeInstanceOf(EnqueueFailedError);
    expect(caughtError.status).toBe(400);
    expect(caughtError.bodyJSON).toEqual(jsonBody);
  });

  it("emits failed event and rejects job.done() on enqueue failure", async () => {
    const { Workflow } = await import("../src/workflow");
    const api = makeApi();
    const jsonBody = { error: { type: "model_not_found", message: "Model missing" } };
    
    (api as any).ext.queue.appendPrompt = async () => {
      const resp = new Response(JSON.stringify(jsonBody), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
      throw resp;
    };

    const wf = Workflow.from(dummyWorkflow);
    
    let failedEventError: any = null;
    let doneRejectionError: any = null;
    
    try {
      const job = await wf.run(api as any);
      
      // Listen for failed event
      job.on("failed", (err) => {
        failedEventError = err;
      });
      
      // Attempt to wait for completion
      try {
        await job.done();
      } catch (err) {
        doneRejectionError = err;
      }
    } catch (err) {
      // If run() itself rejects, that's also acceptable
      doneRejectionError = err;
    }
    
    // Either the run() or done() should have caught the error
    expect(doneRejectionError || failedEventError).toBeInstanceOf(EnqueueFailedError);
  });
});
