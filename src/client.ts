import {
  BasicCredentials,
  BearerTokenCredentials,
  CustomCredentials,
  ModelFile,
  ModelFolder,
  ModelPreviewResponse,
  OSType,
  QueueResponse,
  QueueStatus
} from "./types/api.js";
import { WebSocket } from "ws";
import { TComfyAPIEventMap } from "./types/event.js";
import { TypedEventTarget } from "./typed-event-target.js";
import { delay } from "./tools.js";
import { ManagerFeature } from "./features/manager.js";
import { MonitoringFeature } from "./features/monitoring.js";
import { QueueFeature } from "./features/queue.js";
import { HistoryFeature } from "./features/history.js";
import { SystemFeature } from "./features/system.js";
import { NodeFeature } from "./features/node.js";
import { UserFeature } from "./features/user.js";
import { FileFeature } from "./features/file.js";
import { ModelFeature } from "./features/model.js";
import { TerminalFeature } from "./features/terminal.js";
import { MiscFeature } from "./features/misc.js";
import { FeatureFlagsFeature } from "./features/feature-flags.js";
import { runWebSocketReconnect } from "./utils/ws-reconnect.js";
import { Workflow, WorkflowJob, WorkflowResult } from "./workflow.js";

interface FetchOptions extends RequestInit {
  headers?: {
    [key: string]: string;
  };
}

/**
 * Primary client for interacting with a ComfyUI server.
 *
 * Responsibilities:
 *  - Connection lifecycle (WebSocket + polling fallback)
 *  - Authentication header injection
 *  - Capability probing / feature support detection
 *  - High‑level event fan‑out (progress, status, terminal, etc.)
 *  - Aggregation of modular feature namespaces under `ext.*`
 *
 * This class purposefully keeps business logic for specific domains inside feature modules
 * (see files in `src/features/`). Only generic transport & coordination logic lives here.
 */
export class ComfyApi extends TypedEventTarget<TComfyAPIEventMap> {
  /** Base host (including protocol) e.g. http://localhost:8188 */
  public apiHost: string;
  /** OS type as reported by the server (resolved during init) */
  public osType!: OSType; // assigned during init()
  /** Indicates feature probing + socket establishment completed */
  public isReady: boolean = false;
  /** Internal ready promise (resolved once). */
  private readyPromise: Promise<this>;
  private resolveReady!: (self: this) => void;
  /** Whether to subscribe to terminal log streaming on init */
  public listenTerminal: boolean = false;
  /** Monotonic timestamp of last socket activity (used for timeout detection) */
  public lastActivity: number = Date.now();

  /** WebSocket inactivity timeout (ms) before attempting reconnection */
  private readonly wsTimeout: number = 10000;
  private wsTimer: NodeJS.Timeout | null = null;
  private _pollingTimer: NodeJS.Timeout | number | null = null;

  /** Host sans protocol (used to compose ws:// / wss:// URL) */
  private readonly apiBase: string;
  private clientId: string | null;
  private socket: WebSocket | null = null;
  private listeners: Array<{
    event: keyof TComfyAPIEventMap;
    options?: AddEventListenerOptions | boolean;
    handler: (event: TComfyAPIEventMap[keyof TComfyAPIEventMap]) => void;
  }> = [];
  private readonly credentials: BasicCredentials | BearerTokenCredentials | CustomCredentials | null = null;

  private headers: Record<string, string> = {};

