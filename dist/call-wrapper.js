import { FailedCacheError, WentMissingError, EnqueueFailedError, DisconnectedError, CustomEventError, ExecutionFailedError, ExecutionInterruptedError, MissingNodeError } from "./types/error.js";
import { buildEnqueueFailedError } from "./utils/response-error.js";
/**
 * Represents a wrapper class for making API calls using the ComfyApi client.
 * Provides methods for setting callback functions and executing the job.
 */
export class CallWrapper {
    client;
    prompt;
    started = false;
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
        this.client.dispatchEvent?.(new CustomEvent("log", { detail: { fnName: "CallWrapper.run", message: "enqueue start" } }));
        const job = await this.enqueueJob();
        if (!job) {
            // enqueueJob already invoked onFailed with a rich error instance; just abort.
            this.client.dispatchEvent?.(new CustomEvent("log", { detail: { fnName: "CallWrapper.run", message: "enqueue failed -> abort" } }));
            return false;
        }
        let promptLoadTrigger;
        const promptLoadCached = new Promise((resolve) => {
            promptLoadTrigger = resolve;
        });
        let jobDoneTrigger;
        const jobDonePromise = new Promise((resolve) => {
            jobDoneTrigger = resolve;
        });
        /**
         * Declare the function to check if the job is executing.
         */
        const checkExecutingFn = (event) => {
            if (event.detail && event.detail.prompt_id === job.prompt_id) {
                this.client.dispatchEvent?.(new CustomEvent("log", { detail: { fnName: "CallWrapper.run", message: "executing observed", data: { node: event.detail.node } } }));
                promptLoadTrigger(false);
            }
        };
        /**
         * Declare the function to check if the job is cached.
         */
        const checkExecutionCachedFn = (event) => {
            const outputNodes = Object.values(this.prompt.mapOutputKeys).filter((n) => !!n);
            if (event.detail.nodes.length > 0 && event.detail.prompt_id === job.prompt_id) {
                /**
                 * Cached is true if all output nodes are included in the cached nodes.
                 */
                const cached = outputNodes.every((node) => event.detail.nodes.includes(node));
                this.client.dispatchEvent?.(new CustomEvent("log", { detail: { fnName: "CallWrapper.run", message: "execution_cached observed", data: { cached, nodes: event.detail.nodes, expected: outputNodes } } }));
                promptLoadTrigger(cached);
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
            this.client.dispatchEvent?.(new CustomEvent("log", { detail: { fnName: "CallWrapper.status", message: "queue snapshot", data: { running: queue.queue_running.length, pending: queue.queue_pending.length } } }));
            for (const queueItem of queueItems) {
                if (queueItem[1] === job.prompt_id) {
                    return;
                }
            }
            await cachedOutputPromise;
            if (cachedOutputDone) {
                this.client.dispatchEvent?.(new CustomEvent("log", { detail: { fnName: "CallWrapper.status", message: "cached output already handled" } }));
                return;
            }
            const output = await this.handleCachedOutput(job.prompt_id);
            wentMissing = true;
            if (output) {
                this.client.dispatchEvent?.(new CustomEvent("log", { detail: { fnName: "CallWrapper.status", message: "output from history after missing", data: { prompt_id: job.prompt_id } } }));
                jobDoneTrigger(output);
                this.cleanupListeners();
                return;
            }
            this.client.dispatchEvent?.(new CustomEvent("log", { detail: { fnName: "CallWrapper.status", message: "job missing -> failure", data: { prompt_id: job.prompt_id } } }));
            promptLoadTrigger(false);
            jobDoneTrigger(false);
            this.cleanupListeners();
            this.onFailedFn?.(new WentMissingError("The job went missing!"), job.prompt_id);
        };
        this.statusHandlerOffFn = this.client.on("status", statusHandler);
        await promptLoadCached;
        if (wentMissing) {
            return jobDonePromise;
        }
        cachedOutputPromise = this.handleCachedOutput(job.prompt_id);
        const output = await cachedOutputPromise;
        if (output) {
            cachedOutputDone = true;
            this.cleanupListeners();
            jobDoneTrigger(output);
            return output;
        }
        if (output === false) {
            cachedOutputDone = true;
            this.cleanupListeners();
            this.onFailedFn?.(new FailedCacheError("Failed to get cached output"), this.promptId);
            jobDoneTrigger(false);
            return false;
        }
        this.client.dispatchEvent?.(new CustomEvent("log", { detail: { fnName: "CallWrapper.run", message: "no cached output -> proceed with execution listeners" } }));
        this.handleJobExecution(job.prompt_id, jobDoneTrigger);
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
            for (const [outputIdx, outputType] of def.output.entries()) {
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
                    this.onFailedFn?.(new MissingNodeError("Failed to get workflow node definitions", { cause: await e.json() }));
                }
                else {
                    this.onFailedFn?.(new MissingNodeError("There was a missing node in the workflow bypass.", { cause: e }));
                }
                return null;
            }
        }
        const job = await this.client.ext.queue.appendPrompt(workflow).catch(async (e) => {
            try {
                if (e instanceof EnqueueFailedError) {
                    this.onFailedFn?.(e);
                }
                else if (e instanceof Response) {
                    const err = await buildEnqueueFailedError(e);
                    this.onFailedFn?.(err);
                }
                else if (e && typeof e === 'object' && 'response' in e && e.response instanceof Response) {
                    const err = await buildEnqueueFailedError(e.response);
                    this.onFailedFn?.(err);
                }
                else {
                    this.onFailedFn?.(new EnqueueFailedError("Failed to queue prompt", { cause: e, reason: e?.message }));
                }
            }
            catch (inner) {
                this.onFailedFn?.(new EnqueueFailedError("Failed to queue prompt", { cause: inner }));
            }
            return null;
        });
        if (!job) {
            return;
        }
        this.promptId = job.prompt_id;
        this.client.dispatchEvent?.(new CustomEvent("log", { detail: { fnName: "CallWrapper.enqueueJob", message: "queued", data: { prompt_id: this.promptId } } }));
        this.onPendingFn?.(this.promptId);
        this.onDisconnectedHandlerOffFn = this.client.on("disconnected", () => this.onFailedFn?.(new DisconnectedError("Disconnected"), this.promptId));
        return job;
    }
    async handleCachedOutput(promptId) {
        const hisData = await this.client.ext.history.getHistory(promptId);
        if (hisData?.status?.completed) {
            const output = this.mapOutput(hisData.outputs);
            if (Object.values(output).some((v) => v !== undefined)) {
                this.onFinishedFn?.(output, this.promptId);
                return output;
            }
            else {
                return false;
            }
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
    handleJobExecution(promptId, jobDoneTrigger) {
        const reverseOutputMapped = this.reverseMapOutputKeys();
        this.progressHandlerOffFn = this.client.on("progress", (ev) => this.handleProgress(ev, promptId));
        this.previewHandlerOffFn = this.client.on("b_preview", (ev) => this.onPreviewFn?.(ev.detail, this.promptId));
        // Also forward preview with metadata if available
        const offPreviewMeta = this.client.on("b_preview_meta", (ev) => this.onPreviewMetaFn?.(ev.detail, this.promptId));
        const prevCleanup = this.previewHandlerOffFn;
        this.previewHandlerOffFn = () => {
            prevCleanup?.();
            offPreviewMeta?.();
        };
        const totalOutput = Object.keys(reverseOutputMapped).length;
        let remainingOutput = totalOutput;
        const executionHandler = (ev) => {
            if (ev.detail.prompt_id !== promptId)
                return;
            const outputKey = reverseOutputMapped[ev.detail.node];
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
            if (remainingOutput === 0) {
                this.client.dispatchEvent?.(new CustomEvent("log", { detail: { fnName: "CallWrapper.handleJobExecution", message: "all outputs collected" } }));
                this.cleanupListeners();
                this.onFinishedFn?.(this.output, this.promptId);
                jobDoneTrigger(this.output);
            }
        };
        const executedEnd = async () => {
            if (remainingOutput !== 0) {
                // some cached output nodes might output after executedEnd, so check history data if an output is really missing
                const hisData = await this.client.ext.history.getHistory(promptId);
                if (hisData?.status?.completed) {
                    const outputCount = Object.keys(hisData.outputs).length;
                    if (outputCount > 0 && outputCount - totalOutput === 0) {
                        this.client.dispatchEvent?.(new CustomEvent("log", { detail: { fnName: "CallWrapper.executedEnd", message: "outputs equal total after history check -> ignore false end" } }));
                        return;
                    }
                }
                this.client.dispatchEvent?.(new CustomEvent("log", { detail: { fnName: "CallWrapper.executedEnd", message: "execution failed due to missing outputs", data: { remainingOutput, totalOutput } } }));
                this.onFailedFn?.(new ExecutionFailedError("Execution failed"), this.promptId);
                this.cleanupListeners();
                jobDoneTrigger(false);
            }
        };
        this.executionEndSuccessOffFn = this.client.on("execution_success", executedEnd);
        this.executionHandlerOffFn = this.client.on("executed", executionHandler);
        this.errorHandlerOffFn = this.client.on("execution_error", (ev) => this.handleError(ev, promptId, jobDoneTrigger));
        this.interruptionHandlerOffFn = this.client.on("execution_interrupted", (ev) => {
            if (ev.detail.prompt_id !== promptId)
                return;
            this.onFailedFn?.(new ExecutionInterruptedError("The execution was interrupted!", { cause: ev.detail }), ev.detail.prompt_id);
            this.cleanupListeners();
            jobDoneTrigger(false);
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
    handleError(ev, promptId, resolve) {
        if (ev.detail.prompt_id !== promptId)
            return;
        this.client.dispatchEvent?.(new CustomEvent("log", { detail: { fnName: "CallWrapper.handleError", message: ev.detail.exception_type, data: { prompt_id: ev.detail.prompt_id, node_id: ev.detail?.node_id } } }));
        this.onFailedFn?.(new CustomEventError(ev.detail.exception_type, { cause: ev.detail }), ev.detail.prompt_id);
        this.cleanupListeners();
        resolve(false);
    }
    cleanupListeners() {
        this.onDisconnectedHandlerOffFn?.();
        this.checkExecutingOffFn?.();
        this.checkExecutedOffFn?.();
        this.progressHandlerOffFn?.();
        this.previewHandlerOffFn?.();
        this.executionHandlerOffFn?.();
        this.errorHandlerOffFn?.();
        this.executionEndSuccessOffFn?.();
        this.interruptionHandlerOffFn?.();
        this.statusHandlerOffFn?.();
    }
}
//# sourceMappingURL=call-wrapper.js.map