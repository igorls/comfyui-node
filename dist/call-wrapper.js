import { FailedCacheError, WentMissingError, EnqueueFailedError, DisconnectedError, CustomEventError, ExecutionFailedError, ExecutionInterruptedError, MissingNodeError } from "./types/error.js";
import { buildEnqueueFailedError } from "./utils/response-error.js";
const DISCONNECT_FAILURE_GRACE_MS = 5000;
const CALL_WRAPPER_DEBUG = process.env.WORKFLOW_POOL_DEBUG === "1";
/**
 * Represents a wrapper class for making API calls using the ComfyApi client.
 * Provides methods for setting callback functions and executing the job.
 */
export class CallWrapper {
    client;
    prompt;
    started = false;
    isCompletingSuccessfully = false;
    promptId;
    output = {};
    onPreviewFn;
    onPreviewMetaFn;
    onPendingFn;
    onStartFn;
    onOutputFn;
    onFinishedFn;
    onFailedFn;
    onProgressFn;
    jobResolveFn;
    jobDoneResolved = false;
    pendingCompletion = null;
    cancellationRequested = false;
    promptLoadTrigger = null;
    disconnectRecoveryActive = false;
    disconnectFailureTimer = null;
    onReconnectHandlerOffFn;
    onReconnectFailedHandlerOffFn;
    onDisconnectedHandlerOffFn;
    checkExecutingOffFn;
    checkExecutedOffFn;
    progressHandlerOffFn;
    previewHandlerOffFn;
    executionHandlerOffFn;
    errorHandlerOffFn;
    executionEndSuccessOffFn;
    statusHandlerOffFn;
    interruptionHandlerOffFn;
    /**
     * Constructs a new CallWrapper instance.
     * @param client The ComfyApi client.
     * @param workflow The workflow object.
     */
    constructor(client, workflow) {
        this.client = client;
        this.prompt = workflow;
        return this;
    }
    /**
     * Set the callback function to be called when a preview event occurs.
     *
     * @param fn - The callback function to be called. It receives a Blob object representing the event and an optional promptId string.
     * @returns The current instance of the CallWrapper.
     */
    onPreview(fn) {
        this.onPreviewFn = fn;
        return this;
    }
    /**
     * Set the callback function to be called when a preview-with-metadata event occurs.
     */
    onPreviewMeta(fn) {
        this.onPreviewMetaFn = fn;
        return this;
    }
    /**
     * Set a callback function to be executed when the job is queued.
     * @param {Function} fn - The callback function to be executed.
     * @returns The current instance of the CallWrapper.
     */
    onPending(fn) {
        this.onPendingFn = fn;
        return this;
    }
    /**
     * Set the callback function to be executed when the job start.
     *
     * @param fn - The callback function to be executed. It can optionally receive a `promptId` parameter.
     * @returns The current instance of the CallWrapper.
     */
    onStart(fn) {
        this.onStartFn = fn;
        return this;
    }
    /**
     * Sets the callback function to handle the output node when the workflow is executing. This is
     * useful when you want to handle the output of each nodes as they are being processed.
     *
     * All the nodes defined in the `mapOutputKeys` will be passed to this function when node is executed.
     *
     * @param fn - The callback function to handle the output.
     * @returns The current instance of the class.
     */
    onOutput(fn) {
        this.onOutputFn = fn;
        return this;
    }
    /**
     * Set the callback function to be executed when the asynchronous operation is finished.
     *
     * @param fn - The callback function to be executed. It receives the data returned by the operation
     *             and an optional promptId parameter.
     * @returns The current instance of the CallWrapper.
     */
    onFinished(fn) {
        this.onFinishedFn = fn;
        return this;
    }
    /**
     * Set the callback function to be executed when the API call fails.
     *
     * @param fn - The callback function to be executed when the API call fails.
     *             It receives an `Error` object as the first parameter and an optional `promptId` as the second parameter.
     * @returns The current instance of the CallWrapper.
     */
    onFailed(fn) {
        this.onFailedFn = fn;
        return this;
    }
    /**
     * Set a callback function to be called when progress information is available.
     * @param fn - The callback function to be called with the progress information.
     * @returns The current instance of the CallWrapper.
     */
    onProgress(fn) {
        this.onProgressFn = fn;
        return this;
    }
    /**
     * Run the call wrapper and returns the output of the executed job.
     * If the job is already cached, it returns the cached output.
     * If the job is not cached, it executes the job and returns the output.
     *
     * @returns A promise that resolves to the output of the executed job,
     *          or `undefined` if the job is not found,
     *          or `false` if the job execution fails.
     */
    async run() {
        /**
         * Start the job execution.
         */
        this.emitLog("CallWrapper.run", "enqueue start");
        this.pendingCompletion = null;
        this.jobResolveFn = undefined;
        this.jobDoneResolved = false;
        this.cancellationRequested = false;
        this.promptLoadTrigger = null;
        const job = await this.enqueueJob();
        if (!job) {
            // enqueueJob already invoked onFailed with a rich error instance; just abort.
            this.emitLog("CallWrapper.run", "enqueue failed -> abort");
            return false;
        }
        const promptLoadCached = new Promise((resolve) => {
            this.promptLoadTrigger = (value) => {
                if (this.promptLoadTrigger) {
                    this.promptLoadTrigger = null;
                }
                resolve(value);
            };
        });
        const jobDonePromise = new Promise((resolve) => {
            this.jobDoneResolved = false;
            this.jobResolveFn = (value) => {
                resolve(value);
            };
            if (this.pendingCompletion !== null) {
                const pending = this.pendingCompletion;
                this.pendingCompletion = null;
                this.jobResolveFn?.(pending);
            }
        });
        /**
         * Declare the function to check if the job is executing.
         */
        const checkExecutingFn = (event) => {
            // Defensive null check for event detail
            if (!event.detail) {
                this.emitLog("CallWrapper.run", "executing event received with no detail");
                return;
            }
            if (event.detail.prompt_id === job.prompt_id) {
                this.emitLog("CallWrapper.run", "executing observed", { node: event.detail.node });
                this.resolvePromptLoad(false);
            }
        };
        /**
         * Declare the function to check if the job is cached.
         */
        const checkExecutionCachedFn = (event) => {
            // Defensive null checks for event detail
            if (!event.detail || !event.detail.nodes) {
                this.emitLog("CallWrapper.run", "execution_cached event received with invalid structure");
                return;
            }
            const outputNodes = Object.values(this.prompt.mapOutputKeys).filter((n) => !!n);
            if (event.detail.nodes.length > 0 && event.detail.prompt_id === job.prompt_id) {
                /**
                 * Cached is true if all output nodes are included in the cached nodes.
                 */
                const cached = outputNodes.every((node) => event.detail.nodes.includes(node));
                this.emitLog("CallWrapper.run", "execution_cached observed", {
                    cached,
                    nodes: event.detail.nodes,
                    expected: outputNodes
                });
                this.resolvePromptLoad(cached);
            }
        };
        /**
         * Listen to the executing event.
         */
        this.checkExecutingOffFn = this.client.on("executing", checkExecutingFn);
        this.checkExecutedOffFn = this.client.on("execution_cached", checkExecutionCachedFn);
        // race condition handling
        let wentMissing = false;
        let cachedOutputDone = false;
        let cachedOutputPromise = Promise.resolve(null);
        const statusHandler = async () => {
            const queue = await this.client.getQueue();
            const queueItems = [...queue.queue_pending, ...queue.queue_running];
            this.emitLog("CallWrapper.status", "queue snapshot", {
                running: queue.queue_running.length,
                pending: queue.queue_pending.length
            });
            for (const queueItem of queueItems) {
                if (queueItem[1] === job.prompt_id) {
                    return;
                }
            }
            await cachedOutputPromise;
            if (cachedOutputDone) {
                this.emitLog("CallWrapper.status", "cached output already handled");
                return;
            }
            if (this.cancellationRequested) {
                this.emitLog("CallWrapper.status", "job missing after cancellation", {
                    prompt_id: job.prompt_id
                });
                this.resolvePromptLoad(false);
                this.resolveJob(false);
                this.cleanupListeners("status handler cancellation");
                return;
            }
            wentMissing = true;
            const output = await this.handleCachedOutput(job.prompt_id);
            if (output) {
                cachedOutputDone = true;
                this.emitLog("CallWrapper.status", "output from history after missing", {
                    prompt_id: job.prompt_id
                });
                this.resolvePromptLoad(false);
                this.resolveJob(output);
                this.cleanupListeners("status handler resolved from history");
                return;
            }
            if (this.disconnectRecoveryActive) {
                this.emitLog("CallWrapper.status", "job missing but disconnect recovery active -> waiting", {
                    prompt_id: job.prompt_id
                });
                this.resolvePromptLoad(false);
                void this.attemptHistoryCompletion("status_missing");
                return;
            }
            cachedOutputDone = true;
            this.emitLog("CallWrapper.status", "job missing without cached output", {
                prompt_id: job.prompt_id
            });
            this.resolvePromptLoad(false);
            this.resolveJob(false);
            this.cleanupListeners("status handler missing");
            this.emitFailure(new WentMissingError("The job went missing!"), job.prompt_id);
        };
        this.statusHandlerOffFn = this.client.on("status", statusHandler);
        // Attach execution listeners immediately so fast jobs cannot finish before we subscribe
        this.handleJobExecution(job.prompt_id);
        await promptLoadCached;
        if (wentMissing) {
            return jobDonePromise;
        }
        cachedOutputPromise = this.handleCachedOutput(job.prompt_id);
        const output = await cachedOutputPromise;
        if (output) {
            cachedOutputDone = true;
            this.cleanupListeners("no cached output values returned");
            this.resolveJob(output);
            return output;
        }
        if (output === false) {
            cachedOutputDone = true;
            this.cleanupListeners("cached output ready before execution listeners");
            this.emitFailure(new FailedCacheError("Failed to get cached output"), this.promptId);
            this.resolveJob(false);
            return false;
        }
        this.emitLog("CallWrapper.run", "no cached output -> proceed with execution listeners");
        return jobDonePromise;
    }
    async bypassWorkflowNodes(workflow) {
        const nodeDefs = {}; // cache node definitions
        for (const nodeId of this.prompt.bypassNodes) {
            if (!workflow[nodeId]) {
                throw new MissingNodeError(`Node ${nodeId.toString()} is missing from the workflow!`);
            }
            const classType = workflow[nodeId].class_type;
            // Directly use feature namespace to avoid deprecated internal call
            const def = nodeDefs[classType] || (await this.client.ext.node.getNodeDefs(classType))?.[classType];
            if (!def) {
                throw new MissingNodeError(`Node type ${workflow[nodeId].class_type} is missing from server!`);
            }
            nodeDefs[classType] = def;
            const connections = new Map();
            const connectedInputs = [];
            // connect output nodes to matching input nodes
            for (const [outputIdx, outputType] of Array.from(def.output.entries())) {
                for (const [inputName, inputValue] of Object.entries(workflow[nodeId].inputs)) {
                    if (connectedInputs.includes(inputName)) {
                        continue;
                    }
                    if (def.input.required[inputName]?.[0] === outputType) {
                        connections.set(outputIdx, inputValue);
                        connectedInputs.push(inputName);
                        break;
                    }
                    if (def.input.optional?.[inputName]?.[0] === outputType) {
                        connections.set(outputIdx, inputValue);
                        connectedInputs.push(inputName);
                        break;
                    }
                }
            }
            // search and replace all nodes' inputs referencing this node based on matching output type, or remove reference
            // if no matching output type was found
            for (const [conNodeId, conNode] of Object.entries(workflow)) {
                for (const [conInputName, conInputValue] of Object.entries(conNode.inputs)) {
                    if (!Array.isArray(conInputValue) || conInputValue[0] !== nodeId) {
                        continue;
                    }
                    if (connections.has(conInputValue[1])) {
                        workflow[conNodeId].inputs[conInputName] = connections.get(conInputValue[1]);
                    }
                    else {
                        delete workflow[conNodeId].inputs[conInputName];
                    }
                }
            }
            delete workflow[nodeId];
        }
        return workflow;
    }
    async enqueueJob() {
        let workflow = structuredClone(this.prompt.workflow);
        if (this.prompt.bypassNodes.length > 0) {
            try {
                workflow = await this.bypassWorkflowNodes(workflow);
            }
            catch (e) {
                if (e instanceof Response) {
                    this.emitFailure(new MissingNodeError("Failed to get workflow node definitions", { cause: await e.json() }), this.promptId);
                }
                else {
                    this.emitFailure(new MissingNodeError("There was a missing node in the workflow bypass.", { cause: e }), this.promptId);
                }
                return null;
            }
        }
        let job;
        try {
            job = await this.client.ext.queue.appendPrompt(workflow);
        }
        catch (e) {
            try {
                if (e instanceof EnqueueFailedError) {
                    this.emitFailure(e, this.promptId);
                }
                else if (e instanceof Response) {
                    const err = await buildEnqueueFailedError(e);
                    this.emitFailure(err, this.promptId);
                }
                else if (e && typeof e === "object" && "response" in e && e.response instanceof Response) {
                    const err = await buildEnqueueFailedError(e.response);
                    this.emitFailure(err, this.promptId);
                }
                else {
                    this.emitFailure(new EnqueueFailedError("Failed to queue prompt", { cause: e, reason: e?.message }), this.promptId);
                }
            }
            catch (inner) {
                this.emitFailure(new EnqueueFailedError("Failed to queue prompt", { cause: inner }), this.promptId);
            }
            job = null;
        }
        if (!job) {
            return;
        }
        this.promptId = job.prompt_id;
        console.log(`[CallWrapper] Enqueued with promptId=${this.promptId?.substring(0, 8)}...`);
        console.log(`[CallWrapper] Full job object:`, JSON.stringify({ promptId: job.prompt_id }, null, 2));
        this.emitLog("CallWrapper.enqueueJob", "queued", { prompt_id: this.promptId });
        this.onPendingFn?.(this.promptId);
        this.onDisconnectedHandlerOffFn = this.client.on("disconnected", () => {
            if (this.isCompletingSuccessfully) {
                this.emitLog("CallWrapper.enqueueJob", "disconnected during success completion -> ignored");
                return;
            }
            this.emitLog("CallWrapper.enqueueJob", "socket disconnected -> enter recovery", { promptId: this.promptId });
            this.startDisconnectRecovery();
        });
        this.onReconnectHandlerOffFn = this.client.on("reconnected", () => {
            if (!this.disconnectRecoveryActive) {
                return;
            }
            this.emitLog("CallWrapper.enqueueJob", "socket reconnected", { promptId: this.promptId });
            this.stopDisconnectRecovery();
            void this.attemptHistoryCompletion("reconnected");
        });
        this.onReconnectFailedHandlerOffFn = this.client.on("reconnection_failed", () => {
            if (!this.disconnectRecoveryActive) {
                return;
            }
            this.emitLog("CallWrapper.enqueueJob", "reconnection failed", { promptId: this.promptId });
            this.failDisconnected("reconnection_failed");
        });
        return job;
    }
    resolvePromptLoad(value) {
        const trigger = this.promptLoadTrigger;
        if (!trigger) {
            return;
        }
        this.promptLoadTrigger = null;
        try {
            trigger(value);
        }
        catch (error) {
            this.emitLog("CallWrapper.resolvePromptLoad", "prompt load trigger threw", {
                error: error instanceof Error ? error.message : String(error),
                promptId: this.promptId
            });
        }
    }
    resolveJob(value) {
        if (CALL_WRAPPER_DEBUG) {
            console.log("[debug] resolveJob", this.promptId, value, Boolean(this.jobResolveFn), this.jobDoneResolved);
        }
        if (this.jobResolveFn && !this.jobDoneResolved) {
            this.jobDoneResolved = true;
            this.jobResolveFn(value);
            if (CALL_WRAPPER_DEBUG) {
                console.log("[debug] jobResolveFn invoked", this.promptId);
            }
        }
        else if (!this.jobResolveFn) {
            this.pendingCompletion = value;
        }
    }
    emitFailure(error, promptId) {
        const fn = this.onFailedFn;
        if (!fn) {
            return;
        }
        const targetPromptId = promptId ?? this.promptId;
        try {
            if (CALL_WRAPPER_DEBUG) {
                console.log("[debug] emitFailure start", error.name);
            }
            fn(error, targetPromptId);
            if (CALL_WRAPPER_DEBUG) {
                console.log("[debug] emitFailure end", error.name);
            }
        }
        catch (callbackError) {
            this.emitLog("CallWrapper.emitFailure", "onFailed callback threw", {
                prompt_id: targetPromptId,
                error: callbackError instanceof Error ? callbackError.message : String(callbackError)
            });
        }
    }
    cancel(reason = "cancelled") {
        if (this.cancellationRequested) {
            this.emitLog("CallWrapper.cancel", "cancel already requested", {
                promptId: this.promptId,
                reason
            });
            return;
        }
        this.cancellationRequested = true;
        this.emitLog("CallWrapper.cancel", "cancel requested", {
            promptId: this.promptId,
            reason
        });
        this.resolvePromptLoad(false);
        this.emitFailure(new ExecutionInterruptedError("The execution was interrupted!", { cause: { reason } }), this.promptId);
        this.cleanupListeners("cancel requested");
        this.resolveJob(false);
    }
    startDisconnectRecovery() {
        if (this.disconnectRecoveryActive || this.cancellationRequested) {
            return;
        }
        this.disconnectRecoveryActive = true;
        if (this.disconnectFailureTimer) {
            clearTimeout(this.disconnectFailureTimer);
        }
        this.disconnectFailureTimer = setTimeout(() => this.failDisconnected("timeout"), DISCONNECT_FAILURE_GRACE_MS);
        void this.attemptHistoryCompletion("disconnect_start");
    }
    stopDisconnectRecovery() {
        if (!this.disconnectRecoveryActive) {
            return;
        }
        this.disconnectRecoveryActive = false;
        if (this.disconnectFailureTimer) {
            clearTimeout(this.disconnectFailureTimer);
            this.disconnectFailureTimer = null;
        }
    }
    async attemptHistoryCompletion(reason) {
        if (!this.promptId || this.cancellationRequested) {
            return false;
        }
        try {
            const output = await this.handleCachedOutput(this.promptId);
            if (output && output !== false) {
                this.emitLog("CallWrapper.historyRecovery", "completed from history", { reason, promptId: this.promptId });
                this.stopDisconnectRecovery();
                this.isCompletingSuccessfully = true;
                this.resolvePromptLoad(false);
                this.resolveJob(output);
                this.cleanupListeners(`history recovery (${reason})`);
                return true;
            }
        }
        catch (error) {
            this.emitLog("CallWrapper.historyRecovery", "history fetch failed", { reason, error: String(error) });
        }
        return false;
    }
    failDisconnected(reason) {
        if (!this.disconnectRecoveryActive || this.isCompletingSuccessfully) {
            return;
        }
        this.stopDisconnectRecovery();
        this.emitLog("CallWrapper.enqueueJob", "disconnect recovery failed", { reason, promptId: this.promptId });
        this.resolvePromptLoad(false);
        this.resolveJob(false);
        this.cleanupListeners("disconnect failure");
        this.emitFailure(new DisconnectedError("Disconnected"), this.promptId);
    }
    async handleCachedOutput(promptId) {
        const hisData = await this.client.ext.history.getHistory(promptId);
        this.emitLog("CallWrapper.handleCachedOutput", "history fetched", {
            promptId,
            status: hisData?.status?.status_str,
            completed: hisData?.status?.completed,
            outputKeys: hisData?.outputs ? Object.keys(hisData.outputs) : [],
            hasOutputs: !!(hisData && hisData.outputs && Object.keys(hisData.outputs).length > 0)
        });
        // Only return outputs if execution is actually completed
        if (hisData && hisData.status?.completed && hisData.outputs) {
            const output = this.mapOutput(hisData.outputs);
            const hasDefinedValue = Object.entries(output).some(([key, value]) => {
                if (key === "_raw") {
                    return value !== undefined && value !== null && Object.keys(value).length > 0;
                }
                return value !== undefined;
            });
            if (hasDefinedValue) {
                this.emitLog("CallWrapper.handleCachedOutput", "returning completed outputs");
                this.onFinishedFn?.(output, this.promptId);
                return output;
            }
            else {
                this.emitLog("CallWrapper.handleCachedOutput", "cached output missing defined values", {
                    promptId,
                    outputKeys: Object.keys(hisData.outputs ?? {}),
                    mappedKeys: this.prompt.mapOutputKeys
                });
                return false;
            }
        }
        if (hisData && hisData.status?.completed && !hisData.outputs) {
            this.emitLog("CallWrapper.handleCachedOutput", "history completed without outputs", { promptId });
            return false;
        }
        if (hisData && !hisData.status?.completed) {
            this.emitLog("CallWrapper.handleCachedOutput", "history not completed yet");
        }
        if (!hisData) {
            this.emitLog("CallWrapper.handleCachedOutput", "history entry not available");
        }
        return null;
    }
    mapOutput(outputNodes) {
        const outputMapped = this.prompt.mapOutputKeys;
        const output = {};
        for (const key in outputMapped) {
            const node = outputMapped[key];
            if (node) {
                output[key] = outputNodes[node];
            }
            else {
                if (!output._raw) {
                    output._raw = {};
                }
                output._raw[key] = outputNodes[key];
            }
        }
        return output;
    }
    handleJobExecution(promptId) {
        if (this.executionHandlerOffFn) {
            return;
        }
        const reverseOutputMapped = this.reverseMapOutputKeys();
        const mapOutputKeys = this.prompt.mapOutputKeys;
        console.log(`[CallWrapper] handleJobExecution for ${promptId.substring(0, 8)}... - mapOutputKeys:`, mapOutputKeys, "reverseOutputMapped:", reverseOutputMapped);
        this.progressHandlerOffFn = this.client.on("progress", (ev) => this.handleProgress(ev, promptId));
        this.previewHandlerOffFn = this.client.on("b_preview", (ev) => {
            // Note: b_preview events don't include prompt_id. They're scoped per connection.
            // If multiple jobs use the same connection, they will all receive preview events.
            // This is a limitation of the ComfyUI protocol - previews are not separated by prompt_id.
            this.onPreviewFn?.(ev.detail, this.promptId);
        });
        // Also forward preview with metadata if available
        const offPreviewMeta = this.client.on("b_preview_meta", (ev) => {
            // Validate prompt_id from metadata if available to prevent cross-user preview leakage
            const metadata = ev.detail.metadata;
            const metaPromptId = metadata?.prompt_id;
            if (metaPromptId && metaPromptId !== promptId) {
                console.log(`[CallWrapper] Ignoring b_preview_meta for wrong prompt. Expected ${promptId.substring(0, 8)}..., got ${metaPromptId.substring(0, 8)}...`);
                return;
            }
            this.onPreviewMetaFn?.(ev.detail, this.promptId);
        });
        const prevCleanup = this.previewHandlerOffFn;
        this.previewHandlerOffFn = () => {
            prevCleanup?.();
            offPreviewMeta?.();
        };
        const totalOutput = Object.keys(reverseOutputMapped).length;
        let remainingOutput = totalOutput;
        console.log(`[CallWrapper] totalOutput=${totalOutput}, remainingOutput=${remainingOutput}`);
        const executionHandler = (ev) => {
            console.log(`[CallWrapper.executionHandler] received executed event for promptId=${ev.detail.prompt_id?.substring(0, 8)}..., node=${ev.detail.node}, waitingFor=${promptId.substring(0, 8)}...`);
            const eventPromptId = ev.detail.prompt_id;
            const isCorrectPrompt = eventPromptId === promptId;
            // STRICT: Only accept events where prompt_id matches our expected promptId
            if (!isCorrectPrompt) {
                console.log(`[CallWrapper.executionHandler] REJECTED - prompt_id mismatch (expected ${promptId.substring(0, 8)}..., got ${eventPromptId?.substring(0, 8)}...)`);
                return;
            }
            const outputKey = reverseOutputMapped[ev.detail.node];
            console.log(`[CallWrapper] executionHandler - promptId: ${promptId.substring(0, 8)}... (event says: ${ev.detail.prompt_id?.substring(0, 8)}...), node: ${ev.detail.node}, outputKey: ${outputKey}, output:`, JSON.stringify(ev.detail.output));
            if (outputKey) {
                this.output[outputKey] = ev.detail.output;
                this.onOutputFn?.(outputKey, ev.detail.output, this.promptId);
                remainingOutput--;
            }
            else {
                this.output._raw = this.output._raw || {};
                this.output._raw[ev.detail.node] = ev.detail.output;
                this.onOutputFn?.(ev.detail.node, ev.detail.output, this.promptId);
            }
            console.log(`[CallWrapper] afterProcessing - remainingAfter: ${remainingOutput}, willTriggerCompletion: ${remainingOutput === 0}`);
            if (remainingOutput === 0) {
                console.log(`[CallWrapper] all outputs collected for ${promptId.substring(0, 8)}...`);
                // Mark as successfully completing BEFORE cleanup to prevent race condition with disconnection handler
                this.isCompletingSuccessfully = true;
                this.cleanupListeners("all outputs collected");
                this.onFinishedFn?.(this.output, this.promptId);
                this.resolveJob(this.output);
            }
        };
        const executedEnd = async () => {
            console.log(`[CallWrapper] execution_success fired for ${promptId.substring(0, 8)}..., remainingOutput=${remainingOutput}, totalOutput=${totalOutput}`);
            // If we've already marked this as successfully completing, don't fail it again
            if (this.isCompletingSuccessfully) {
                console.log(`[CallWrapper] Already marked as successfully completing, ignoring this execution_success`);
                return;
            }
            if (remainingOutput === 0) {
                console.log(`[CallWrapper] all outputs already collected, nothing to do`);
                return;
            }
            // Wait briefly for outputs that might be arriving due to prompt ID mismatch
            await new Promise((resolve) => setTimeout(resolve, 100));
            console.log(`[CallWrapper] After wait - remainingOutput=${remainingOutput}, this.output keys:`, Object.keys(this.output));
            // Check if outputs arrived while we were waiting
            if (remainingOutput === 0) {
                console.log(`[CallWrapper] Outputs arrived during wait - marking as complete`);
                this.isCompletingSuccessfully = true;
                this.cleanupListeners("executedEnd - outputs complete after wait");
                this.onFinishedFn?.(this.output, this.promptId);
                this.resolveJob(this.output);
                return;
            }
            // Check if we have collected all outputs (even if prompt ID mismatch)
            const hasAllOutputs = Object.keys(reverseOutputMapped).every((nodeId) => this.output[reverseOutputMapped[nodeId]] !== undefined);
            if (hasAllOutputs) {
                console.log(`[CallWrapper] Have all required outputs despite promptId mismatch - marking as complete`);
                this.isCompletingSuccessfully = true;
                this.cleanupListeners("executedEnd - outputs complete despite promptId mismatch");
                this.onFinishedFn?.(this.output, this.promptId);
                this.resolveJob(this.output);
                return;
            }
            // Try to fetch from history with retry logic
            let hisData = null;
            for (let retries = 0; retries < 5; retries++) {
                hisData = await this.client.ext.history.getHistory(promptId);
                console.log(`[CallWrapper] History query result for ${promptId.substring(0, 8)}... (attempt ${retries + 1}) - status:`, hisData?.status, "outputs:", Object.keys(hisData?.outputs ?? {}).length);
                if (hisData?.status?.completed && hisData.outputs) {
                    console.log(`[CallWrapper] Found completed job in history with outputs - attempting to populate from history`);
                    break;
                }
                if (retries < 4) {
                    console.log(`[CallWrapper] History not ready yet, waiting 100ms before retry...`);
                    await new Promise((resolve) => setTimeout(resolve, 100));
                }
            }
            if (hisData?.status?.completed && hisData.outputs) {
                // Try to extract outputs from history data
                let populatedCount = 0;
                for (const [nodeIdStr, nodeOutput] of Object.entries(hisData.outputs)) {
                    const nodeId = parseInt(nodeIdStr, 10);
                    const outputKey = reverseOutputMapped[nodeId];
                    if (outputKey && nodeOutput) {
                        // nodeOutput is typically { images: [...] } or similar - take the first property
                        const outputValue = Array.isArray(nodeOutput) ? nodeOutput[0] : Object.values(nodeOutput)[0];
                        if (outputValue !== undefined) {
                            this.output[outputKey] = outputValue;
                            this.onOutputFn?.(outputKey, outputValue, this.promptId);
                            populatedCount++;
                            remainingOutput--;
                            console.log(`[CallWrapper] Populated ${outputKey} from history`);
                        }
                    }
                }
                if (remainingOutput === 0) {
                    console.log(`[CallWrapper] Successfully populated all outputs from history for ${promptId.substring(0, 8)}...`);
                    this.isCompletingSuccessfully = true;
                    this.cleanupListeners("executedEnd - populated from history");
                    this.onFinishedFn?.(this.output, this.promptId);
                    this.resolveJob(this.output);
                    return;
                }
                if (populatedCount > 0) {
                    console.log(`[CallWrapper] Populated ${populatedCount} outputs from history (remainingOutput=${remainingOutput})`);
                    if (remainingOutput === 0) {
                        this.isCompletingSuccessfully = true;
                        this.cleanupListeners("executedEnd - all outputs from history");
                        this.onFinishedFn?.(this.output, this.promptId);
                        this.resolveJob(this.output);
                        return;
                    }
                }
            }
            console.log(`[CallWrapper] execution failed due to missing outputs - remainingOutput=${remainingOutput}, totalOutput=${totalOutput}`);
            this.emitFailure(new ExecutionFailedError("Execution failed"), this.promptId);
            this.resolvePromptLoad(false);
            this.cleanupListeners("executedEnd missing outputs");
            this.resolveJob(false);
        };
        this.executionEndSuccessOffFn = this.client.on("execution_success", executedEnd);
        this.executionHandlerOffFn = this.client.on("executed", executionHandler);
        console.log(`[CallWrapper] Registered listeners for ${promptId.substring(0, 8)}... - executionHandler and executedEnd`);
        this.errorHandlerOffFn = this.client.on("execution_error", (ev) => this.handleError(ev, promptId));
        this.interruptionHandlerOffFn = this.client.on("execution_interrupted", (ev) => {
            if (ev.detail.prompt_id !== promptId)
                return;
            this.emitFailure(new ExecutionInterruptedError("The execution was interrupted!", { cause: ev.detail }), ev.detail.prompt_id);
            this.resolvePromptLoad(false);
            this.cleanupListeners("execution interrupted");
            this.resolveJob(false);
        });
    }
    reverseMapOutputKeys() {
        const outputMapped = this.prompt.mapOutputKeys;
        return Object.entries(outputMapped).reduce((acc, [k, v]) => {
            if (v)
                acc[v] = k;
            return acc;
        }, {});
    }
    handleProgress(ev, promptId) {
        if (ev.detail.prompt_id === promptId && !this.started) {
            this.started = true;
            this.onStartFn?.(this.promptId);
        }
        this.onProgressFn?.(ev.detail, this.promptId);
    }
    handleError(ev, promptId) {
        if (ev.detail.prompt_id !== promptId)
            return;
        this.emitLog("CallWrapper.handleError", ev.detail.exception_type, {
            prompt_id: ev.detail.prompt_id,
            node_id: ev.detail?.node_id
        });
        this.emitFailure(new CustomEventError(ev.detail.exception_type, { cause: ev.detail }), ev.detail.prompt_id);
        if (CALL_WRAPPER_DEBUG) {
            console.log("[debug] handleError after emitFailure");
        }
        this.resolvePromptLoad(false);
        if (CALL_WRAPPER_DEBUG) {
            console.log("[debug] handleError before cleanup");
        }
        this.cleanupListeners("execution_error received");
        if (CALL_WRAPPER_DEBUG) {
            console.log("[debug] handleError after cleanup");
        }
        this.resolveJob(false);
    }
    emitLog(fnName, message, data) {
        const detail = { fnName, message, data };
        const customEvent = new CustomEvent("log", { detail });
        const clientAny = this.client;
        if (typeof clientAny.emit === "function") {
            clientAny.emit("log", customEvent);
            return;
        }
        clientAny.dispatchEvent?.(customEvent);
    }
    cleanupListeners(reason) {
        const debugPayload = { reason, promptId: this.promptId };
        this.emitLog("CallWrapper.cleanupListeners", "removing listeners", debugPayload);
        this.resolvePromptLoad(false);
        this.stopDisconnectRecovery();
        this.onReconnectHandlerOffFn?.();
        this.onReconnectHandlerOffFn = undefined;
        this.onReconnectFailedHandlerOffFn?.();
        this.onReconnectFailedHandlerOffFn = undefined;
        this.disconnectFailureTimer = null;
        this.onDisconnectedHandlerOffFn?.();
        this.onDisconnectedHandlerOffFn = undefined;
        this.checkExecutingOffFn?.();
        this.checkExecutingOffFn = undefined;
        this.checkExecutedOffFn?.();
        this.checkExecutedOffFn = undefined;
        this.progressHandlerOffFn?.();
        this.progressHandlerOffFn = undefined;
        this.previewHandlerOffFn?.();
        this.previewHandlerOffFn = undefined;
        this.executionHandlerOffFn?.();
        this.executionHandlerOffFn = undefined;
        this.errorHandlerOffFn?.();
        this.errorHandlerOffFn = undefined;
        this.executionEndSuccessOffFn?.();
        this.executionEndSuccessOffFn = undefined;
        this.interruptionHandlerOffFn?.();
        this.interruptionHandlerOffFn = undefined;
        this.statusHandlerOffFn?.();
        this.statusHandlerOffFn = undefined;
    }
}
//# sourceMappingURL=call-wrapper.js.map