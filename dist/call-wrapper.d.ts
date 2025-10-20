import { NodeData, NodeProgress } from "./types/api.js";
import { ComfyApi } from "./client.js";
import { PromptBuilder } from "./prompt-builder.js";
/**
 * Represents a wrapper class for making API calls using the ComfyApi client.
 * Provides methods for setting callback functions and executing the job.
 */
export declare class CallWrapper<I extends string, O extends string, T extends NodeData> {
    private client;
    private prompt;
    private started;
    private promptId?;
    private output;
    private onPreviewFn?;
    private onPreviewMetaFn?;
    private onPendingFn?;
    private onStartFn?;
    private onOutputFn?;
    private onFinishedFn?;
    private onFailedFn?;
    private onProgressFn?;
    private onDisconnectedHandlerOffFn;
    private checkExecutingOffFn;
    private checkExecutedOffFn;
    private progressHandlerOffFn;
    private previewHandlerOffFn;
    private executionHandlerOffFn;
    private errorHandlerOffFn;
    private executionEndSuccessOffFn;
    private statusHandlerOffFn;
    private interruptionHandlerOffFn;
    private missingCheckTimer?;
    /**
     * Constructs a new CallWrapper instance.
     * @param client The ComfyApi client.
     * @param workflow The workflow object.
     */
    constructor(client: ComfyApi, workflow: PromptBuilder<I, O, T>);
    /**
     * Set the callback function to be called when a preview event occurs.
     *
     * @param fn - The callback function to be called. It receives a Blob object representing the event and an optional promptId string.
     * @returns The current instance of the CallWrapper.
     */
    onPreview(fn: (ev: Blob, promptId?: string) => void): this;
    /**
     * Set the callback function to be called when a preview-with-metadata event occurs.
     */
    onPreviewMeta(fn: (payload: {
        blob: Blob;
        metadata: any;
    }, promptId?: string) => void): this;
    /**
     * Set a callback function to be executed when the job is queued.
     * @param {Function} fn - The callback function to be executed.
     * @returns The current instance of the CallWrapper.
     */
    onPending(fn: (promptId?: string) => void): this;
    /**
     * Set the callback function to be executed when the job start.
     *
     * @param fn - The callback function to be executed. It can optionally receive a `promptId` parameter.
     * @returns The current instance of the CallWrapper.
     */
    onStart(fn: (promptId?: string) => void): this;
    /**
     * Sets the callback function to handle the output node when the workflow is executing. This is
     * useful when you want to handle the output of each nodes as they are being processed.
     *
     * All the nodes defined in the `mapOutputKeys` will be passed to this function when node is executed.
     *
     * @param fn - The callback function to handle the output.
     * @returns The current instance of the class.
     */
    onOutput(fn: (key: keyof PromptBuilder<I, O, T>["mapOutputKeys"] | string | "_raw", data: any, promptId?: string) => void): this;
    /**
     * Set the callback function to be executed when the asynchronous operation is finished.
     *
     * @param fn - The callback function to be executed. It receives the data returned by the operation
     *             and an optional promptId parameter.
     * @returns The current instance of the CallWrapper.
     */
    onFinished(fn: (data: Record<keyof PromptBuilder<I, O, T>["mapOutputKeys"], any> & {
        /**
         * The raw output data from the workflow execution.
         * Key is node_id, value is node output.
         */
        _raw?: Record<string, any>;
    }, promptId?: string) => void): this;
    /**
     * Set the callback function to be executed when the API call fails.
     *
     * @param fn - The callback function to be executed when the API call fails.
     *             It receives an `Error` object as the first parameter and an optional `promptId` as the second parameter.
     * @returns The current instance of the CallWrapper.
     */
    onFailed(fn: (err: Error, promptId?: string) => void): this;
    /**
     * Set a callback function to be called when progress information is available.
     * @param fn - The callback function to be called with the progress information.
     * @returns The current instance of the CallWrapper.
     */
    onProgress(fn: (info: NodeProgress, promptId?: string) => void): this;
    /**
     * Run the call wrapper and returns the output of the executed job.
     * If the job is already cached, it returns the cached output.
     * If the job is not cached, it executes the job and returns the output.
     *
     * @returns A promise that resolves to the output of the executed job,
     *          or `undefined` if the job is not found,
     *          or `false` if the job execution fails.
     */
    run(): Promise<Record<keyof PromptBuilder<I, O, T>["mapOutputKeys"] | "_raw", any> | undefined | false>;
    private bypassWorkflowNodes;
    private enqueueJob;
    private handleCachedOutput;
    private mapOutput;
    private handleJobExecution;
    private reverseMapOutputKeys;
    private handleProgress;
    private handleError;
    private cleanupListeners;
}
//# sourceMappingURL=call-wrapper.d.ts.map