  /** Modular feature namespaces (tree intentionally flat & dependency‑free) */
  public ext = {
    /** ComfyUI-Manager extension integration */
    manager: new ManagerFeature(this),
    /** Crystools monitor / system resource streaming */
    monitor: new MonitoringFeature(this),
    /** Prompt queue submission / control */
    queue: new QueueFeature(this),
    /** Execution history lookups */
    history: new HistoryFeature(this),
    /** System stats & memory free */
    system: new SystemFeature(this),
    /** Node defs + sampler / checkpoint / lora helpers */
    node: new NodeFeature(this),
    /** User CRUD & settings */
    user: new UserFeature(this),
    /** File uploads, image helpers & user data file operations */
    file: new FileFeature(this),
    /** Experimental model browsing / preview */
    model: new ModelFeature(this),
    /** Terminal log retrieval & streaming toggle */
    terminal: new TerminalFeature(this),
    /** Misc endpoints (extensions list, embeddings) */
    misc: new MiscFeature(this),
    /** Server advertised feature flags */
    featureFlags: new FeatureFlagsFeature(this)
  } as const;

  /** Helper type guard shaping expected feature API */
  private asFeature(obj: any): {
    isSupported?: boolean;
    destroy?: () => void;
    checkSupported?: () => Promise<boolean>;
  } {
    return obj;
  }

  static generateId(): string {
    return "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  public on<K extends keyof TComfyAPIEventMap>(
    type: K,
    callback: (event: TComfyAPIEventMap[K]) => void,
    options?: AddEventListenerOptions | boolean
  ) {
    this.log("on", "Add listener", { type, callback, options });
    super.on(type, callback, options);
    this.listeners.push({ event: type, handler: callback as any, options });
    return () => this.off(type, callback, options);
  }

  public off<K extends keyof TComfyAPIEventMap>(
    type: K,
    callback: (event: TComfyAPIEventMap[K]) => void,
    options?: EventListenerOptions | boolean
  ): void {
    this.log("off", "Remove listener", { type, callback, options });
    this.listeners = this.listeners.filter((l) => !(l.event === type && l.handler === callback));
    super.off(type, callback as any, options);
  }

  public removeAllListeners() {
    this.log("removeAllListeners", "Triggered");
    this.listeners.forEach((listener) => {
      super.off(listener.event, listener.handler as any, listener.options as any);
    });
    this.listeners = [];
  }

  get id(): string {
    return this.clientId ?? this.apiBase;
  }

  /**
   * Retrieves the available features of the client.
   *
   * @returns An object containing the available features, where each feature is a key-value pair.
   */
  get availableFeatures() {
    return Object.keys(this.ext).reduce(
      (acc, key) => {
        const feat = this.asFeature(this.ext[key as keyof typeof this.ext]);
        return { ...acc, [key]: !!feat.isSupported };
      },
      {} as Record<string, boolean>
    );
  }

  constructor(
    host: string,
    clientId: string = ComfyApi.generateId(),
    opts?: {
      /** Additional headers to include in all requests. */
      headers?: Record<string, string>;
      /** Do not fallback to HTTP if WebSocket is not available (keeps retrying WS). */
      forceWs?: boolean;
      /** Timeout for WebSocket inactivity before reconnect (default 10000ms). */
      wsTimeout?: number;
      /** Subscribe to terminal logs immediately on init (default false). */
      listenTerminal?: boolean;
      /** Authentication credentials (basic / bearer / custom headers). */
      credentials?: BasicCredentials | BearerTokenCredentials | CustomCredentials;
      /** WebSocket reconnection tuning */
      reconnect?: {
        /** Max reconnection attempts before giving up (default 10). */
        maxAttempts?: number;
        /** Base delay (ms) for exponential backoff (default 1000). */
        baseDelayMs?: number;
        /** Max delay cap (ms) (default 15000). */
        maxDelayMs?: number;
        /** Backoff strategy: exponential | linear | custom (default exponential). */
        strategy?: "exponential" | "linear" | "custom";
        /** Percent jitter (0 disables). Only for linear/exponential (default 30). */
        jitterPercent?: number;
        /** Custom delay fn if strategy === 'custom'. Receives attempt (1-based). */
        customDelayFn?: (attempt: number, opts: { baseDelayMs: number; maxDelayMs: number }) => number;
      };
    }
  ) {
    super();
    this.apiHost = host;
    this.apiBase = host.split("://")[1];
    this.clientId = clientId;
    this.readyPromise = new Promise<this>((res) => {
      this.resolveReady = res;
    });
    if (opts?.credentials) {
      this.credentials = opts?.credentials;
      this.testCredentials();
    }
    if (opts?.wsTimeout) {
      this.wsTimeout = opts.wsTimeout;
    }
    if (opts?.listenTerminal) {
      this.listenTerminal = opts.listenTerminal;
    }
    if (opts?.reconnect) {
      (this as any)._reconnect = { ...opts.reconnect };
    }

    if (opts?.headers) {
      this.headers = opts.headers;
    }

    this.log("constructor", "Initialized", {
      host,
      clientId,
      opts
    });
    return this;
  }

