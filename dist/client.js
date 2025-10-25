import { WebSocket } from "ws";
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
import { Workflow } from "./workflow.js";
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
export class ComfyApi extends TypedEventTarget {
    /** Base host (including protocol) e.g. http://localhost:8188 */
    apiHost;
    /** OS type as reported by the server (resolved during init) */
    osType; // assigned during init()
    /** Indicates feature probing + socket establishment completed */
    isReady = false;
    /** Internal ready promise (resolved once). */
    readyPromise;
    resolveReady;
    /** Whether to subscribe to terminal log streaming on init */
    listenTerminal = false;
    /** Monotonic timestamp of last socket activity (used for timeout detection) */
    lastActivity = Date.now();
    /** WebSocket inactivity timeout (ms) before attempting reconnection */
    wsTimeout = 60000;
    wsTimer = null;
    _pollingTimer = null;
    /** Host sans protocol (used to compose ws:// / wss:// URL) */
    apiBase;
    clientId;
    socket = null;
    listeners = [];
    credentials = null;
    comfyOrgApiKey;
    /** Debug flag to emit verbose console logs for instrumentation */
    _debug = false;
    headers = {};
    /** Feature flags we announce to the server upon socket open */
    announcedFeatureFlags = {
        supports_preview_metadata: true,
        max_upload_size: 50 * 1024 * 1024
    };
    /** Modular feature namespaces (tree intentionally flat & dependency‑free) */
    ext = {
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
    };
    /** Helper type guard shaping expected feature API */
    asFeature(obj) {
        return obj;
    }
    static generateId() {
        return "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
            const r = (Math.random() * 16) | 0;
            const v = c === "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }
    on(type, callback, options) {
        this.log("on", "Add listener", { type, callback, options });
        super.on(type, callback, options);
        this.listeners.push({ event: type, handler: callback, options });
        return () => this.off(type, callback, options);
    }
    off(type, callback, options) {
        this.log("off", "Remove listener", { type, callback, options });
        this.listeners = this.listeners.filter((l) => !(l.event === type && l.handler === callback));
        super.off(type, callback, options);
    }
    removeAllListeners() {
        this.log("removeAllListeners", "Triggered");
        this.listeners.forEach((listener) => {
            super.off(listener.event, listener.handler, listener.options);
        });
        this.listeners = [];
    }
    get id() {
        return this.clientId ?? this.apiBase;
    }
    /**
     * Retrieves the available features of the client.
     *
     * @returns An object containing the available features, where each feature is a key-value pair.
     */
    get availableFeatures() {
        return Object.keys(this.ext).reduce((acc, key) => {
            const feat = this.asFeature(this.ext[key]);
            return { ...acc, [key]: !!feat.isSupported };
        }, {});
    }
    constructor(host, clientId = ComfyApi.generateId(), opts) {
        super();
        this.apiHost = host;
        this.apiBase = host.split("://")[1];
        this.clientId = clientId;
        this.readyPromise = new Promise((res) => {
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
            this._reconnect = { ...opts.reconnect };
        }
        if (opts?.headers) {
            this.headers = opts.headers;
        }
        if (opts?.comfyOrgApiKey) {
            this.comfyOrgApiKey = opts.comfyOrgApiKey;
        }
        // Debug flag (env COMFY_DEBUG=1 also enables it)
        try {
            const envDebug = typeof process !== "undefined" && process?.env?.COMFY_DEBUG;
            this._debug = Boolean(opts?.debug ?? (envDebug === "1" || envDebug === "true"));
        }
        catch { /* ignore env access in non-node runtimes */ }
        // Merge announced feature flags overrides
        if (opts?.announceFeatureFlags) {
            this.announcedFeatureFlags = {
                ...this.announcedFeatureFlags,
                ...opts.announceFeatureFlags
            };
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
        if (this._destroyed) {
            this.log("destroy", "Client already destroyed");
            return;
        }
        this._destroyed = true;
        // Clean up WebSocket timer
        if (this.wsTimer) {
            clearInterval(this.wsTimer);
            this.wsTimer = null;
        }
        // Clean up polling timer if exists
        if (this._pollingTimer) {
            clearInterval(this._pollingTimer);
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
            }
            catch (e) {
                this.log("destroy", "Error while closing WebSocket", e);
            }
        }
        // Destroy all extensions
        for (const ext in this.ext) {
            try {
                const feat = this.asFeature(this.ext[ext]);
                feat.destroy?.();
            }
            catch (e) {
                this.log("destroy", `Error destroying extension ${ext}`, e);
            }
        }
        // Make sure socket is closed
        try {
            this.socket?.close();
            this.socket = null;
        }
        catch (e) {
            this.log("destroy", "Error closing socket", e);
        }
        // Remove all event listeners
        this.removeAllListeners();
        this.log("destroy", "Client destroyed completely");
    }
    log(fnName, message, data) {
        this.dispatchEvent(new CustomEvent("log", { detail: { fnName, message, data } }));
        if (this._debug) {
            try {
                const ts = new Date().toISOString();
                const id = this.clientId || this.apiBase;
                // Avoid noisy large binary/object logs
                const safeData = data && typeof data === "object" ? sanitizeForLog(data) : data;
                // eslint-disable-next-line no-console
                console.debug(`[ComfyApi ${id}] ${ts} :: ${fnName} -> ${message}`, safeData ?? "");
            }
            catch { /* no-op */ }
        }
    }
    /**
     * Build full API URL (made public for feature modules)
     */
    apiURL(route) {
        return `${this.apiHost}${route}`;
    }
    getCredentialHeaders() {
        if (!this.credentials)
            return {};
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
    async testCredentials() {
        try {
            if (!this.credentials)
                return false;
            await this.pollStatus(2000);
            this.dispatchEvent(new CustomEvent("auth_success"));
            return true;
        }
        catch (e) {
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
    async testFeatures() {
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
    async fetchApi(route, options) {
        if (!options) {
            options = {};
        }
        options.headers = {
            ...this.headers,
            ...this.getCredentialHeaders()
        };
        options.mode = "cors";
        // Update last activity timestamp to keep WebSocket alive during HTTP requests
        this.resetLastActivity();
        return fetch(this.apiURL(route), options);
    }
    /**
     * Polls the status for colab and other things that don't support websockets.
     * @returns {Promise<QueueStatus>} The status information.
     */
    async pollStatus(timeout = 1000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await this.fetchApi("/prompt", {
                signal: controller.signal
            });
            if (response.status === 200) {
                return response.json();
            }
            else {
                throw response;
            }
        }
        catch (error) {
            this.log("pollStatus", "Failed", error);
            if (error.name === "AbortError") {
                throw new Error("Request timed out");
            }
            throw error;
        }
        finally {
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
    async getQueue() {
        // Direct call (no feature wrapper yet for queue status)
        const response = await this.fetchApi("/queue");
        return response.json();
    }
    /**
     * Hint the server to unload models / free memory (maps to `/free`).
     * Returns false if request fails (does not throw to simplify caller ergonomics).
     */
    async freeMemory(unloadModels, freeMemory) {
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
        }
        catch (error) {
            this.log("freeMemory", "Free memory failed", error);
            return false;
        }
    }
    /**
     * Initialize: ping server with retries, probe features, establish WebSocket, optionally subscribe to terminal logs.
     * Resolves with the client instance when ready; throws on unrecoverable connection failure.
     */
    async init(maxTries = 10, delayTime = 1000) {
        try {
            // Wait for ping to succeed
            await this.pingSuccess(maxTries, delayTime);
            // Get system OS type on initialization
            // Use feature namespace directly to avoid triggering deprecated shim
            try {
                const sys = await this.ext.system.getSystemStats();
                this.osType = sys.system.os;
            }
            catch (e) {
                console.warn("Failed to get OS type during init:", e);
                this.osType = "Unknown";
            }
            // Test features on initialization
            await this.testFeatures();
            // Create WebSocket connection on initialization
            this.createSocket();
            // Set terminal subscription on initialization (use feature namespace to avoid deprecated shim)
            if (this.listenTerminal) {
                try {
                    await this.ext.terminal.setTerminalSubscription(true);
                }
                catch (e) {
                    console.warn("Failed to set terminal subscription during init:", e);
                }
            }
            // Mark as ready
            this.isReady = true;
            // Resolve ready promise exactly once
            try {
                this.resolveReady?.(this);
            }
            catch {
                /* no-op */
            }
            return this;
        }
        catch (e) {
            this.log("init", "Failed", e);
            this.dispatchEvent(new CustomEvent("connection_error", { detail: e }));
            throw e; // Propagate the error
        }
    }
    async pingSuccess(maxTries = 10, delayTime = 1000) {
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
            return { status: true, time: performance.now() - start };
        })
            .catch((error) => {
            this.log("ping", "Can't connect to the server", error);
            return { status: false };
        });
    }
    /**
     * Attempt WebSocket reconnection with exponential backoff + jitter.
     * Falls back to a bounded number of attempts then emits `reconnection_failed`.
     */
    async reconnectWs(triggerEvent) {
        if (this._reconnectController) {
            // Avoid stacking multiple controllers concurrently
            try {
                this._reconnectController.abort();
            }
            catch { }
        }
        this._reconnectController = runWebSocketReconnect(this, () => this.createSocket(true), {
            triggerEvents: !!triggerEvent,
            maxAttempts: this._reconnect?.maxAttempts,
            baseDelayMs: this._reconnect?.baseDelayMs,
            maxDelayMs: this._reconnect?.maxDelayMs,
            strategy: this._reconnect?.strategy,
            jitterPercent: this._reconnect?.jitterPercent,
            customDelayFn: this._reconnect?.customDelayFn
        });
    }
    /** Abort any in-flight reconnection loop (no-op if none active). */
    abortReconnect() {
        try {
            this._reconnectController?.abort();
        }
        catch { }
    }
    resetLastActivity() {
        this.lastActivity = Date.now();
    }
    /** Convenience: init + waitForReady (idempotent). */
    async ready() {
        if (!this.isReady) {
            await this.init();
            await this.waitForReady();
        }
        return this;
    }
    /**
     * Decode a preview-with-metadata binary frame.
     * Layout after the 4-byte event type header:
     *   [0..3]   eventType (already consumed by caller)
     *   [4..7]   big-endian uint32: metadata JSON byte length (N)
     *   [8..8+N) metadata JSON (utf-8)
     *   [8+N..]  image bytes (png/jpeg as declared in metadata.image_type)
     * Returns null if parsing fails.
     */
    _decodePreviewWithMetadata(u8, payloadOffset) {
        try {
            if (u8.byteLength < payloadOffset + 4)
                return null;
        }
        catch { }
        // Re-parse with explicit big-endian
        try {
            const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
            const metaLen = view.getUint32(payloadOffset, false /* big-endian */);
            const metaStart = payloadOffset + 4;
            const metaEnd = metaStart + metaLen;
            if (metaEnd > u8.byteLength)
                return null;
            const metaBytes = u8.slice(metaStart, metaEnd);
            const metaText = new TextDecoder("utf-8").decode(metaBytes);
            let metadata;
            try {
                metadata = JSON.parse(metaText);
            }
            catch (e) {
                metadata = { parse_error: String(e) };
            }
            const imageBytes = u8.slice(metaEnd);
            const type = (metadata && metadata.image_type) || "image/jpeg";
            const blob = new Blob([imageBytes], { type });
            return { blob, metadata };
        }
        catch (e) {
            this.log("_decodePreviewWithMetadata", "Failed to decode", e);
            return null;
        }
    }
    /**
     * High-level sugar: run a Workflow or PromptBuilder directly.
     * Accepts experimental Workflow abstraction or a raw PromptBuilder-like object with setInputNode/output mappings already applied.
     */
    async run(wf, opts) {
        if (wf instanceof Workflow) {
            await this.ready();
            const job = await wf.run(this, { pool: opts?.pool, includeOutputs: opts?.includeOutputs });
            const ensured = this._ensureWorkflowJob(job);
            if (opts?.autoDestroy) {
                if (ensured && typeof ensured.on === "function") {
                    ensured.on("finished", () => this.destroy()).on("failed", () => this.destroy());
                }
                else if (ensured && typeof ensured.finally === "function") {
                    ensured.finally(() => this.destroy());
                }
            }
            return ensured;
        }
        // Assume raw JSON -> wrap
        if (typeof wf === "object" && !wf.run) {
            const w = Workflow.from(wf);
            await this.ready();
            const job = await w.run(this, { pool: opts?.pool, includeOutputs: opts?.includeOutputs });
            const ensured = this._ensureWorkflowJob(job);
            if (opts?.autoDestroy) {
                if (ensured && typeof ensured.on === "function") {
                    ensured.on("finished", () => this.destroy()).on("failed", () => this.destroy());
                }
                else if (ensured && typeof ensured.finally === "function") {
                    ensured.finally(() => this.destroy());
                }
            }
            return ensured;
        }
        throw new Error("Unsupported workflow object passed to api.run");
    }
    /** Backwards compatibility: ensure returned value has minimal WorkflowJob surface (.on/.done). */
    _ensureWorkflowJob(job) {
        if (!job)
            return job;
        const hasOn = typeof job.on === "function";
        const hasDone = typeof job.done === "function";
        if (hasOn && hasDone)
            return job; // already a WorkflowJob
        // Wrap plain promise-like
        if (typeof job.then === "function") {
            const listeners = {};
            const emit = (evt, ...args) => (listeners[evt] || []).forEach((fn) => {
                try {
                    fn(...args);
                }
                catch { }
            });
            // Attempt to tap into resolution
            job.then((val) => {
                emit("finished", val, (val && val._promptId) || undefined);
                return val;
            }, (err) => {
                emit("failed", err);
                throw err;
            });
            return Object.assign(job, {
                on(evt, fn) {
                    (listeners[evt] = listeners[evt] || []).push(fn);
                    return this;
                },
                off(evt, fn) {
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
    async runWorkflow(wf, opts) {
        return this.run(wf, opts);
    }
    /** Convenience helper: run + wait for completion results in one call. */
    async runAndWait(wf, opts) {
        const job = await this.run(wf, { pool: opts?.pool, includeOutputs: opts?.includeOutputs });
        return job.done();
    }
    /**
     * Establish a WebSocket connection for real‑time events; installs polling fallback on failure.
     * @param isReconnect internal flag indicating this creation follows a reconnect attempt
     */
    createSocket(isReconnect = false) {
        let reconnecting = false;
        let usePolling = false;
        // Track last seen executing node + prompt id for correlation
        let lastExecutingNode = null;
        let lastPromptId = null;
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
        this.log("socket", "Preparing to open WebSocket", {
            url: wsUrl,
            // Only include header keys to avoid leaking secrets in logs
            header_keys: Object.keys(headers)
        });
        // Try to create WebSocket connection
        try {
            this.socket = new WebSocket(wsUrl, {
                headers: headers
            });
            this.socket.onclose = () => {
                if (reconnecting || isReconnect)
                    return;
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
                }
                else {
                    this.dispatchEvent(new CustomEvent("connected"));
                }
                // Announce feature flags (configurable via constructor option)
                this.socket?.send(JSON.stringify({
                    type: "feature_flags",
                    data: this.announcedFeatureFlags
                }));
            };
        }
        catch (error) {
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
                    let u8 = null;
                    if (event.data instanceof Buffer) {
                        u8 = event.data;
                    }
                    else if (event.data instanceof ArrayBuffer) {
                        u8 = new Uint8Array(event.data);
                    }
                    else if (ArrayBuffer.isView(event.data)) {
                        const viewAny = event.data;
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
                                // Legacy: preview image without metadata
                                const imageType = view.getUint32(4); // 1=jpeg, 2=png
                                const imageMime = imageType === 2 ? "image/png" : "image/jpeg";
                                const imageBlob = new Blob([u8.slice(8)], { type: imageMime });
                                this.log("socket", "b_preview (binary) received", { size: u8.byteLength, mime: imageMime });
                                this.dispatchEvent(new CustomEvent("b_preview", { detail: imageBlob }));
                                break;
                            }
                            case 2: {
                                // Unencoded preview image (raw). Forward bytes to consumers.
                                const bytes = u8.slice(4);
                                this.log("socket", "b_preview_raw (binary) received", { size: bytes.byteLength });
                                this.dispatchEvent(new CustomEvent("b_preview_raw", { detail: bytes }));
                                break;
                            }
                            case 3: {
                                // Text payload (utf-8) with 4-byte channel preceding text
                                try {
                                    if (u8.byteLength < 8) {
                                        this.log("socket", "b_text frame too small", { size: u8.byteLength });
                                        break;
                                    }
                                    const view2 = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
                                    const channel = view2.getUint32(4, false /* big-endian */);
                                    const text = new TextDecoder("utf-8").decode(u8.slice(8));
                                    this.log("socket", "b_text (binary) received", { size: u8.byteLength, channel, preview: text.slice(0, 120) });
                                    this.dispatchEvent(new CustomEvent("b_text", { detail: text }));
                                    this.dispatchEvent(new CustomEvent("b_text_meta", { detail: { channel, text } }));
                                    // Emit normalized node_text_update for consumers
                                    const norm = { channel, text, kind: "message", executingNode: lastExecutingNode, promptIdHint: lastPromptId };
                                    // Simplify: find the first occurrence of a known phrase and drop everything before it (prefix agnostic)
                                    // This covers prefixes like "LUMA", numeric IDs ("2"), mixed case, etc.
                                    const lower = text.toLowerCase();
                                    const phrases = ["task in progress:", "result url:"];
                                    let start = -1;
                                    for (const p of phrases) {
                                        const idx = lower.indexOf(p);
                                        if (idx !== -1)
                                            start = start === -1 ? idx : Math.min(start, idx);
                                    }
                                    let body = start !== -1 ? text.slice(start).trimStart() : text;
                                    norm.cleanText = body;
                                    const mProg = body.match(/^(?:([A-Z0-9_\-]+))?Task in progress: ([0-9]+(?:\.[0-9]+)?)s/i);
                                    if (mProg) {
                                        norm.kind = "progress";
                                        norm.nodeHint = mProg[1] || undefined;
                                        norm.progressSeconds = Number(mProg[2]);
                                    }
                                    const mUrl = body.match(/^(?:([A-Z0-9_\-]+))?Result URL:\s*(https?:[^\s]+)\s*$/i);
                                    if (mUrl) {
                                        norm.kind = "result";
                                        norm.nodeHint = mUrl[1] || undefined;
                                        norm.resultUrl = mUrl[2];
                                    }
                                    // Fallback: if we couldn't extract a node hint from the text, use the last executing node
                                    if (!norm.nodeHint && lastExecutingNode) {
                                        norm.nodeHint = lastExecutingNode;
                                    }
                                    this.dispatchEvent(new CustomEvent("node_text_update", { detail: norm }));
                                }
                                catch (e) {
                                    this.log("socket", "Failed to decode b_text", e);
                                }
                                break;
                            }
                            case 4: {
                                // Preview image WITH metadata (supports_preview_metadata)
                                try {
                                    const decoded = this._decodePreviewWithMetadata(u8, 4 /*payloadOffset*/);
                                    if (decoded) {
                                        this.log("socket", "b_preview_meta (binary) received", { size: u8.byteLength });
                                        this.dispatchEvent(new CustomEvent("b_preview", { detail: decoded.blob }));
                                        this.dispatchEvent(new CustomEvent("b_preview_meta", { detail: { blob: decoded.blob, metadata: decoded.metadata } }));
                                    }
                                }
                                catch (e) {
                                    this.log("socket", "Failed to decode preview with metadata", e);
                                }
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
                        if (!msg.data || !msg.type)
                            return;
                        this.log("socket-msg", `type=${msg.type}`, { prompt_id: msg.data?.prompt_id, node: msg.data?.node, keys: Object.keys(msg.data || {}) });
                        this.dispatchEvent(new CustomEvent("all", { detail: msg }));
                        if (msg.type === "logs") {
                            this.dispatchEvent(new CustomEvent("terminal", { detail: msg.data.entries?.[0] || null }));
                        }
                        else {
                            this.dispatchEvent(new CustomEvent(msg.type, { detail: msg.data }));
                        }
                        if (msg.data.sid) {
                            this.clientId = msg.data.sid;
                        }
                        // Correlate execution context for text parsing later
                        if (msg.type === "executing") {
                            lastExecutingNode = msg.data?.node ?? null;
                            lastPromptId = msg.data?.prompt_id ?? null;
                        }
                    }
                    else {
                        this.log("socket", "Unhandled message", { kind: typeof event.data });
                    }
                }
                catch (error) {
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
                    if (reconnecting)
                        return;
                    const idleFor = Date.now() - this.lastActivity;
                    if (idleFor > this.wsTimeout) {
                        reconnecting = true;
                        this.log("socket", "Connection timed out, reconnecting...", { idleMs: idleFor, wsTimeout: this.wsTimeout });
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
    setupPollingFallback() {
        this.log("socket", "Setting up polling fallback mechanism");
        // Clear any existing polling timer
        if (this._pollingTimer) {
            try {
                clearInterval(this._pollingTimer);
                this._pollingTimer = null;
            }
            catch (e) {
                this.log("socket", "Error clearing polling timer", e);
            }
        }
        // Poll every 2 seconds
        const POLLING_INTERVAL = 2000;
        const pollFn = async () => {
            try {
                // Poll execution status
                const status = await this.pollStatus();
                const anyStatus = status;
                const queueRem = anyStatus?.status?.exec_info?.queue_remaining ?? anyStatus?.exec_info?.queue_remaining;
                this.log("polling", "status snapshot", { queue_remaining: queueRem });
                // Simulate an event dispatch similar to WebSocket
                this.dispatchEvent(new CustomEvent("status", { detail: status }));
                // Reset activity timestamp to prevent timeout
                this.resetLastActivity();
                // Try to re-establish WebSocket connection periodically
                if (!this.socket || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
                    this.log("socket", "Attempting to restore WebSocket connection");
                    try {
                        this.createSocket(true);
                    }
                    catch (error) {
                        // Continue with polling if WebSocket creation fails
                        this.log("socket", "WebSocket still unavailable, continuing with polling", error);
                    }
                }
                else {
                    // WebSocket is back, we can stop polling
                    this.log("socket", "WebSocket connection restored, stopping polling");
                    if (this._pollingTimer) {
                        clearInterval(this._pollingTimer);
                        this._pollingTimer = null;
                    }
                }
            }
            catch (error) {
                this.log("socket", "Polling error", error);
            }
        };
        // Using setInterval and casting to the expected type
        this._pollingTimer = setInterval(pollFn, POLLING_INTERVAL);
        this.log("socket", `Polling started with interval of ${POLLING_INTERVAL}ms`);
    }
    /**
     * Retrieves a list of all available model folders.
     * @experimental API that may change in future versions
     * @returns A promise that resolves to an array of ModelFolder objects.
     */
    async getModelFolders() {
        try {
            const response = await this.fetchApi("/experiment/models");
            if (!response.ok) {
                this.log("getModelFolders", "Failed to fetch model folders", response);
                throw new Error(`Failed to fetch model folders: ${response.status} ${response.statusText}`);
            }
            return response.json();
        }
        catch (error) {
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
    async getModelFiles(folder) {
        try {
            const response = await this.fetchApi(`/experiment/models/${encodeURIComponent(folder)}`);
            if (!response.ok) {
                this.log("getModelFiles", "Failed to fetch model files", { folder, response });
                throw new Error(`Failed to fetch model files: ${response.status} ${response.statusText}`);
            }
            return response.json();
        }
        catch (error) {
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
    async getModelPreview(folder, pathIndex, filename) {
        try {
            const response = await this.fetchApi(`/experiment/models/preview/${encodeURIComponent(folder)}/${pathIndex}/${encodeURIComponent(filename)}`);
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
        }
        catch (error) {
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
    getModelPreviewUrl(folder, pathIndex, filename) {
        return this.apiURL(`/experiment/models/preview/${encodeURIComponent(folder)}/${pathIndex}/${encodeURIComponent(filename)}`);
    }
    /**
     * Retrieves a list of available checkpoints from the ComfyUI server.
     * @experimental API that may change in future versions
     * @returns A promise that resolves to an array of checkpoint filenames.
     */
    async getCheckpoints() {
        try {
            const response = await this.fetchApi("/experiment/models/checkpoints");
            if (!response.ok) {
                this.log("getCheckpoints", "Failed to fetch checkpoints", response);
                throw new Error(`Failed to fetch checkpoints: ${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            // The API returns an array of ModelFile objects with a 'name' property
            return Array.isArray(data) ? data.map((item) => item.name || item) : [];
        }
        catch (error) {
            this.log("getCheckpoints", "Error fetching checkpoints", error);
            throw error;
        }
    }
}
/**
 * Remove large / sensitive fields before logging objects to console in debug mode.
 */
function sanitizeForLog(input) {
    try {
        if (!input || typeof input !== "object")
            return input;
        const clone = Array.isArray(input) ? [] : {};
        const SENSITIVE_KEYS = new Set(["api_key", "api_key_comfy_org", "Authorization", "headers"]);
        for (const [k, v] of Object.entries(input)) {
            if (SENSITIVE_KEYS.has(k)) {
                clone[k] = "<redacted>";
                continue;
            }
            if (v && typeof v === "object") {
                clone[k] = sanitizeForLog(v);
            }
            else if (typeof v === "string" && v.length > 500) {
                clone[k] = `${v.slice(0, 497)}...`;
            }
            else {
                clone[k] = v;
            }
        }
        return clone;
    }
    catch {
        return input;
    }
}
//# sourceMappingURL=client.js.map