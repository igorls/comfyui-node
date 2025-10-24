import { BasicCredentials, BearerTokenCredentials, CustomCredentials, ModelFile, ModelFolder, ModelPreviewResponse, OSType, QueueResponse, QueueStatus } from "./types/api.js";
import { TComfyAPIEventMap } from "./types/event.js";
import { TypedEventTarget } from "./typed-event-target.js";
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
import { WorkflowJob, WorkflowResult } from "./workflow.js";
interface FetchOptions extends RequestInit {
    headers?: {
        [key: string]: string;
    };
}
type FeatureFlagsAnnouncement = {
    /** Whether client supports decoding preview frames with metadata (default: true) */
    supports_preview_metadata: boolean;
    /** Client-advertised max upload size in bytes (default: 200MB) */
    max_upload_size: number;
};
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
export declare class ComfyApi extends TypedEventTarget<TComfyAPIEventMap> {
    /** Base host (including protocol) e.g. http://localhost:8188 */
    apiHost: string;
    /** OS type as reported by the server (resolved during init) */
    osType: OSType;
    /** Indicates feature probing + socket establishment completed */
    isReady: boolean;
    /** Internal ready promise (resolved once). */
    private readyPromise;
    private resolveReady;
    /** Whether to subscribe to terminal log streaming on init */
    listenTerminal: boolean;
    /** Monotonic timestamp of last socket activity (used for timeout detection) */
    lastActivity: number;
    /** WebSocket inactivity timeout (ms) before attempting reconnection */
    private readonly wsTimeout;
    private wsTimer;
    private _pollingTimer;
    /** Host sans protocol (used to compose ws:// / wss:// URL) */
    private readonly apiBase;
    private clientId;
    private socket;
    private listeners;
    private readonly credentials;
    comfyOrgApiKey?: string;
    /** Debug flag to emit verbose console logs for instrumentation */
    private _debug;
    private headers;
    /** Feature flags we announce to the server upon socket open */
    private announcedFeatureFlags;
    /** Modular feature namespaces (tree intentionally flat & dependency‑free) */
    ext: {
        /** ComfyUI-Manager extension integration */
        readonly manager: ManagerFeature;
        /** Crystools monitor / system resource streaming */
        readonly monitor: MonitoringFeature;
        /** Prompt queue submission / control */
        readonly queue: QueueFeature;
        /** Execution history lookups */
        readonly history: HistoryFeature;
        /** System stats & memory free */
        readonly system: SystemFeature;
        /** Node defs + sampler / checkpoint / lora helpers */
        readonly node: NodeFeature;
        /** User CRUD & settings */
        readonly user: UserFeature;
        /** File uploads, image helpers & user data file operations */
        readonly file: FileFeature;
        /** Experimental model browsing / preview */
        readonly model: ModelFeature;
        /** Terminal log retrieval & streaming toggle */
        readonly terminal: TerminalFeature;
        /** Misc endpoints (extensions list, embeddings) */
        readonly misc: MiscFeature;
        /** Server advertised feature flags */
        readonly featureFlags: FeatureFlagsFeature;
    };
    /** Helper type guard shaping expected feature API */
    private asFeature;
    static generateId(): string;
    on<K extends keyof TComfyAPIEventMap>(type: K, callback: (event: TComfyAPIEventMap[K]) => void, options?: AddEventListenerOptions | boolean): () => void;
    off<K extends keyof TComfyAPIEventMap>(type: K, callback: (event: TComfyAPIEventMap[K]) => void, options?: EventListenerOptions | boolean): void;
    removeAllListeners(): void;
    get id(): string;
    /**
     * Retrieves the available features of the client.
     *
     * @returns An object containing the available features, where each feature is a key-value pair.
     */
    get availableFeatures(): Record<string, boolean>;
    constructor(host: string, clientId?: string, opts?: {
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
        /** Optional feature flags to announce on WebSocket open (merged with defaults). */
        announceFeatureFlags?: Partial<FeatureFlagsAnnouncement>;
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
            customDelayFn?: (attempt: number, opts: {
                baseDelayMs: number;
                maxDelayMs: number;
            }) => number;
        };
        /** Optional Comfy-Org API key for paid API nodes. */
        comfyOrgApiKey?: string;
        /** Enable verbose debug logging to console (also emits 'log' events). */
        debug?: boolean;
    });
    /**
     * Destroys the client instance.
     * Ensures all connections, timers and event listeners are properly closed.
     */
    destroy(): void;
    private log;
    /**
     * Build full API URL (made public for feature modules)
     */
    apiURL(route: string): string;
    private getCredentialHeaders;
    private testCredentials;
    private testFeatures;
    /**
     * Fetches data from the API.
     *
     * @param route - The route to fetch data from.
     * @param options - The options for the fetch request.
     * @returns A promise that resolves to the response from the API.
     */
    fetchApi(route: string, options?: FetchOptions): Promise<Response>;
    /**
     * Polls the status for colab and other things that don't support websockets.
     * @returns {Promise<QueueStatus>} The status information.
     */
    pollStatus(timeout?: number): Promise<QueueStatus>;
    /**
     * Queues a prompt for processing.
     * @param {number} number The index at which to queue the prompt. using NULL will append to the end of the queue.
     * @param {object} workflow Additional workflow data.
     * @returns {Promise<QueuePromptResponse>} The response from the API.
     */
    /**
     * Fetch raw queue status snapshot (lightweight helper not yet moved into a feature wrapper).
     */
    getQueue(): Promise<QueueResponse>;
    /**
     * Hint the server to unload models / free memory (maps to `/free`).
     * Returns false if request fails (does not throw to simplify caller ergonomics).
     */
    freeMemory(unloadModels: boolean, freeMemory: boolean): Promise<boolean>;
    /**
     * Initialize: ping server with retries, probe features, establish WebSocket, optionally subscribe to terminal logs.
     * Resolves with the client instance when ready; throws on unrecoverable connection failure.
     */
    init(maxTries?: number, delayTime?: number): Promise<this>;
    private pingSuccess;
    /** Await until feature probing + socket creation finished. */
    waitForReady(): Promise<this>;
    /**
     * Sends a ping request to the server and returns a boolean indicating whether the server is reachable.
     * @returns A promise that resolves to `true` if the server is reachable, or `false` otherwise.
     */
    ping(): Promise<{
        readonly status: true;
        readonly time: number;
    } | {
        readonly status: false;
    }>;
    /**
     * Attempt WebSocket reconnection with exponential backoff + jitter.
     * Falls back to a bounded number of attempts then emits `reconnection_failed`.
     */
    reconnectWs(triggerEvent?: boolean): Promise<void>;
    /** Abort any in-flight reconnection loop (no-op if none active). */
    abortReconnect(): void;
    private resetLastActivity;
    /** Convenience: init + waitForReady (idempotent). */
    ready(): Promise<this>;
    /**
     * Decode a preview-with-metadata binary frame.
     * Layout after the 4-byte event type header:
     *   [0..3]   eventType (already consumed by caller)
     *   [4..7]   big-endian uint32: metadata JSON byte length (N)
     *   [8..8+N) metadata JSON (utf-8)
     *   [8+N..]  image bytes (png/jpeg as declared in metadata.image_type)
     * Returns null if parsing fails.
     */
    private _decodePreviewWithMetadata;
    /**
     * High-level sugar: run a Workflow or PromptBuilder directly.
     * Accepts experimental Workflow abstraction or a raw PromptBuilder-like object with setInputNode/output mappings already applied.
     */
    run(wf: any, opts?: {
        pool?: any;
        autoDestroy?: boolean;
        includeOutputs?: string[];
    }): Promise<WorkflowJob<WorkflowResult>>;
    /** Backwards compatibility: ensure returned value has minimal WorkflowJob surface (.on/.done). */
    private _ensureWorkflowJob;
    /** Alias for clarity when passing explicit Workflow objects */
    runWorkflow(wf: any, opts?: {
        pool?: any;
        autoDestroy?: boolean;
        includeOutputs?: string[];
    }): Promise<WorkflowJob<WorkflowResult>>;
    /** Convenience helper: run + wait for completion results in one call. */
    runAndWait(wf: any, opts?: {
        pool?: any;
        includeOutputs?: string[];
    }): Promise<WorkflowResult>;
    /**
     * Establish a WebSocket connection for real‑time events; installs polling fallback on failure.
     * @param isReconnect internal flag indicating this creation follows a reconnect attempt
     */
    private createSocket;
    /**
     * Install a 2s interval polling loop to replicate essential status events when WebSocket is unavailable.
     * Stops automatically once a socket connection is restored.
     */
    private setupPollingFallback;
    /**
     * Retrieves a list of all available model folders.
     * @experimental API that may change in future versions
     * @returns A promise that resolves to an array of ModelFolder objects.
     */
    getModelFolders(): Promise<ModelFolder[]>;
    /**
     * Retrieves a list of all model files in a specific folder.
     * @experimental API that may change in future versions
     * @param folder - The name of the model folder.
     * @returns A promise that resolves to an array of ModelFile objects.
     */
    getModelFiles(folder: string): Promise<ModelFile[]>;
    /**
     * Retrieves a preview image for a specific model file.
     * @experimental API that may change in future versions
     * @param folder - The name of the model folder.
     * @param pathIndex - The index of the folder path where the file is stored.
     * @param filename - The name of the model file.
     * @returns A promise that resolves to a ModelPreviewResponse object containing the preview image data.
     */
    getModelPreview(folder: string, pathIndex: number, filename: string): Promise<ModelPreviewResponse>;
    /**
     * Creates a URL for a model preview image.
     * @experimental API that may change in future versions
     * @param folder - The name of the model folder.
     * @param pathIndex - The index of the folder path where the file is stored.
     * @param filename - The name of the model file.
     * @returns The URL string for the model preview.
     */
    getModelPreviewUrl(folder: string, pathIndex: number, filename: string): string;
    /**
     * Retrieves a list of available checkpoints from the ComfyUI server.
     * @experimental API that may change in future versions
     * @returns A promise that resolves to an array of checkpoint filenames.
     */
    getCheckpoints(): Promise<string[]>;
}
export {};
//# sourceMappingURL=client.d.ts.map