  /**
   * Destroys the client instance.
   * Ensures all connections, timers and event listeners are properly closed.
   */
  destroy() {
    this.log("destroy", "Destroying client...");
    // Cleanup flag to prevent re-entry
    if ((this as any)._destroyed) {
      this.log("destroy", "Client already destroyed");
      return;
    }
    (this as any)._destroyed = true;

    // Clean up WebSocket timer
    if (this.wsTimer) {
      clearInterval(this.wsTimer);
      this.wsTimer = null;
    }

    // Clean up polling timer if exists
    if (this._pollingTimer) {
      clearInterval(this._pollingTimer as any);
      this._pollingTimer = null;
    }

    // Clean up socket event handlers and force close WebSocket
    if (this.socket) {
      try {
        // Remove all event handlers
        this.socket.onclose = null;
        this.socket.onerror = null;
        this.socket.onmessage = null;
        this.socket.onopen = null;

        // Forcefully close the WebSocket
        if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
          this.socket.close();
        }

        // Terminate the WebSocket connection
        this.socket.terminate();
      } catch (e) {
        this.log("destroy", "Error while closing WebSocket", e);
      }
    }

    // Destroy all extensions
    for (const ext in this.ext) {
      try {
        const feat = this.asFeature(this.ext[ext as keyof typeof this.ext]);
        feat.destroy?.();
      } catch (e) {
        this.log("destroy", `Error destroying extension ${ext}`, e);
      }
    }

    // Make sure socket is closed
    try {
      this.socket?.close();
      this.socket = null;
    } catch (e) {
      this.log("destroy", "Error closing socket", e);
    }

    // Remove all event listeners
    this.removeAllListeners();

