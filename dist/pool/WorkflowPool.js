import { randomUUID } from "node:crypto";
import { TypedEventTarget } from "../typed-event-target.js";
import { Workflow } from "../workflow.js";
import { PromptBuilder } from "../prompt-builder.js";
import { CallWrapper } from "../call-wrapper.js";
import { MemoryQueueAdapter } from "./queue/adapters/memory.js";
import { SmartFailoverStrategy } from "./failover/SmartFailoverStrategy.js";
import { ClientManager } from "./client/ClientManager.js";
import { hashWorkflow } from "./utils/hash.js";
import { cloneDeep } from "./utils/clone.js";
import { JobProfiler } from "./profiling/JobProfiler.js";
import { analyzeWorkflowFailure } from "./utils/failure-analysis.js";
import { WorkflowNotSupportedError } from "../types/error.js";
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY = 1000;
export class WorkflowPool extends TypedEventTarget {
    queue;
    strategy;
    clientManager;
    opts;
    jobStore = new Map();
    jobFailureAnalysis = new Map();
    affinities = new Map();
    initPromise;
    processing = false;
    activeJobs = new Map();
    constructor(clients, opts) {
        super();
        this.strategy = opts?.failoverStrategy ?? new SmartFailoverStrategy();
        this.queue = opts?.queueAdapter ?? new MemoryQueueAdapter();
        this.clientManager = new ClientManager(this.strategy, {
            healthCheckIntervalMs: opts?.healthCheckIntervalMs ?? 30000
        });
        this.opts = opts ?? {};
        if (opts?.workflowAffinities) {
            for (const affinity of opts.workflowAffinities) {
                this.affinities.set(affinity.workflowHash, affinity);
            }
        }
        this.clientManager.on("client:state", (ev) => {
            this.dispatchEvent(new CustomEvent("client:state", { detail: ev.detail }));
        });
        this.clientManager.on("client:blocked_workflow", (ev) => {
            this.dispatchEvent(new CustomEvent("client:blocked_workflow", { detail: ev.detail }));
        });
        this.clientManager.on("client:unblocked_workflow", (ev) => {
            this.dispatchEvent(new CustomEvent("client:unblocked_workflow", { detail: ev.detail }));
        });
        this.initPromise = this.clientManager
            .initialize(clients)
            .then(() => {
            this.dispatchEvent(new CustomEvent("pool:ready", {
                detail: { clientIds: this.clientManager.list().map((c) => c.id) }
            }));
        })
            .catch((error) => {
            this.dispatchEvent(new CustomEvent("pool:error", { detail: { error } }));
        });
    }
    async ready() {
        await this.initPromise;
    }
    setAffinity(affinity) {
        this.affinities.set(affinity.workflowHash, affinity);
    }
    removeAffinity(workflowHash) {
        return this.affinities.delete(workflowHash);
    }
    getAffinities() {
        return Array.from(this.affinities.values());
    }
    async enqueue(workflowInput, options) {
        await this.ready();
        const workflowJson = this.normalizeWorkflow(workflowInput);
        // Use the workflow's pre-computed structureHash if available (from Workflow instance)
        // Otherwise compute it from the JSON
        let workflowHash;
        if (workflowInput instanceof Workflow) {
            workflowHash = workflowInput.structureHash ?? hashWorkflow(workflowJson);
        }
        else {
            workflowHash = hashWorkflow(workflowJson);
        }
        const jobId = options?.jobId ?? this.generateJobId();
        // Extract workflow metadata (outputAliases, outputNodeIds, etc.) if input is a Workflow instance
        let workflowMeta;
        if (workflowInput instanceof Workflow) {
            workflowMeta = {
                outputNodeIds: workflowInput.outputNodeIds ?? [],
                outputAliases: workflowInput.outputAliases ?? {}
            };
        }
        const affinity = this.affinities.get(workflowHash);
        const preferredClientIds = options?.preferredClientIds ?? affinity?.preferredClientIds ?? [];
        const excludeClientIds = options?.excludeClientIds ?? affinity?.excludeClientIds ?? [];
        const payload = {
            jobId,
            workflow: workflowJson,
            workflowHash,
            attempts: 0,
            enqueuedAt: Date.now(),
            workflowMeta,
            options: {
                maxAttempts: options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
                retryDelayMs: options?.retryDelayMs ?? DEFAULT_RETRY_DELAY,
                priority: options?.priority ?? 0,
                preferredClientIds: preferredClientIds,
                excludeClientIds: excludeClientIds,
                metadata: options?.metadata ?? {},
                includeOutputs: options?.includeOutputs ?? []
            }
        };
        const record = {
            ...payload,
            attachments: options?.attachments,
            status: "queued"
        };
        this.jobStore.set(jobId, record);
        await this.queue.enqueue(payload, { priority: payload.options.priority });
        this.dispatchEvent(new CustomEvent("job:queued", { detail: { job: record } }));
        void this.processQueue();
        return jobId;
    }
    getJob(jobId) {
        return this.jobStore.get(jobId);
    }
    async cancel(jobId) {
        const record = this.jobStore.get(jobId);
        if (!record) {
            return false;
        }
        if (record.status === "queued") {
            const removed = await this.queue.remove(jobId);
            if (removed) {
                record.status = "cancelled";
                record.completedAt = Date.now();
                this.clearJobFailures(jobId);
                this.dispatchEvent(new CustomEvent("job:cancelled", { detail: { job: record } }));
                return true;
            }
        }
        const active = this.activeJobs.get(jobId);
        if (active?.cancel) {
            await active.cancel();
            record.status = "cancelled";
            record.completedAt = Date.now();
            this.clearJobFailures(jobId);
            this.dispatchEvent(new CustomEvent("job:cancelled", { detail: { job: record } }));
            return true;
        }
        return false;
    }
    async shutdown() {
        this.clientManager.destroy();
        await this.queue.shutdown();
        for (const [, ctx] of Array.from(this.activeJobs)) {
            ctx.release({ success: false });
        }
        this.activeJobs.clear();
    }
    async getQueueStats() {
        return this.queue.stats();
    }
    normalizeWorkflow(input) {
        if (typeof input === "string") {
            return JSON.parse(input);
        }
        if (input instanceof Workflow) {
            return cloneDeep(input.json ?? {});
        }
        if (typeof input?.toJSON === "function") {
            return cloneDeep(input.toJSON());
        }
        return cloneDeep(input);
    }
    generateJobId() {
        try {
            return randomUUID();
        }
        catch {
            return WorkflowPool.fallbackId();
        }
    }
    static fallbackId() {
        return globalThis.crypto && "randomUUID" in globalThis.crypto
            ? globalThis.crypto.randomUUID()
            : `job_${Math.random().toString(36).slice(2, 10)}`;
    }
    scheduleProcess(delayMs) {
        const wait = Math.max(delayMs, 10);
        setTimeout(() => {
            void this.processQueue();
        }, wait);
    }
    applyAutoSeed(workflow) {
        const autoSeeds = {};
        for (const [nodeId, nodeValue] of Object.entries(workflow)) {
            if (!nodeValue || typeof nodeValue !== "object")
                continue;
            const inputs = nodeValue.inputs;
            if (!inputs || typeof inputs !== "object")
                continue;
            if (typeof inputs.seed === "number" && inputs.seed === -1) {
                const val = Math.floor(Math.random() * 2_147_483_647);
                inputs.seed = val;
                autoSeeds[nodeId] = val;
            }
        }
        return autoSeeds;
    }
    rememberJobFailure(job, clientId, analysis) {
        let map = this.jobFailureAnalysis.get(job.jobId);
        if (!map) {
            map = new Map();
            this.jobFailureAnalysis.set(job.jobId, map);
        }
        map.set(clientId, analysis);
    }
    clearJobFailures(jobId) {
        this.jobFailureAnalysis.delete(jobId);
    }
    collectFailureReasons(jobId) {
        const map = this.jobFailureAnalysis.get(jobId);
        if (!map) {
            return {};
        }
        const reasons = {};
        for (const [clientId, analysis] of map.entries()) {
            reasons[clientId] = analysis.reason;
        }
        return reasons;
    }
    addPermanentExclusion(job, clientId) {
        if (!job.options.excludeClientIds) {
            job.options.excludeClientIds = [];
        }
        if (!job.options.excludeClientIds.includes(clientId)) {
            job.options.excludeClientIds.push(clientId);
        }
    }
    hasRetryPath(job) {
        const map = this.jobFailureAnalysis.get(job.jobId);
        const exclude = new Set(job.options.excludeClientIds ?? []);
        const preferred = job.options.preferredClientIds?.length ? new Set(job.options.preferredClientIds) : null;
        for (const client of this.clientManager.list()) {
            if (preferred && !preferred.has(client.id)) {
                continue;
            }
            if (exclude.has(client.id)) {
                continue;
            }
            const analysis = map?.get(client.id);
            if (analysis?.blockClient === "permanent") {
                continue;
            }
            return true;
        }
        return false;
    }
    createWorkflowNotSupportedError(job, cause) {
        const reasons = this.collectFailureReasons(job.jobId);
        const message = `Workflow ${job.workflowHash} is not supported by any connected clients`;
        return new WorkflowNotSupportedError(message, {
            workflowHash: job.workflowHash,
            reasons,
            cause
        });
    }
    async processQueue() {
        if (this.processing) {
            return;
        }
        this.processing = true;
        try {
            const idleClients = this.clientManager.list().filter(c => this.clientManager.isClientStable(c));
            if (!idleClients.length) {
                return;
            }
            const waitingJobs = await this.queue.peek(100); // Peek at top 100 jobs
            if (!waitingJobs.length) {
                return;
            }
            const leasedClientIds = new Set();
            const reservedJobIds = new Set();
            const jobMatchInfos = [];
            for (const jobPayload of waitingJobs) {
                const job = this.jobStore.get(jobPayload.jobId);
                if (!job)
                    continue;
                const compatibleClients = idleClients
                    .filter(client => this.clientManager.canClientRunJob(client, job))
                    .map(client => client.id);
                if (compatibleClients.length > 0) {
                    jobMatchInfos.push({
                        jobPayload,
                        job,
                        compatibleClients,
                        selectivity: compatibleClients.length
                    });
                }
            }
            // Sort jobs by priority first, then selectivity, to maximize throughput
            // 1. Higher priority jobs execute first (explicit user priority)
            // 2. More selective jobs (fewer compatible clients) assigned first within same priority
            // 3. Earlier queue position as final tiebreaker
            jobMatchInfos.sort((a, b) => {
                // Primary: priority (higher priority = higher precedence)
                const aPriority = a.job.options.priority ?? 0;
                const bPriority = b.job.options.priority ?? 0;
                if (aPriority !== bPriority) {
                    return bPriority - aPriority; // Higher priority first
                }
                // Secondary: selectivity (fewer compatible clients = higher precedence)
                if (a.selectivity !== b.selectivity) {
                    return a.selectivity - b.selectivity;
                }
                // Tertiary: maintain queue order (earlier jobs first)
                const aIndex = waitingJobs.indexOf(a.jobPayload);
                const bIndex = waitingJobs.indexOf(b.jobPayload);
                return aIndex - bIndex;
            });
            // Assign jobs to clients using the selectivity-based ordering
            for (const matchInfo of jobMatchInfos) {
                if (reservedJobIds.has(matchInfo.job.jobId))
                    continue;
                // Find first available compatible client
                const availableClient = matchInfo.compatibleClients.find(clientId => !leasedClientIds.has(clientId));
                if (!availableClient)
                    continue; // No available clients for this job
                const reservation = await this.queue.reserveById(matchInfo.job.jobId);
                if (reservation) {
                    // Mark as leased/reserved for this cycle
                    leasedClientIds.add(availableClient);
                    reservedJobIds.add(matchInfo.job.jobId);
                    // Get the lease (which marks the client as busy)
                    const lease = this.clientManager.claim(matchInfo.job, availableClient);
                    if (lease) {
                        this.runJob({ reservation, job: matchInfo.job, clientId: lease.clientId, release: lease.release }).catch((error) => {
                            console.error("[WorkflowPool] Unhandled job error", error);
                        });
                    }
                    else {
                        // This should not happen since we checked canClientRunJob, but handle defensively
                        console.error(`[WorkflowPool.processQueue] CRITICAL: Failed to claim client ${availableClient} for job ${matchInfo.job.jobId} after successful check.`);
                        await this.queue.retry(reservation.reservationId, { delayMs: matchInfo.job.options.retryDelayMs });
                    }
                }
            }
        }
        finally {
            this.processing = false;
        }
    }
    async runJob(ctx) {
        const { reservation, job, clientId, release } = ctx;
        const managed = this.clientManager.getClient(clientId);
        const client = managed?.client;
        if (!client) {
            await this.queue.retry(reservation.reservationId, { delayMs: job.options.retryDelayMs });
            release({ success: false });
            return;
        }
        job.status = "running";
        job.clientId = clientId;
        job.attempts += 1;
        reservation.payload.attempts = job.attempts;
        job.startedAt = Date.now();
        // Don't dispatch job:started here - wait until we have promptId in onPending
        // this.dispatchEvent(new CustomEvent("job:started", { detail: { job } }));
        const workflowPayload = cloneDeep(reservation.payload.workflow);
        if (job.attachments?.length) {
            for (const attachment of job.attachments) {
                const filename = attachment.filename ?? `${job.jobId}-${attachment.nodeId}-${attachment.inputName}.bin`;
                const blob = attachment.file instanceof Buffer ? new Blob([new Uint8Array(attachment.file)]) : attachment.file;
                await client.ext.file.uploadImage(blob, filename, { override: true });
                const node = workflowPayload[attachment.nodeId];
                if (node?.inputs) {
                    node.inputs[attachment.inputName] = filename;
                }
            }
        }
        const autoSeeds = this.applyAutoSeed(workflowPayload);
        let wfInstance = Workflow.from(workflowPayload);
        if (job.options.includeOutputs?.length) {
            for (const nodeId of job.options.includeOutputs) {
                if (nodeId) {
                    wfInstance = wfInstance.output(nodeId);
                }
            }
        }
        wfInstance.inferDefaultOutputs?.();
        // Use stored metadata if available (from Workflow instance), otherwise extract from recreated instance
        const outputNodeIds = reservation.payload.workflowMeta?.outputNodeIds ??
            wfInstance.outputNodeIds ??
            job.options.includeOutputs ??
            [];
        const outputAliases = reservation.payload.workflowMeta?.outputAliases ?? wfInstance.outputAliases ?? {};
        let promptBuilder = new PromptBuilder(wfInstance.json, wfInstance.inputPaths ?? [], outputNodeIds);
        for (const nodeId of outputNodeIds) {
            const alias = outputAliases[nodeId] ?? nodeId;
            promptBuilder = promptBuilder.setOutputNode(alias, nodeId);
        }
        const wrapper = new CallWrapper(client, promptBuilder);
        // Setup profiling if enabled
        const profiler = this.opts.enableProfiling ? new JobProfiler(job.enqueuedAt, workflowPayload) : undefined;
        // Setup node execution timeout tracking
        const nodeExecutionTimeout = this.opts.nodeExecutionTimeoutMs ?? 300000; // 5 minutes default
        let nodeTimeoutId;
        let lastNodeStartTime;
        let currentExecutingNode = null;
        const resetNodeTimeout = (nodeName) => {
            if (nodeTimeoutId) {
                clearTimeout(nodeTimeoutId);
                nodeTimeoutId = undefined;
            }
            if (nodeExecutionTimeout > 0 && nodeName !== null) {
                lastNodeStartTime = Date.now();
                currentExecutingNode = nodeName || null;
                nodeTimeoutId = setTimeout(() => {
                    const elapsed = Date.now() - (lastNodeStartTime || 0);
                    const nodeInfo = currentExecutingNode ? ` (node: ${currentExecutingNode})` : "";
                    completionError = new Error(`Node execution timeout: took longer than ${nodeExecutionTimeout}ms${nodeInfo}. ` +
                        `Actual time: ${elapsed}ms. Server may be stuck or node is too slow for configured timeout.`);
                    resolveCompletion?.();
                }, nodeExecutionTimeout);
            }
        };
        const clearNodeTimeout = () => {
            if (nodeTimeoutId) {
                clearTimeout(nodeTimeoutId);
                nodeTimeoutId = undefined;
            }
            currentExecutingNode = null;
            lastNodeStartTime = undefined;
        };
        // Setup profiling event listeners on the raw ComfyUI client
        if (profiler) {
            const onExecutionStart = (event) => {
                const promptId = event.detail?.prompt_id;
                if (promptId) {
                    profiler.onExecutionStart(promptId);
                }
            };
            const onExecutionCached = (event) => {
                const nodes = event.detail?.nodes;
                if (Array.isArray(nodes)) {
                    profiler.onCachedNodes(nodes.map(String));
                }
            };
            const onExecuting = (event) => {
                const node = event.detail?.node;
                if (node === null) {
                    // Workflow completed
                    profiler.onExecutionComplete();
                }
                else if (node !== undefined) {
                    profiler.onNodeExecuting(String(node));
                }
            };
            const onExecutionError = (event) => {
                const detail = event.detail || {};
                if (detail.node !== undefined) {
                    profiler.onNodeError(String(detail.node), detail.exception_message || "Execution error");
                }
            };
            // Attach listeners to client
            client.addEventListener("execution_start", onExecutionStart);
            client.addEventListener("execution_cached", onExecutionCached);
            client.addEventListener("executing", onExecuting);
            client.addEventListener("execution_error", onExecutionError);
            // Cleanup function to remove listeners
            const cleanupProfiler = () => {
                client.removeEventListener("execution_start", onExecutionStart);
                client.removeEventListener("execution_cached", onExecutionCached);
                client.removeEventListener("executing", onExecuting);
                client.removeEventListener("execution_error", onExecutionError);
            };
            // Ensure cleanup happens when job finishes
            wrapper.onFinished(() => cleanupProfiler());
            wrapper.onFailed(() => cleanupProfiler());
        }
        // Setup node execution timeout listeners (always active if timeout > 0)
        const onNodeExecuting = (event) => {
            const node = event.detail?.node;
            if (node === null) {
                // Workflow completed - clear timeout
                clearNodeTimeout();
            }
            else if (node !== undefined) {
                // New node started - reset timeout
                resetNodeTimeout(String(node));
            }
        };
        const onNodeProgress = (event) => {
            // Progress event means node is still working - reset timeout
            if (event.detail?.node) {
                resetNodeTimeout(String(event.detail.node));
            }
        };
        const onExecutionStarted = (event) => {
            // Execution started - reset timeout for first node
            resetNodeTimeout("execution_start");
        };
        if (nodeExecutionTimeout > 0) {
            client.addEventListener("execution_start", onExecutionStarted);
            client.addEventListener("executing", onNodeExecuting);
            client.addEventListener("progress", onNodeProgress);
        }
        const cleanupNodeTimeout = () => {
            clearNodeTimeout();
            if (nodeExecutionTimeout > 0) {
                client.removeEventListener("execution_start", onExecutionStarted);
                client.removeEventListener("executing", onNodeExecuting);
                client.removeEventListener("progress", onNodeProgress);
            }
        };
        let pendingSettled = false;
        let resolvePending;
        let rejectPending;
        const pendingPromise = new Promise((resolve, reject) => {
            resolvePending = () => {
                if (!pendingSettled) {
                    pendingSettled = true;
                    resolve();
                }
            };
            rejectPending = (err) => {
                if (!pendingSettled) {
                    pendingSettled = true;
                    reject(err);
                }
            };
        });
        let resolveCompletion;
        let completionError;
        // completionPromise is used to track when the wrapper completes (success or failure)
        // It's resolved in onFinished and onFailed handlers
        new Promise((resolve) => {
            resolveCompletion = resolve;
        });
        let jobStartedDispatched = false;
        wrapper.onProgress((progress, promptId) => {
            if (!job.promptId && promptId) {
                job.promptId = promptId;
            }
            // Dispatch job:started on first progress update with promptId
            if (!jobStartedDispatched && job.promptId) {
                jobStartedDispatched = true;
                this.dispatchEvent(new CustomEvent("job:started", { detail: { job } }));
            }
            // Feed progress to profiler
            if (profiler) {
                profiler.onProgress(progress);
            }
            this.dispatchEvent(new CustomEvent("job:progress", {
                detail: { jobId: job.jobId, clientId, progress }
            }));
        });
        wrapper.onPreview((blob, promptId) => {
            if (!job.promptId && promptId) {
                job.promptId = promptId;
            }
            // Dispatch job:started on first preview with promptId
            if (!jobStartedDispatched && job.promptId) {
                jobStartedDispatched = true;
                this.dispatchEvent(new CustomEvent("job:started", { detail: { job } }));
            }
            this.dispatchEvent(new CustomEvent("job:preview", {
                detail: { jobId: job.jobId, clientId, blob }
            }));
        });
        wrapper.onPreviewMeta((payload, promptId) => {
            if (!job.promptId && promptId) {
                job.promptId = promptId;
            }
            // Dispatch job:started on first preview_meta with promptId
            if (!jobStartedDispatched && job.promptId) {
                jobStartedDispatched = true;
                this.dispatchEvent(new CustomEvent("job:started", { detail: { job } }));
            }
            this.dispatchEvent(new CustomEvent("job:preview_meta", {
                detail: { jobId: job.jobId, clientId, payload }
            }));
        });
        wrapper.onOutput((key, data, promptId) => {
            if (!job.promptId && promptId) {
                job.promptId = promptId;
            }
            this.dispatchEvent(new CustomEvent("job:output", {
                detail: { jobId: job.jobId, clientId, key: String(key), data }
            }));
        });
        wrapper.onPending((promptId) => {
            if (!job.promptId && promptId) {
                job.promptId = promptId;
            }
            // Don't dispatch job:started here - wait for first progress/preview with promptId
            this.dispatchEvent(new CustomEvent("job:accepted", { detail: { job } }));
            resolvePending?.();
        });
        wrapper.onStart((promptId) => {
            if (!job.promptId && promptId) {
                job.promptId = promptId;
            }
        });
        wrapper.onFinished((data, promptId) => {
            if (!job.promptId && promptId) {
                job.promptId = promptId;
            }
            job.status = "completed";
            job.lastError = undefined;
            const resultPayload = {};
            for (const nodeId of outputNodeIds) {
                const alias = outputAliases[nodeId] ?? nodeId;
                // CallWrapper uses alias keys when mapOutputKeys is configured, fallback to nodeId
                const nodeResult = data[alias];
                const fallbackResult = data[nodeId];
                const finalResult = nodeResult !== undefined ? nodeResult : fallbackResult;
                resultPayload[alias] = finalResult;
            }
            resultPayload._nodes = [...outputNodeIds];
            resultPayload._aliases = { ...outputAliases };
            if (job.promptId) {
                resultPayload._promptId = job.promptId;
            }
            if (Object.keys(autoSeeds).length) {
                resultPayload._autoSeeds = { ...autoSeeds };
            }
            job.result = resultPayload;
            job.completedAt = Date.now();
            this.clearJobFailures(job.jobId);
            // Cleanup timeouts
            cleanupNodeTimeout();
            // Attach profiling stats if profiling was enabled
            if (profiler) {
                job.profileStats = profiler.getStats();
            }
            completionError = undefined;
            this.dispatchEvent(new CustomEvent("job:completed", { detail: { job } }));
            resolveCompletion?.();
        });
        wrapper.onFailed((error, promptId) => {
            console.log("[debug] wrapper.onFailed", job.jobId, error.name);
            if (!job.promptId && promptId) {
                job.promptId = promptId;
            }
            job.lastError = error;
            // Cleanup timeouts
            cleanupNodeTimeout();
            rejectPending?.(error);
            completionError = error;
            console.log("[debug] resolveCompletion available", Boolean(resolveCompletion));
            resolveCompletion?.();
        });
        try {
            // Start the workflow execution
            const exec = wrapper.run();
            // Add timeout for execution start to prevent jobs getting stuck
            const executionStartTimeout = this.opts.executionStartTimeoutMs ?? 5000;
            let pendingTimeoutId;
            if (executionStartTimeout > 0) {
                const pendingWithTimeout = Promise.race([
                    pendingPromise,
                    new Promise((_, reject) => {
                        pendingTimeoutId = setTimeout(() => {
                            reject(new Error(`Execution failed to start within ${executionStartTimeout}ms. ` +
                                `Server may be stuck or unresponsive.`));
                        }, executionStartTimeout);
                    })
                ]);
                await pendingWithTimeout;
            }
            else {
                await pendingPromise;
            }
            if (executionStartTimeout > 0) {
                clearTimeout(pendingTimeoutId);
            }
            this.activeJobs.set(job.jobId, {
                reservation,
                job,
                clientId,
                release,
                cancel: async () => {
                    try {
                        wrapper.cancel("workflow pool cancel");
                        if (job.promptId) {
                            await client.ext.queue.interrupt(job.promptId);
                        }
                    }
                    finally {
                        this.activeJobs.delete(job.jobId);
                        await this.queue.discard(reservation.reservationId, new Error("cancelled"));
                        release({ success: false });
                    }
                }
            });
            const result = await exec;
            if (result === false) {
                const errorToThrow = (completionError instanceof Error ? completionError : undefined) ??
                    (job.lastError instanceof Error ? job.lastError : undefined) ??
                    new Error("Execution failed");
                throw errorToThrow;
            }
            await this.queue.commit(reservation.reservationId);
            release({ success: true });
        }
        catch (error) {
            // Immediately release the client on any failure
            release({ success: false });
            const latestStatus = this.jobStore.get(job.jobId)?.status;
            if (latestStatus === "cancelled") {
                return;
            }
            job.lastError = error;
            job.status = "failed";
            const remainingAttempts = job.options.maxAttempts - job.attempts;
            const failureAnalysis = analyzeWorkflowFailure(error);
            this.rememberJobFailure(job, clientId, failureAnalysis);
            if (failureAnalysis.blockClient === "permanent") {
                this.addPermanentExclusion(job, clientId);
                reservation.payload.options.excludeClientIds = [...(job.options.excludeClientIds ?? [])];
            }
            this.clientManager.recordFailure(clientId, job, error);
            const hasRetryPath = this.hasRetryPath(job);
            const willRetry = failureAnalysis.retryable && remainingAttempts > 0 && hasRetryPath;
            this.dispatchEvent(new CustomEvent("job:failed", {
                detail: { job, willRetry }
            }));
            if (willRetry) {
                const delay = this.opts.retryBackoffMs ?? job.options.retryDelayMs;
                this.dispatchEvent(new CustomEvent("job:retrying", { detail: { job, delayMs: delay } }));
                job.status = "queued";
                job.clientId = undefined;
                job.promptId = undefined;
                job.startedAt = undefined;
                job.completedAt = undefined;
                job.result = undefined;
                reservation.payload.options.excludeClientIds = [...(job.options.excludeClientIds ?? [])];
                await this.queue.retry(reservation.reservationId, { delayMs: delay });
                this.dispatchEvent(new CustomEvent("job:queued", { detail: { job } }));
                this.scheduleProcess(delay);
            }
            else {
                job.completedAt = Date.now();
                const finalError = !hasRetryPath && failureAnalysis.type === "client_incompatible" && this.jobFailureAnalysis.has(job.jobId)
                    ? this.createWorkflowNotSupportedError(job, error)
                    : error;
                job.lastError = finalError;
                await this.queue.discard(reservation.reservationId, finalError);
                this.clearJobFailures(job.jobId);
            }
        }
        finally {
            this.activeJobs.delete(job.jobId);
            void this.processQueue();
        }
    }
}
//# sourceMappingURL=WorkflowPool.js.map