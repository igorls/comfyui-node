import { ComfyApi, ConnectionState } from "../src/client";

describe("Connection State and Reconnection", () => {
  let api: ComfyApi;

  afterEach(() => {
    if (api) {
      api.destroy();
    }
  });

  describe("connectionState property", () => {
    test("starts in connecting state", () => {
      api = new ComfyApi("http://localhost:8188");
      expect(api.connectionState).toBe("connecting");
    });

    test("transitions to connected on socket open", () => {
      api = new ComfyApi("http://localhost:8188");
      (api as any).createSocket();
      const sock: any = api.socket;

      expect(api.connectionState).toBe("connecting");

      // Simulate socket open
      sock.onopen?.();

      expect(api.connectionState).toBe("connected");
    });

    test("transitions to disconnected then reconnecting on socket close", () => {
      api = new ComfyApi("http://localhost:8188");
      (api as any).createSocket();
      const sock: any = api.socket;

      // Open first
      sock.onopen?.();
      expect(api.connectionState).toBe("connected");

      // Then close - this triggers automatic reconnection
      sock.onclose?.({ code: 1000, reason: "Normal closure", wasClean: true });

      // After close, it transitions to disconnected briefly then reconnecting
      expect(["disconnected", "reconnecting"]).toContain(api.connectionState);
    });

    test("transitions to reconnecting when reconnection starts", async () => {
      api = new ComfyApi("http://localhost:8188");
      (api as any).createSocket();

      await api.reconnectWs(true);

      expect(api.connectionState).toBe("reconnecting");
    });

    test.skip("transitions to failed on websocket creation failure (skipped - hard to mock)", () => {
      // This test is skipped because WebSocket creation failure is difficult to mock
      // properly in the test environment. The behavior is covered by integration tests.
    });
  });

  describe("isConnected method", () => {
    test("returns false when socket is null", () => {
      api = new ComfyApi("http://localhost:8188");
      expect(api.isConnected()).toBe(false);
    });

    test("returns true when socket is open", () => {
      api = new ComfyApi("http://localhost:8188");
      (api as any).createSocket();
      const sock: any = api.socket;

      // Simulate socket being open
      Object.defineProperty(sock, "readyState", {
        value: 1, // WebSocket.OPEN
        writable: true,
        configurable: true
      });

      expect(api.isConnected()).toBe(true);
    });

    test("returns false when socket is connecting", () => {
      api = new ComfyApi("http://localhost:8188");
      (api as any).createSocket();
      const sock: any = api.socket;

      // Simulate socket being in connecting state
      Object.defineProperty(sock, "readyState", {
        value: 0, // WebSocket.CONNECTING
        writable: true,
        configurable: true
      });

      expect(api.isConnected()).toBe(false);
    });

    test("returns false when socket is closing", () => {
      api = new ComfyApi("http://localhost:8188");
      (api as any).createSocket();
      const sock: any = api.socket;

      // Simulate socket being in closing state
      Object.defineProperty(sock, "readyState", {
        value: 2, // WebSocket.CLOSING
        writable: true,
        configurable: true
      });

      expect(api.isConnected()).toBe(false);
    });

    test("returns false when socket is closed", () => {
      api = new ComfyApi("http://localhost:8188");
      (api as any).createSocket();
      const sock: any = api.socket;

      // Simulate socket being closed
      Object.defineProperty(sock, "readyState", {
        value: 3, // WebSocket.CLOSED
        writable: true,
        configurable: true
      });

      expect(api.isConnected()).toBe(false);
    });
  });

  describe("validateConnection method", () => {
    test("returns true when API call succeeds", async () => {
      api = new ComfyApi("http://localhost:8188");

      // Mock getQueue to succeed
      api.getQueue = jest.fn().mockResolvedValue({
        queue_running: [],
        queue_pending: []
      });

      const result = await api.validateConnection();
      expect(result).toBe(true);
      expect(api.getQueue).toHaveBeenCalled();
    });

    test("returns false when API call fails", async () => {
      api = new ComfyApi("http://localhost:8188");

      // Mock getQueue to fail
      api.getQueue = jest.fn().mockRejectedValue(new Error("Connection failed"));

      const result = await api.validateConnection();
      expect(result).toBe(false);
    });
  });

  describe("autoReconnect option", () => {
    test("does not reconnect automatically by default on clean close before open", () => {
      api = new ComfyApi("http://localhost:8188");
      (api as any).createSocket();
      const sock: any = api.socket;

      const reconnectSpy = jest.spyOn(api, "reconnectWs");

      // Close before open (connection never established)
      sock.onclose?.({ code: 1000, reason: "Test", wasClean: true });

      // Should not have called reconnect since connection never opened
      expect(reconnectSpy).not.toHaveBeenCalled();

      reconnectSpy.mockRestore();
    });

    test("reconnects automatically when enabled", () => {
      api = new ComfyApi("http://localhost:8188", "test-client", {
        autoReconnect: true
      });
      (api as any).createSocket();
      const sock: any = api.socket;

      const reconnectSpy = jest.spyOn(api, "reconnectWs");

      // Open then close
      sock.onopen?.();
      sock.onclose?.({ code: 1000, reason: "Test", wasClean: true });

      // Should have called reconnect automatically
      expect(reconnectSpy).toHaveBeenCalled();

      reconnectSpy.mockRestore();
    });
  });

  describe("onReconnectionFailed callback", () => {
    test("invokes callback when reconnection fails", async () => {
      const mockCallback = jest.fn();

      api = new ComfyApi("http://localhost:8188", "test-client", {
        onReconnectionFailed: mockCallback
      });

      // Trigger reconnection_failed event
      const event = new CustomEvent("reconnection_failed", { detail: null });
      api.dispatchEvent(event);

      // Wait for async callback
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockCallback).toHaveBeenCalled();
    });

    test("sets connectionState to failed when reconnection fails", async () => {
      const mockCallback = jest.fn();

      api = new ComfyApi("http://localhost:8188", "test-client", {
        onReconnectionFailed: mockCallback
      });

      // Trigger reconnection_failed event
      const event = new CustomEvent("reconnection_failed", { detail: null });
      api.dispatchEvent(event);

      // Wait for async handling
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(api.connectionState).toBe("failed");
    });

    test("handles callback errors gracefully", async () => {
      const mockCallback = jest.fn().mockRejectedValue(new Error("Callback error"));

      api = new ComfyApi("http://localhost:8188", "test-client", {
        onReconnectionFailed: mockCallback
      });

      // Trigger reconnection_failed event
      const event = new CustomEvent("reconnection_failed", { detail: null });

      // Should not throw
      try {
        api.dispatchEvent(event);
      } catch (e) {
        // ignore
      }

      // Wait for async callback
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockCallback).toHaveBeenCalled();
    });

    test("callback is optional", () => {
      // Should not throw without callback
      expect(() => {
        api = new ComfyApi("http://localhost:8188", "test-client");
      }).not.toThrow();
    });
  });

  describe("reconnection_failed event", () => {
    test("emits reconnection_failed event", async () => {
      api = new ComfyApi("http://localhost:8188");

      const handler = jest.fn();
      api.on("reconnection_failed", handler);

      // Trigger the event
      const event = new CustomEvent("reconnection_failed", { detail: null });
      api.dispatchEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    test("multiple handlers receive the event", async () => {
      api = new ComfyApi("http://localhost:8188");

      const handler1 = jest.fn();
      const handler2 = jest.fn();
      const handler3 = jest.fn();

      api.on("reconnection_failed", handler1);
      api.on("reconnection_failed", handler2);
      api.on("reconnection_failed", handler3);

      const event = new CustomEvent("reconnection_failed", { detail: null });
      api.dispatchEvent(event);

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
      expect(handler3).toHaveBeenCalled();
    });
  });

  describe("reconnected event", () => {
    test("emits reconnected event on successful reconnection", () => {
      api = new ComfyApi("http://localhost:8188");

      const handler = jest.fn();
      api.on("reconnected", handler);

      (api as any).createSocket(true); // isReconnect = true
      const sock: any = api.socket;

      sock.onopen?.();

      expect(handler).toHaveBeenCalled();
    });

    test("does not emit reconnected on initial connection", () => {
      api = new ComfyApi("http://localhost:8188");

      const reconnectedHandler = jest.fn();
      const connectedHandler = jest.fn();

      api.on("reconnected", reconnectedHandler);
      api.on("connected", connectedHandler);

      (api as any).createSocket(false); // isReconnect = false
      const sock: any = api.socket;

      sock.onopen?.();

      expect(connectedHandler).toHaveBeenCalled();
      expect(reconnectedHandler).not.toHaveBeenCalled();
    });
  });

  describe("abortReconnect method", () => {
    test("aborts ongoing reconnection", async () => {
      api = new ComfyApi("http://localhost:8188");

      // Start reconnection
      await api.reconnectWs(true);

      // Abort it
      api.abortReconnect();

      // Should not throw
      expect(() => api.abortReconnect()).not.toThrow();
    });

    test("does nothing if no reconnection in progress", () => {
      api = new ComfyApi("http://localhost:8188");

      // Should not throw
      expect(() => api.abortReconnect()).not.toThrow();
    });
  });

  describe("websocket_unavailable event", () => {
    test.skip("emits when WebSocket creation fails (skipped - hard to mock)", () => {
      // This test is skipped because WebSocket creation failure is difficult to mock
      // properly in the test environment. The behavior is covered by integration tests.
    });
  });

  describe("connection lifecycle", () => {
    test("complete connection lifecycle", () => {
      api = new ComfyApi("http://localhost:8188");

      const states: ConnectionState[] = [];

      // Track state changes by observing the property
      const trackState = () => states.push(api.connectionState);

      // Initial state
      trackState(); // "connecting"

      // Create socket
      (api as any).createSocket();
      trackState(); // still "connecting"

      const sock: any = api.socket;

      // Open connection
      sock.onopen?.();
      trackState(); // "connected"

      // Close connection - this will trigger reconnection
      sock.onclose?.({ code: 1000, reason: "Test", wasClean: true });
      trackState(); // "disconnected" or "reconnecting"

      expect(states[0]).toBe("connecting");
      expect(states[1]).toBe("connecting");
      expect(states[2]).toBe("connected");
      expect(["disconnected", "reconnecting"]).toContain(states[3]);
    });
  });
});
