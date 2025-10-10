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
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY = 1000;
export class WorkflowPool extends TypedEventTarget {
    queue;
    strategy;
    clientManager;
    opts;
    jobStore = new Map();
    initPromise;
    processing = false;
    activeJobs = new Map();
    constructor(clients, opts) {
        super();
        this.strategy = opts?.failoverStrategy ?? new SmartFailoverStrategy();
        this.queue = opts?.queueAdapter ?? new MemoryQueueAdapter();
        this.clientManager = new ClientManager(this.strategy);
        this.opts = opts ?? {};
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
    async enqueue(workflowInput, options) {
        await this.ready();
        const workflowJson = this.normalizeWorkflow(workflowInput);
        const workflowHash = hashWorkflow(workflowJson);
        const jobId = options?.jobId ?? this.generateJobId();
        const payload = {
            jobId,
            workflow: workflowJson,
            workflowHash,
            attempts: 0,
            enqueuedAt: Date.now(),
            options: {
                maxAttempts: options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
                retryDelayMs: options?.retryDelayMs ?? DEFAULT_RETRY_DELAY,
                priority: options?.priority ?? 0,
                preferredClientIds: options?.preferredClientIds ?? [],
                excludeClientIds: options?.excludeClientIds ?? [],
                metadata: options?.metadata ?? {},
                includeOutputs: options?.includeOutputs ?? []
            }
        };
        const record = {
            ...payload,
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
                this.dispatchEvent(new CustomEvent("job:cancelled", { detail: { job: record } }));
                return true;
            }
        }
        const active = this.activeJobs.get(jobId);
        if (active?.cancel) {
            await active.cancel();
            record.status = "cancelled";
            record.completedAt = Date.now();
            this.dispatchEvent(new CustomEvent("job:cancelled", { detail: { job: record } }));
            return true;
        }
        return false;
    }
    async shutdown() {
        await this.queue.shutdown();
        for (const [, ctx] of this.activeJobs) {
            ctx.release({ success: false });
        }
        this.activeJobs.clear();
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
        return (globalThis.crypto && "randomUUID" in globalThis.crypto)
            ? globalThis.crypto.randomUUID()
            : `job_${Math.random().toString(36).slice(2, 10)}`;
    }
    scheduleProcess(delayMs) {
        const wait = Math.max(delayMs, 10);
        setTimeout(() => {
            void this.processQueue();
        }, wait);
    }
    async processQueue() {
        if (this.processing) {
            return;
        }
        this.processing = true;
        try {
            while (true) {
                const reservation = await this.queue.reserve();
                if (!reservation) {
                    break;
                }
                const job = this.jobStore.get(reservation.payload.jobId);
                if (!job) {
                    await this.queue.commit(reservation.reservationId);
                    continue;
                }
                const lease = this.clientManager.claim(job);
                if (!lease) {
                    await this.queue.retry(reservation.reservationId, { delayMs: job.options.retryDelayMs });
                    this.scheduleProcess(job.options.retryDelayMs);
                    break;
                }
                this.runJob({ reservation, job, clientId: lease.clientId, release: lease.release }).catch((error) => {
                    console.error("[WorkflowPool] Unhandled job error", error);
                });
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
        this.dispatchEvent(new CustomEvent("job:started", { detail: { job } }));
        let wfInstance = Workflow.from(cloneDeep(reservation.payload.workflow));
        if (job.options.includeOutputs?.length) {
            for (const nodeId of job.options.includeOutputs) {
                if (nodeId) {
                    wfInstance = wfInstance.output(nodeId);
                }
            }
        }
        wfInstance.inferDefaultOutputs?.();
        const promptBuilder = new PromptBuilder(wfInstance.json, wfInstance.inputPaths ?? [], wfInstance.outputNodeIds ?? []);
        const wrapper = new CallWrapper(client, promptBuilder);
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
        let rejectCompletion;
        const completionPromise = new Promise((resolve, reject) => {
            resolveCompletion = resolve;
            rejectCompletion = reject;
        });
        wrapper.onProgress((progress, promptId) => {
            if (!job.promptId && promptId) {
                job.promptId = promptId;
            }
            this.dispatchEvent(new CustomEvent("job:progress", {
                detail: { jobId: job.jobId, clientId, progress }
            }));
        });
        wrapper.onPreview((blob, promptId) => {
            if (!job.promptId && promptId) {
                job.promptId = promptId;
            }
            this.dispatchEvent(new CustomEvent("job:preview", {
                detail: { jobId: job.jobId, clientId, blob }
            }));
        });
        wrapper.onPreviewMeta((payload, promptId) => {
            if (!job.promptId && promptId) {
                job.promptId = promptId;
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
            job.result = data;
            job.completedAt = Date.now();
            this.dispatchEvent(new CustomEvent("job:completed", { detail: { job } }));
            resolveCompletion?.();
        });
        wrapper.onFailed((error, promptId) => {
            if (!job.promptId && promptId) {
                job.promptId = promptId;
            }
            job.lastError = error;
            rejectPending?.(error);
            rejectCompletion?.(error);
        });
        try {
            const exec = wrapper.run();
            await pendingPromise;
            this.activeJobs.set(job.jobId, {
                reservation,
                job,
                clientId,
                release,
                cancel: async () => {
                    try {
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
            await exec;
            await completionPromise;
            await this.queue.commit(reservation.reservationId);
            release({ success: true });
        }
        catch (error) {
            const latestStatus = this.jobStore.get(job.jobId)?.status;
            if (latestStatus === "cancelled") {
                release({ success: false });
                return;
            }
            job.lastError = error;
            job.status = "failed";
            this.clientManager.recordFailure(clientId, job, error);
            const remainingAttempts = job.options.maxAttempts - job.attempts;
            const willRetry = remainingAttempts > 0;
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
                await this.queue.retry(reservation.reservationId, { delayMs: delay });
                this.dispatchEvent(new CustomEvent("job:queued", { detail: { job } }));
                this.scheduleProcess(delay);
                release({ success: false });
            }
            else {
                job.completedAt = Date.now();
                await this.queue.discard(reservation.reservationId, error);
                release({ success: false });
            }
        }
        finally {
            this.activeJobs.delete(job.jobId);
            void this.processQueue();
        }
    }
}
//# sourceMappingURL=WorkflowPool.js.map