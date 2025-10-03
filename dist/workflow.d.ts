import { ComfyApi } from './client.js';
import { ComfyPool } from './pool.js';
import type { AugmentNodes } from './node-type-hints.js';
type WorkflowJSON = Record<string, any>;
export interface WorkflowResultMeta {
    _promptId?: string;
    _nodes?: string[];
    _aliases?: Record<string, string>;
    _autoSeeds?: Record<string, number>;
}
export type WorkflowResult = WorkflowResultMeta & Record<string, any>;
export interface WorkflowRunOptions {
    pool?: ComfyPool;
    includeOutputs?: string[];
}
export interface WorkflowJobEvents<R extends WorkflowResult = WorkflowResult> {
    progress: (info: {
        value: number;
        max: number;
        prompt_id: string;
        node: string;
    }) => void;
    progress_pct: (pct: number, info: any) => void;
    preview: (blob: Blob) => void;
    preview_meta: (data: {
        blob: Blob;
        metadata: any;
    }) => void;
    pending: (promptId: string) => void;
    start: (promptId: string) => void;
    output: (key: string, data: any) => void;
    finished: (data: R, promptId: string) => void;
    failed: (err: Error, promptId?: string) => void;
}
type EventKey<R extends WorkflowResult> = keyof WorkflowJobEvents<R>;
export declare class WorkflowJob<R extends WorkflowResult = WorkflowResult> {
    private emitter;
    private donePromise;
    private doneResolve;
    private doneReject;
    lastProgressPct: number;
    constructor();
    on<K extends EventKey<R>>(evt: K, fn: WorkflowJobEvents<R>[K]): this;
    off<K extends EventKey<R>>(evt: K, fn: WorkflowJobEvents<R>[K]): this;
    /** Await final mapped outputs */
    done(): Promise<R>;
    _emit<K extends EventKey<R>>(evt: K, ...args: Parameters<WorkflowJobEvents<R>[K]>): void;
    _finish(data: R): void;
    _fail(err: Error, promptId?: string): void;
}
type NodeInputs<T> = T extends {
    inputs: infer I;
} ? I : never;
type OutputMap = Record<string, any>;
type OutputShapeFor<C extends string> = C extends 'SaveImage' | 'SaveImageAdvanced' ? {
    images?: any[];
} : C extends 'KSampler' ? {
    samples?: any;
} : any;
type NodeOutputFor<T extends WorkflowJSON, K extends keyof T & string> = T[K] extends {
    class_type: infer C;
} ? C extends string ? OutputShapeFor<C> : any : any;
export declare class Workflow<T extends WorkflowJSON = WorkflowJSON, O extends OutputMap = {}> {
    private json;
    private outputNodeIds;
    private outputAliases;
    private inputPaths;
    private bypassedNodes;
    private _pendingImageInputs;
    private _pendingFolderFiles;
    static from<TD extends WorkflowJSON>(data: TD): Workflow<TD, {}>;
    static from(data: string): Workflow;
    constructor(json: T);
    /**
     * Like from(), but augments known node types (e.g., KSampler) with soft union hints
     * for inputs such as sampler_name & scheduler while still allowing arbitrary strings.
     */
    static fromAugmented<TD extends WorkflowJSON>(data: TD): Workflow<AugmentNodes<TD>, {}>;
    /** Set a nested input path on a node e.g. set('9.inputs.text','hello') */
    set(path: string, value: any): this;
    /** Attach a single image buffer to a node input (e.g., LoadImage.image). Will upload on run() then set the input to the filename. */
    attachImage(nodeId: keyof T & string, inputName: string, data: Blob | Buffer | ArrayBuffer | Uint8Array, fileName: string, opts?: {
        subfolder?: string;
        override?: boolean;
    }): this;
    /** Attach multiple files into a server subfolder (useful for LoadImageSetFromFolderNode). */
    attachFolderFiles(subfolder: string, files: Array<{
        data: Blob | Buffer | ArrayBuffer | Uint8Array;
        fileName: string;
    }>, opts?: {
        override?: boolean;
    }): this;
    /**
     * Sugar for setting a node's input: wf.input('SAMPLER','steps',30)
     * Equivalent to set('SAMPLER.inputs.steps', 30).
     * Performs a light existence check to aid DX (doesn't throw if missing by design unless strict parameter is passed).
     */
    input<K extends keyof T, P extends keyof NodeInputs<T[K]> & string>(nodeId: K, inputName: P, value: NodeInputs<T[K]>[P], opts?: {
        strict?: boolean;
    }): this;
    /**
     * Batch variant:
     *  - wf.inputs('SAMPLER', { steps: 30, cfg: 7 })
     *  - wf.inputs({ SAMPLER: { steps: 30 }, CLIP: { text: 'hello' } })
     * Honors strict mode (throws if node missing when strict:true).
     */
    batchInputs<K extends keyof T>(nodeId: K, values: Partial<NodeInputs<T[K]>>, opts?: {
        strict?: boolean;
    }): this;
    batchInputs<M extends {
        [N in keyof T]?: Partial<NodeInputs<T[N]>>;
    }>(batch: M, opts?: {
        strict?: boolean;
    }): this;
    /**
     * Mark a node to be bypassed during execution.
     * The node will be removed and its connections automatically rewired.
     *
     * @param node - Node ID to bypass
     * @returns This workflow instance for chaining
     */
    bypass(node: keyof T & string): this;
    /**
     * Mark multiple nodes to be bypassed during execution.
     *
     * @param nodes - Array of node IDs to bypass
     * @returns This workflow instance for chaining
     */
    bypass(nodes: (keyof T & string)[]): this;
    /**
     * Remove a node from the bypass list, re-enabling it.
     *
     * @param node - Node ID to reinstate
     * @returns This workflow instance for chaining
     */
    reinstate(node: keyof T & string): this;
    /**
     * Remove multiple nodes from the bypass list.
     *
     * @param nodes - Array of node IDs to reinstate
     * @returns This workflow instance for chaining
     */
    reinstate(nodes: (keyof T & string)[]): this;
    private inferDefaultOutputs;
    run(api: ComfyApi, opts?: WorkflowRunOptions): Promise<WorkflowJob<WorkflowResult & O>>;
    /** IDE helper returning empty object typed as final result (aliases + metadata). */
    typedResult(): WorkflowResult & O;
}
export interface Workflow<T extends WorkflowJSON = WorkflowJSON, O extends OutputMap = {}> {
    output<NodeId extends keyof T & string>(nodeId: NodeId): Workflow<T, O & Record<NodeId, NodeOutputFor<T, NodeId>>>;
    output<Spec extends `${string}:${keyof T & string}`>(spec: Spec): Workflow<T, O & (Spec extends `${infer Alias}:${infer Node}` ? (Node extends keyof T & string ? Record<Alias, NodeOutputFor<T, Node>> : Record<Alias, any>) : {})>;
    output<Alias extends string, NodeId extends keyof T & string>(alias: Alias, nodeId: NodeId): Workflow<T, O & Record<Alias, NodeOutputFor<T, NodeId>>>;
    output<A extends string>(single: A): Workflow<T, O & Record<A, any>>;
    output<Alias extends string, NodeId extends string>(alias: Alias, nodeId: NodeId): Workflow<T, O & Record<Alias, any>>;
}
export {};
//# sourceMappingURL=workflow.d.ts.map