    this.log("destroy", "Client destroyed completely");
  }

  private log(fnName: string, message: string, data?: any) {
    this.dispatchEvent(new CustomEvent("log", { detail: { fnName, message, data } }));
  }

  /**
   * Build full API URL (made public for feature modules)
   */
  public apiURL(route: string): string {
    return `${this.apiHost}${route}`;
  }

  private getCredentialHeaders(): Record<string, string> {
    if (!this.credentials) return {};
    switch (this.credentials?.type) {
      case "basic":
        return {
          Authorization: `Basic ${btoa(`${this.credentials.username}:${this.credentials.password}`)}`
        };
      case "bearer_token":
        return {
          Authorization: `Bearer ${this.credentials.token}`
        };
      case "custom":
        return this.credentials.headers;
      default:
        return {};
    }
  }

  private async testCredentials() {
    try {
      if (!this.credentials) return false;
      await this.pollStatus(2000);
      this.dispatchEvent(new CustomEvent("auth_success"));
      return true;
    } catch (e) {
      this.log("testCredentials", "Failed", e);
      if (e instanceof Response) {
        if (e.status === 401) {
          this.dispatchEvent(new CustomEvent("auth_error", { detail: e }));
          return;
        }
      }
      this.dispatchEvent(new CustomEvent("connection_error", { detail: e }));
      return false;
    }
  }

  private async testFeatures() {
    const extensions = Object.values(this.ext).map((e) => this.asFeature(e));
    await Promise.all(extensions.map((ext) => ext.checkSupported?.()));
    /**
     * Mark the client is ready to use the API.
     */
    this.isReady = true;
  }

  /**
   * Fetches data from the API.
   *
   * @param route - The route to fetch data from.
   * @param options - The options for the fetch request.
   * @returns A promise that resolves to the response from the API.
   */
  public async fetchApi(route: string, options?: FetchOptions): Promise<Response> {
    if (!options) {
      options = {};
    }
    options.headers = {
      ...this.headers,
      ...this.getCredentialHeaders()
    };
    options.mode = "cors";
    return fetch(this.apiURL(route), options);
  }

  /**
   * Polls the status for colab and other things that don't support websockets.
   * @returns {Promise<QueueStatus>} The status information.
   */
  async pollStatus(timeout = 1000): Promise<QueueStatus> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await this.fetchApi("/prompt", {
        signal: controller.signal
      });
      if (response.status === 200) {
        return response.json();
      } else {
        throw response;
      }
    } catch (error: any) {
      this.log("pollStatus", "Failed", error);
      if (error.name === "AbortError") {
        throw new Error("Request timed out");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Queues a prompt for processing.
   * @param {number} number The index at which to queue the prompt. using NULL will append to the end of the queue.
   * @param {object} workflow Additional workflow data.
   * @returns {Promise<QueuePromptResponse>} The response from the API.
   */
  // Deprecated queuePrompt / appendPrompt wrappers removed. Use feature: api.ext.queue.*

  /**
   * Fetch raw queue status snapshot (lightweight helper not yet moved into a feature wrapper).
   */
  async getQueue(): Promise<QueueResponse> {
    // Direct call (no feature wrapper yet for queue status)
    const response = await this.fetchApi("/queue");
    return response.json();
  }

  /**
   * Hint the server to unload models / free memory (maps to `/free`).
   * Returns false if request fails (does not throw to simplify caller ergonomics).
   */
  async freeMemory(unloadModels: boolean, freeMemory: boolean): Promise<boolean> {
    const payload = {
      unload_models: unloadModels,
      free_memory: freeMemory
    };

    try {
      const response = await this.fetchApi("/free", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      // Check if the response is successful
      if (!response.ok) {
        this.log("freeMemory", "Free memory failed", response);
        return false;
      }

      // Return the response object
      return true;
    } catch (error) {
      this.log("freeMemory", "Free memory failed", error);
      return false;
    }
  }

  /**
   * Initialize: ping server with retries, probe features, establish WebSocket, optionally subscribe to terminal logs.
   * Resolves with the client instance when ready; throws on unrecoverable connection failure.
   */
  async init(maxTries = 10, delayTime = 1000): Promise<this> {
    try {
      // Wait for ping to succeed
      await this.pingSuccess(maxTries, delayTime);

      // Get system OS type on initialization
      // Use feature namespace directly to avoid triggering deprecated shim
      try {
        const sys = await this.ext.system.getSystemStats();
        this.osType = sys.system.os;
      } catch (e) {
        console.warn("Failed to get OS type during init:", e);
        this.osType = "Unknown" as OSType;
      }

      // Test features on initialization
      await this.testFeatures();

      // Create WebSocket connection on initialization
      this.createSocket();

      // Set terminal subscription on initialization (use feature namespace to avoid deprecated shim)
      if (this.listenTerminal) {
        try {
          await this.ext.terminal.setTerminalSubscription(true);
        } catch (e) {
          console.warn("Failed to set terminal subscription during init:", e);
        }
      }

      // Mark as ready
      this.isReady = true;
      // Resolve ready promise exactly once
      try {
        this.resolveReady?.(this);
      } catch {
        /* no-op */
      }

      return this;
    } catch (e) {
      this.log("init", "Failed", e);
      this.dispatchEvent(new CustomEvent("connection_error", { detail: e }));
      throw e; // Propagate the error
    }
  }

  private async pingSuccess(maxTries = 10, delayTime = 1000) {
    let tries = 0;
    let ping = await this.ping();
    while (!ping.status) {
      if (tries > maxTries) {
        throw new Error("Can't connect to the server");
      }
      await delay(delayTime); // Wait for 1s before trying again
      ping = await this.ping();
      tries++;
    }
  }

  /** Await until feature probing + socket creation finished. */
  async waitForReady() {
    return this.readyPromise;
  }

  /**
   * Sends a ping request to the server and returns a boolean indicating whether the server is reachable.
   * @returns A promise that resolves to `true` if the server is reachable, or `false` otherwise.
   */
  async ping() {
    const start = performance.now();
    return this.pollStatus(5000)
      .then(() => {
        return { status: true, time: performance.now() - start } as const;
      })
      .catch((error) => {
        this.log("ping", "Can't connect to the server", error);
        return { status: false } as const;
      });
  }

  /**
   * Attempt WebSocket reconnection with exponential backoff + jitter.
   * Falls back to a bounded number of attempts then emits `reconnection_failed`.
   */
  public async reconnectWs(triggerEvent?: boolean) {
    if ((this as any)._reconnectController) {
      // Avoid stacking multiple controllers concurrently
      try {
        (this as any)._reconnectController.abort();
      } catch {}
    }
    (this as any)._reconnectController = runWebSocketReconnect(this, () => this.createSocket(true), {
      triggerEvents: !!triggerEvent,
      maxAttempts: (this as any)._reconnect?.maxAttempts,
      baseDelayMs: (this as any)._reconnect?.baseDelayMs,
      maxDelayMs: (this as any)._reconnect?.maxDelayMs,
      strategy: (this as any)._reconnect?.strategy,
      jitterPercent: (this as any)._reconnect?.jitterPercent,
      customDelayFn: (this as any)._reconnect?.customDelayFn
    });
  }

  /** Abort any in-flight reconnection loop (no-op if none active). */
  public abortReconnect() {
    try {
      (this as any)._reconnectController?.abort();
    } catch {}
  }

  private resetLastActivity() {
    this.lastActivity = Date.now();
  }

  /** Convenience: init + waitForReady (idempotent). */
  public async ready(): Promise<this> {
    if (!this.isReady) {
      await this.init();
      await this.waitForReady();
    }
    return this;
  }

  /**
   * High-level sugar: run a Workflow or PromptBuilder directly.
   * Accepts experimental Workflow abstraction or a raw PromptBuilder-like object with setInputNode/output mappings already applied.
   */
  public async run(
    wf: any,
    opts?: { pool?: any; autoDestroy?: boolean; includeOutputs?: string[] }
  ): Promise<WorkflowJob<WorkflowResult>> {
    if (wf instanceof Workflow) {
      await this.ready();
      const job = await wf.run(this as any, { pool: opts?.pool, includeOutputs: opts?.includeOutputs });
      const ensured = this._ensureWorkflowJob(job);
      if (opts?.autoDestroy) {
        if (ensured && typeof (ensured as any).on === "function") {
          (ensured as any).on("finished", () => this.destroy()).on("failed", () => this.destroy());
        } else if (ensured && typeof (ensured as any).finally === "function") {
          (ensured as any).finally(() => this.destroy());
        }
      }
      return ensured;
    }
    // Assume raw JSON -> wrap
    if (typeof wf === "object" && !wf.run) {
      const w = Workflow.from(wf as any);
      await this.ready();
      const job = await w.run(this as any, { pool: opts?.pool, includeOutputs: opts?.includeOutputs });
      const ensured = this._ensureWorkflowJob(job);
      if (opts?.autoDestroy) {
        if (ensured && typeof (ensured as any).on === "function") {
          (ensured as any).on("finished", () => this.destroy()).on("failed", () => this.destroy());
        } else if (ensured && typeof (ensured as any).finally === "function") {
          (ensured as any).finally(() => this.destroy());
        }
      }
      return ensured;
    }
    throw new Error("Unsupported workflow object passed to api.run");
  }

  /** Backwards compatibility: ensure returned value has minimal WorkflowJob surface (.on/.done). */
  private _ensureWorkflowJob(job: any) {
    if (!job) return job;
    const hasOn = typeof job.on === "function";
    const hasDone = typeof job.done === "function";
    if (hasOn && hasDone) return job; // already a WorkflowJob
    // Wrap plain promise-like
    if (typeof job.then === "function") {
      const listeners: Record<string, Function[]> = {};
      const emit = (evt: string, ...args: any[]) =>
        (listeners[evt] || []).forEach((fn) => {
          try {
            fn(...args);
          } catch {}
        });
      // Attempt to tap into resolution
      job.then(
        (val: any) => {
          emit("finished", val, (val && val._promptId) || undefined);
          return val;
        },
        (err: any) => {
          emit("failed", err);
          throw err;
        }
      );
      return Object.assign(job, {
        on(evt: string, fn: Function) {
          (listeners[evt] = listeners[evt] || []).push(fn);
          return this;
        },
        off(evt: string, fn: Function) {
          listeners[evt] = (listeners[evt] || []).filter((f) => f !== fn);
          return this;
        },
        done() {
          return job;
        }
      });
    }
    return job;
  }

  /** Alias for clarity when passing explicit Workflow objects */
  public async runWorkflow(
    wf: any,
    opts?: { pool?: any; autoDestroy?: boolean; includeOutputs?: string[] }
  ): Promise<import("./workflow.js").WorkflowJob<import("./workflow.js").WorkflowResult>> {
    return this.run(wf, opts);
  }

  /** Convenience helper: run + wait for completion results in one call. */
  public async runAndWait(
    wf: any,
    opts?: { pool?: any; includeOutputs?: string[] }
  ): Promise<import("./workflow.js").WorkflowResult> {
    const job = await this.run(wf, { pool: opts?.pool, includeOutputs: opts?.includeOutputs });
    return (job as any).done();
  }

  /**
   * Establish a WebSocket connection for real‑time events; installs polling fallback on failure.
   * @param isReconnect internal flag indicating this creation follows a reconnect attempt
   */
  private createSocket(isReconnect: boolean = false) {
    let reconnecting = false;
    let usePolling = false;

    if (this.socket) {
      this.log("socket", "Socket already exists, skipping creation.");
      return;
    }

    const headers = {
      ...this.headers,
      ...this.getCredentialHeaders()
    };

    const existingSession = `?clientId=${this.clientId}`;
    const wsUrl = `ws${this.apiHost.includes("https:") ? "s" : ""}://${this.apiBase}/ws${existingSession}`;

    // Try to create WebSocket connection
    try {
      this.socket = new WebSocket(wsUrl, {
        headers: headers
      });

      this.socket.onclose = () => {
        if (reconnecting || isReconnect) return;
        reconnecting = true;
        this.log("socket", "Socket closed -> Reconnecting");
        this.reconnectWs(true);
      };

      this.socket.onopen = () => {
        this.resetLastActivity();
        reconnecting = false;
        usePolling = false; // Reset polling flag if we have an open connection
        this.log("socket", "Socket opened");
        if (isReconnect) {
          this.dispatchEvent(new CustomEvent("reconnected"));
        } else {
          this.dispatchEvent(new CustomEvent("connected"));
        }
      };
    } catch (error) {
      this.log("socket", "WebSocket creation failed, falling back to polling", error);
      this.socket = null;
      usePolling = true;
      this.dispatchEvent(new CustomEvent("websocket_unavailable", { detail: error }));

      // Set up polling mechanism
      this.setupPollingFallback();
    }

    // Only continue with WebSocket setup if creation was successful
    if (this.socket) {
      this.socket.onmessage = (event) => {
        this.resetLastActivity();
        try {
          // Unified binary handling: Buffer (ws), ArrayBuffer (WHATWG / Node >= 22), or typed array view
          let u8: Uint8Array | null = null;
          if (event.data instanceof Buffer) {
            u8 = event.data;
          } else if (event.data instanceof ArrayBuffer) {
            u8 = new Uint8Array(event.data);
          } else if (ArrayBuffer.isView(event.data)) {
            const viewAny = event.data as ArrayBufferView;
            u8 = new Uint8Array(viewAny.buffer, viewAny.byteOffset, viewAny.byteLength);
          }

          if (u8) {
            if (u8.byteLength < 8) {
              this.log("socket", "Binary frame too small for preview header", { size: u8.byteLength });
              return;
            }
            const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
            const eventType = view.getUint32(0); // protocol: first 4 bytes event kind
            switch (eventType) {
              case 1: {
                // preview image
                // second 4 bytes = image type (1=jpeg,2=png). Previously we mistakenly re-read offset 0.
                const imageType = view.getUint32(4);
                let imageMime: string;
                switch (imageType) {
                  case 2:
                    imageMime = "image/png";
                    break;
                  case 1:
                  default:
                    imageMime = "image/jpeg";
                    break;
                }
                const imageBlob = new Blob([u8.slice(8)], { type: imageMime });
                this.dispatchEvent(new CustomEvent("b_preview", { detail: imageBlob }));
                break;
              }
              default:
                // Unknown binary type – ignore but log once (could extend protocol later)
                this.log("socket", "Unknown binary websocket message", { eventType, size: u8.byteLength });
                break;
            }
            return; // handled binary branch
          }

          if (typeof event.data === "string") {
            const msg = JSON.parse(event.data);
            if (!msg.data || !msg.type) return;
            this.dispatchEvent(new CustomEvent("all", { detail: msg }));
            if (msg.type === "logs") {
              this.dispatchEvent(new CustomEvent("terminal", { detail: msg.data.entries?.[0] || null }));
            } else {
              this.dispatchEvent(new CustomEvent(msg.type, { detail: msg.data }));
            }
            if (msg.data.sid) {
              this.clientId = msg.data.sid;
            }
          } else {
            this.log("socket", "Unhandled message", { kind: typeof event.data });
          }
        } catch (error) {
          this.log("socket", "Unhandled message", { event, error });
        }
      };

      this.socket.onerror = (e) => {
        this.log("socket", "Socket error", e);

        // If this is the first error and we're not already in reconnect mode
        if (!reconnecting && !usePolling) {
          usePolling = true;
          this.log("socket", "WebSocket error, will try polling as fallback");
          this.setupPollingFallback();
        }
      };

      if (!isReconnect) {
        this.wsTimer = setInterval(() => {
          if (reconnecting) return;
          if (Date.now() - this.lastActivity > this.wsTimeout) {
            reconnecting = true;
            this.log("socket", "Connection timed out, reconnecting...");
            this.reconnectWs(true);
          }
        }, this.wsTimeout / 2);
      }
    }
  }

  /**
   * Install a 2s interval polling loop to replicate essential status events when WebSocket is unavailable.
   * Stops automatically once a socket connection is restored.
   */
  private setupPollingFallback() {
    this.log("socket", "Setting up polling fallback mechanism");

    // Clear any existing polling timer
    if (this._pollingTimer) {
      try {
        clearInterval(this._pollingTimer as any);
        this._pollingTimer = null;
      } catch (e) {
        this.log("socket", "Error clearing polling timer", e);
      }
    }

    // Poll every 2 seconds
    const POLLING_INTERVAL = 2000;

    const pollFn = async () => {
      try {
        // Poll execution status
        const status = await this.pollStatus();

        // Simulate an event dispatch similar to WebSocket
        this.dispatchEvent(new CustomEvent("status", { detail: status }));

        // Reset activity timestamp to prevent timeout
        this.resetLastActivity();

        // Try to re-establish WebSocket connection periodically
        if (!this.socket || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
          this.log("socket", "Attempting to restore WebSocket connection");
          try {
            this.createSocket(true);
          } catch (error) {
            // Continue with polling if WebSocket creation fails
            this.log("socket", "WebSocket still unavailable, continuing with polling", error);
          }
        } else {
          // WebSocket is back, we can stop polling
          this.log("socket", "WebSocket connection restored, stopping polling");
          if (this._pollingTimer) {
            clearInterval(this._pollingTimer as any);
            this._pollingTimer = null;
          }
        }
      } catch (error) {
        this.log("socket", "Polling error", error);
      }
    };

    // Using setInterval and casting to the expected type
    this._pollingTimer = setInterval(pollFn, POLLING_INTERVAL) as any;

    this.log("socket", `Polling started with interval of ${POLLING_INTERVAL}ms`);
  }

  /**
   * Retrieves a list of all available model folders.
   * @experimental API that may change in future versions
   * @returns A promise that resolves to an array of ModelFolder objects.
   */
  async getModelFolders(): Promise<ModelFolder[]> {
    try {
      const response = await this.fetchApi("/experiment/models");
      if (!response.ok) {
        this.log("getModelFolders", "Failed to fetch model folders", response);
        throw new Error(`Failed to fetch model folders: ${response.status} ${response.statusText}`);
      }
      return response.json();
    } catch (error) {
      this.log("getModelFolders", "Error fetching model folders", error);
      throw error;
    }
  }

  /**
   * Retrieves a list of all model files in a specific folder.
   * @experimental API that may change in future versions
   * @param folder - The name of the model folder.
   * @returns A promise that resolves to an array of ModelFile objects.
   */
  async getModelFiles(folder: string): Promise<ModelFile[]> {
    try {
      const response = await this.fetchApi(`/experiment/models/${encodeURIComponent(folder)}`);
      if (!response.ok) {
        this.log("getModelFiles", "Failed to fetch model files", { folder, response });
        throw new Error(`Failed to fetch model files: ${response.status} ${response.statusText}`);
      }
      return response.json();
    } catch (error) {
      this.log("getModelFiles", "Error fetching model files", { folder, error });
      throw error;
    }
  }

  /**
   * Retrieves a preview image for a specific model file.
   * @experimental API that may change in future versions
   * @param folder - The name of the model folder.
   * @param pathIndex - The index of the folder path where the file is stored.
   * @param filename - The name of the model file.
   * @returns A promise that resolves to a ModelPreviewResponse object containing the preview image data.
   */
  async getModelPreview(folder: string, pathIndex: number, filename: string): Promise<ModelPreviewResponse> {
    try {
      const response = await this.fetchApi(
        `/experiment/models/preview/${encodeURIComponent(folder)}/${pathIndex}/${encodeURIComponent(filename)}`
      );

      if (!response.ok) {
        this.log("getModelPreview", "Failed to fetch model preview", { folder, pathIndex, filename, response });
        throw new Error(`Failed to fetch model preview: ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") || "image/webp";
      const body = await response.arrayBuffer();

      return {
        body,
        contentType
      };
    } catch (error) {
      this.log("getModelPreview", "Error fetching model preview", { folder, pathIndex, filename, error });
      throw error;
    }
  }

  /**
   * Creates a URL for a model preview image.
   * @experimental API that may change in future versions
   * @param folder - The name of the model folder.
   * @param pathIndex - The index of the folder path where the file is stored.
   * @param filename - The name of the model file.
   * @returns The URL string for the model preview.
   */
  getModelPreviewUrl(folder: string, pathIndex: number, filename: string): string {
    return this.apiURL(
      `/experiment/models/preview/${encodeURIComponent(folder)}/${pathIndex}/${encodeURIComponent(filename)}`
    );
  }
}
