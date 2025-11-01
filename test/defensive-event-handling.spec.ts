import { ComfyApi } from "../src/client";

describe("Defensive Event Handling", () => {
  let api: ComfyApi;

  beforeEach(() => {
    api = new ComfyApi("http://localhost:8188", "test-client-id");
  });

  afterEach(() => {
    api.destroy();
  });

  describe("status event", () => {
    test("handles null status gracefully", () => {
      const handler = jest.fn();
      api.on("status", handler);

      // Force socket creation
      (api as any).createSocket();
      const sock: any = api.socket;

      // Emit status event with null detail
      const event = new CustomEvent("status", { detail: null });
      api.dispatchEvent(event);

      // Handler should be called
      expect(handler).toHaveBeenCalledWith(event);
    });

    test("handles missing exec_info gracefully", () => {
      const handler = jest.fn();
      api.on("status", handler);

      (api as any).createSocket();

      // Emit status event with missing exec_info
      const event = new CustomEvent("status", {
        detail: { status: {} } as any
      });
      api.dispatchEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    test("handles missing queue_remaining gracefully", () => {
      const handler = jest.fn();
      api.on("status", handler);

      (api as any).createSocket();

      // Emit status event with missing queue_remaining
      const event = new CustomEvent("status", {
        detail: { status: { exec_info: {} } } as any
      });
      api.dispatchEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    test("handles valid status event", () => {
      const handler = jest.fn();
      api.on("status", handler);

      (api as any).createSocket();

      const validDetail = {
        status: {
          exec_info: {
            queue_remaining: 5
          }
        },
        sid: "test-session"
      };

      const event = new CustomEvent("status", { detail: validDetail });
      api.dispatchEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });
  });

  describe("progress event", () => {
    test("handles null detail gracefully", () => {
      const handler = jest.fn();
      api.on("progress", handler);

      const event = new CustomEvent("progress", { detail: null as any });
      api.dispatchEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    test("handles missing value gracefully", () => {
      const handler = jest.fn();
      api.on("progress", handler);

      const event = new CustomEvent("progress", {
        detail: { max: 100, prompt_id: "test" } as any
      });
      api.dispatchEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    test("handles missing max gracefully", () => {
      const handler = jest.fn();
      api.on("progress", handler);

      const event = new CustomEvent("progress", {
        detail: { value: 50, prompt_id: "test" } as any
      });
      api.dispatchEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    test("handles valid progress event", () => {
      const handler = jest.fn();
      api.on("progress", handler);

      const validDetail = {
        prompt_id: "test-123",
        node: "ksampler",
        value: 5,
        max: 20
      };

      const event = new CustomEvent("progress", { detail: validDetail });
      api.dispatchEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });
  });

  describe("executed event", () => {
    test("handles null detail gracefully", () => {
      const handler = jest.fn();
      api.on("executed", handler);

      const event = new CustomEvent("executed", { detail: null as any });
      api.dispatchEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    test("handles missing prompt_id gracefully", () => {
      const handler = jest.fn();
      api.on("executed", handler);

      const event = new CustomEvent("executed", {
        detail: { node: "test", output: {} } as any
      });
      api.dispatchEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    test("handles missing output gracefully", () => {
      const handler = jest.fn();
      api.on("executed", handler);

      const event = new CustomEvent("executed", {
        detail: { prompt_id: "test-123", node: "test" } as any
      });
      api.dispatchEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    test("handles valid executed event", () => {
      const handler = jest.fn();
      api.on("executed", handler);

      const validDetail = {
        prompt_id: "test-123",
        node: "save_image",
        output: {
          images: [{ filename: "test.png", subfolder: "", type: "output" }]
        }
      };

      const event = new CustomEvent("executed", { detail: validDetail });
      api.dispatchEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });
  });

  describe("executing event", () => {
    test("handles null detail gracefully", () => {
      const handler = jest.fn();
      api.on("executing", handler);

      const event = new CustomEvent("executing", { detail: null as any });
      api.dispatchEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    test("handles missing prompt_id gracefully", () => {
      const handler = jest.fn();
      api.on("executing", handler);

      const event = new CustomEvent("executing", {
        detail: { node: "test" } as any
      });
      api.dispatchEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    test("handles null node (execution complete) gracefully", () => {
      const handler = jest.fn();
      api.on("executing", handler);

      const event = new CustomEvent("executing", {
        detail: { prompt_id: "test-123", node: null }
      });
      api.dispatchEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    test("handles valid executing event", () => {
      const handler = jest.fn();
      api.on("executing", handler);

      const validDetail = {
        prompt_id: "test-123",
        node: "ksampler"
      };

      const event = new CustomEvent("executing", { detail: validDetail });
      api.dispatchEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });
  });

  describe("execution_cached event", () => {
    test("handles null detail gracefully", () => {
      const handler = jest.fn();
      api.on("execution_cached", handler);

      const event = new CustomEvent("execution_cached", { detail: null as any });
      api.dispatchEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    test("handles missing nodes array gracefully", () => {
      const handler = jest.fn();
      api.on("execution_cached", handler);

      const event = new CustomEvent("execution_cached", {
        detail: { prompt_id: "test-123" } as any
      });
      api.dispatchEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    test("handles non-array nodes gracefully", () => {
      const handler = jest.fn();
      api.on("execution_cached", handler);

      const event = new CustomEvent("execution_cached", {
        detail: { prompt_id: "test-123", nodes: "not-an-array" } as any
      });
      api.dispatchEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    test("handles valid execution_cached event", () => {
      const handler = jest.fn();
      api.on("execution_cached", handler);

      const validDetail = {
        prompt_id: "test-123",
        nodes: ["1", "2", "3"]
      };

      const event = new CustomEvent("execution_cached", { detail: validDetail });
      api.dispatchEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });
  });

  describe("b_preview_meta event", () => {
    test("handles null detail gracefully", () => {
      const handler = jest.fn();
      api.on("b_preview_meta", handler);

      const event = new CustomEvent("b_preview_meta", { detail: null as any });
      api.dispatchEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    test("handles missing metadata gracefully", () => {
      const handler = jest.fn();
      api.on("b_preview_meta", handler);

      const blob = new Blob(["test"], { type: "image/png" });
      const event = new CustomEvent("b_preview_meta", {
        detail: { blob } as any
      });
      api.dispatchEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    test("handles missing blob gracefully", () => {
      const handler = jest.fn();
      api.on("b_preview_meta", handler);

      const event = new CustomEvent("b_preview_meta", {
        detail: { metadata: { prompt_id: "test" } } as any
      });
      api.dispatchEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    test("handles valid b_preview_meta event", () => {
      const handler = jest.fn();
      api.on("b_preview_meta", handler);

      const blob = new Blob(["test"], { type: "image/png" });
      const validDetail = {
        blob,
        metadata: {
          prompt_id: "test-123",
          image_type: "image/png"
        }
      };

      const event = new CustomEvent("b_preview_meta", { detail: validDetail });
      api.dispatchEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });
  });

  describe("execution_error event", () => {
    test("handles null detail gracefully", () => {
      const handler = jest.fn();
      api.on("execution_error", handler);

      const event = new CustomEvent("execution_error", { detail: null as any });
      api.dispatchEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    test("handles missing fields gracefully", () => {
      const handler = jest.fn();
      api.on("execution_error", handler);

      const event = new CustomEvent("execution_error", {
        detail: { prompt_id: "test-123" } as any
      });
      api.dispatchEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    test("handles valid execution_error event", () => {
      const handler = jest.fn();
      api.on("execution_error", handler);

      const validDetail = {
        prompt_id: "test-123",
        node_id: "5",
        node_type: "KSampler",
        exception_message: "CUDA out of memory",
        exception_type: "RuntimeError",
        traceback: ["line 1", "line 2"]
      };

      const event = new CustomEvent("execution_error", { detail: validDetail });
      api.dispatchEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });
  });

  describe("edge case scenarios", () => {
    test("handles undefined detail", () => {
      const handler = jest.fn();
      api.on("status", handler);

      const event = new CustomEvent("status", { detail: undefined as any });
      api.dispatchEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    test("handles deeply nested null values", () => {
      const handler = jest.fn();
      api.on("status", handler);

      const event = new CustomEvent("status", {
        detail: {
          status: null
        } as any
      });
      api.dispatchEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    test("multiple handlers all receive events safely", () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      const handler3 = jest.fn();

      api.on("progress", handler1);
      api.on("progress", handler2);
      api.on("progress", handler3);

      const event = new CustomEvent("progress", { detail: null as any });
      api.dispatchEvent(event);

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
      expect(handler3).toHaveBeenCalled();
    });
  });
});
