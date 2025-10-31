import { hashWorkflow } from '../pool/utils/hash.js';
import type { AugmentNodes } from '../node-type-hints.js';

type WorkflowJSON = Record<string, any>;

export interface WorkflowResultMeta {
    _promptId?: string;
    _nodes?: string[];
    _aliases?: Record<string, string>;
    _autoSeeds?: Record<string, number>;
}
export type WorkflowResult = WorkflowResultMeta & Record<string, any>;

export interface WorkflowRunOptions {
    includeOutputs?: string[]; // optional explicit output node ids; if omitted infer SaveImage nodes
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
    preview_meta: (data: { blob: Blob; metadata: any }) => void;
    pending: (promptId: string) => void;
    start: (promptId: string) => void;
    output: (key: string, data: any) => void;
    finished: (data: R, promptId: string) => void;
    failed: (err: Error, promptId?: string) => void;
}

type EventKey<R extends WorkflowResult> = keyof WorkflowJobEvents<R>;

class TinyEmitter {
    private listeners: Map<string, Set<Function>> = new Map();
    on(evt: string, fn: Function) {
        if (!this.listeners.has(evt)) this.listeners.set(evt, new Set());
        this.listeners.get(evt)!.add(fn);
        return () => this.off(evt, fn);
    }
    off(evt: string, fn: Function) { this.listeners.get(evt)?.delete(fn); }
    emit(evt: string, ...args: any[]) { this.listeners.get(evt)?.forEach(fn => { try { fn(...args); } catch { } }); }
    removeAll() { this.listeners.clear(); }
}

export class WorkflowJob<R extends WorkflowResult = WorkflowResult> {
    private emitter = new TinyEmitter();
    private donePromise: Promise<R>;
    private doneResolve!: (v: R) => void;
    private doneReject!: (e: any) => void;
    public lastProgressPct: number = -1;
    constructor() {
        this.donePromise = new Promise((res, rej) => { this.doneResolve = res; this.doneReject = rej; });
        // Prevent unhandled rejection warnings by attaching a catch handler
        // The actual error handling happens when user calls done()
        this.donePromise.catch(() => {});
    }
    on<K extends EventKey<R>>(evt: K, fn: WorkflowJobEvents<R>[K]) { this.emitter.on(evt, fn as any); return this; }
    off<K extends EventKey<R>>(evt: K, fn: WorkflowJobEvents<R>[K]) { this.emitter.off(evt, fn as any); return this; }
    /** Await final mapped outputs */
    done() { return this.donePromise; }
    _emit<K extends EventKey<R>>(evt: K, ...args: Parameters<WorkflowJobEvents<R>[K]>) { this.emitter.emit(evt, ...args); }
    _finish(data: R) { this.doneResolve(data); this.emitter.emit('finished', data, (data as any)._promptId); }
    _fail(err: Error, promptId?: string) { this.doneReject(err); this.emitter.emit('failed', err, promptId); }
}

// Helper conditional types to extract inputs shape
type NodeInputs<T> = T extends { inputs: infer I } ? I : never;

// Build up output alias map type
type OutputMap = Record<string, any>;

// Basic heuristic output shape mapping based on common ComfyUI node class types.
// These are intentionally minimal; users can still refine manually.
type OutputShapeFor<C extends string> =
    C extends 'SaveImage' | 'SaveImageAdvanced' ? { images?: any[] } :
    C extends 'KSampler' ? { samples?: any } :
    any;

type NodeOutputFor<T extends WorkflowJSON, K extends keyof T & string> =
    T[K] extends { class_type: infer C }
    ? C extends string
    ? OutputShapeFor<C>
    : any
    : any;

export class Workflow<T extends WorkflowJSON = WorkflowJSON, O extends OutputMap = {}> {
    private json: T;
    private outputNodeIds: string[] = [];
    private outputAliases: Record<string, string> = {}; // nodeId -> alias
    private bypassedNodes: (keyof T)[] = []; // nodes to bypass during execution
    // Pending assets to upload before execution
    private _pendingImageInputs: Array<{ nodeId: string; inputName: string; blob: Blob; fileName: string; subfolder?: string; override?: boolean }> = [];
    private _pendingFolderFiles: Array<{ subfolder: string; blob: Blob; fileName: string; override?: boolean }> = [];
    
    /** Structural hash of the workflow JSON for compatibility tracking in failover scenarios */
    structureHash?: string;

    // Overloads to preserve literal type inference when passing an object
    static from<TD extends WorkflowJSON>(data: TD, opts?: { autoHash?: boolean }): Workflow<TD, {}>;
    static from(data: string, opts?: { autoHash?: boolean }): Workflow;
    static from(data: any, opts?: { autoHash?: boolean }): Workflow<any, {}> {
        if (typeof data === 'string') {
            try {
                const parsed = JSON.parse(data);
                return new Workflow(parsed, opts);
            } catch (e) {
                throw new Error('Failed to parse workflow JSON string', { cause: e });
            }
        }
        return new Workflow(structuredClone(data), opts);
    }

    constructor(json: T, opts?: { autoHash?: boolean }) {
        this.json = structuredClone(json);
        // Compute structural hash by default unless explicitly disabled
        if (opts?.autoHash !== false) {
            this.structureHash = hashWorkflow(this.json);
        }
    }

    /**
     * Like from(), but augments known node types (e.g., KSampler) with soft union hints
     * for inputs such as sampler_name & scheduler while still allowing arbitrary strings.
     */
    static fromAugmented<TD extends WorkflowJSON>(data: TD, opts?: { autoHash?: boolean }): Workflow<AugmentNodes<TD>, {}> {
        return Workflow.from(data, opts) as unknown as Workflow<AugmentNodes<TD>, {}>;
    }

    /** Set a nested input path on a node e.g. set('9.inputs.text','hello') */
    set(path: string, value: any) {
        const keys = path.split('.');
        let cur: any = this.json;
        for (let i = 0; i < keys.length - 1; i++) {
            if (cur[keys[i]] === undefined) cur[keys[i]] = {};
            cur = cur[keys[i]];
        }
        cur[keys[keys.length - 1]!] = value;
        return this;
    }

    /** Attach a single image buffer to a node input (e.g., LoadImage.image). Will upload on run() then set the input to the filename. */
    attachImage(nodeId: keyof T & string, inputName: string, data: Blob | Buffer | ArrayBuffer | Uint8Array, fileName: string, opts?: { subfolder?: string; override?: boolean }) {
        const blob = toBlob(data, fileName);
        this._pendingImageInputs.push({ nodeId: String(nodeId), inputName, blob, fileName, subfolder: opts?.subfolder, override: opts?.override });
        return this;
    }

    /** Attach multiple files into a server subfolder (useful for LoadImageSetFromFolderNode). */
    attachFolderFiles(subfolder: string, files: Array<{ data: Blob | Buffer | ArrayBuffer | Uint8Array; fileName: string }>, opts?: { override?: boolean }) {
        for (const f of files) {
            const blob = toBlob(f.data, f.fileName);
            this._pendingFolderFiles.push({ subfolder, blob, fileName: f.fileName, override: opts?.override });
        }
        return this;
    }

    /**
     * Sugar for setting a node's input: wf.input('SAMPLER','steps',30)
     * Equivalent to set('SAMPLER.inputs.steps', 30).
     * Performs a light existence check to aid DX (doesn't throw if missing by design unless strict parameter is passed).
     */
    input<K extends keyof T, P extends keyof NodeInputs<T[K]> & string>(nodeId: K, inputName: P, value: NodeInputs<T[K]>[P], opts?: { strict?: boolean }) {
        const nodeKey = String(nodeId);
        const node = (this.json as any)[nodeKey];
        if (!node) {
            if (opts?.strict) throw new Error(`Workflow.input: node '${String(nodeId)}' not found`);
            // create minimal node shell if non-strict (lets users build up dynamically)
            (this.json as any)[nodeKey] = { inputs: { [inputName]: value } };
            return this;
        }
        if (!node.inputs) {
            if (opts?.strict) throw new Error(`Workflow.input: node '${String(nodeId)}' missing inputs object`);
            node.inputs = {};
        }
        node.inputs[inputName] = value;
        return this;
    }

    /**
     * Batch variant:
     *  - wf.inputs('SAMPLER', { steps: 30, cfg: 7 })
     *  - wf.inputs({ SAMPLER: { steps: 30 }, CLIP: { text: 'hello' } })
     * Honors strict mode (throws if node missing when strict:true).
     */
    batchInputs<K extends keyof T>(nodeId: K, values: Partial<NodeInputs<T[K]>>, opts?: { strict?: boolean }): this;
    batchInputs<M extends { [N in keyof T]?: Partial<NodeInputs<T[N]>> }>(batch: M, opts?: { strict?: boolean }): this;
    batchInputs(a: any, b?: any, c?: any) {
        // Form 1: (nodeId, values, opts)
        if (typeof a === 'string') {
            const nodeId = a;
            const values = b || {};
            const opts = c || {};
            for (const [k, v] of Object.entries(values)) {
                this.input(nodeId as any, k as any, v, opts);
            }
            return this;
        }
        // Form 2: (batchObject, opts)
        const batch = a || {};
        const opts = b || {};
        for (const [nodeId, values] of Object.entries(batch)) {
            if (!values) continue;
            for (const [k, v] of Object.entries(values as any)) {
                this.input(nodeId as any, k as any, v, opts);
            }
        }
        return this;
    }

    /**
     * Mark a node id whose outputs we want collected.
     * Supports aliasing in two forms:
     *  - output('alias','9')
     *  - output('alias:9')
     *  - output('9') (no alias, raw node id key)
     */
    output<A extends string, B extends string | undefined = undefined>(a: A, b?: B): any /* Workflow<T, ...> */ {
        let alias: string | undefined;
        let nodeId: string;
        if (b) {
            // Heuristic: if first arg looks like a node id and second arg looks like an alias, swap
            // Node ids are often numeric strings (e.g., '2'); aliases are non-numeric labels.
            const looksLikeNodeId = (s: string) => /^\d+$/.test(s) || (this.json as any)[s];
            if (looksLikeNodeId(String(a)) && !looksLikeNodeId(String(b))) {
                nodeId = String(a);
                alias = String(b);
                try { console.warn(`Workflow.output called as output(nodeId, alias). Interpreting as output(alias,nodeId): '${alias}:${nodeId}'`); } catch { }
            } else {
                alias = String(a);
                nodeId = String(b);
            }
        } else {
            // single param variant: maybe "alias:node" or just node
            if (a.includes(':')) {
                const [al, id] = a.split(':');
                if (al && id) { alias = al; nodeId = id; } else { nodeId = a; }
            } else {
                nodeId = a;
            }
        }
        if (!this.outputNodeIds.includes(nodeId)) this.outputNodeIds.push(nodeId);
        if (alias) {
            this.outputAliases[nodeId] = alias;
        }
        return this as any; // typed refinement handled via declaration merging below
    }

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
    
    bypass(nodes: (keyof T & string) | (keyof T & string)[]): this {
        if (!Array.isArray(nodes)) {
            nodes = [nodes];
        }
        for (const node of nodes) {
            if (!this.bypassedNodes.includes(node)) {
                this.bypassedNodes.push(node);
            }
        }
        return this;
    }

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
    
    reinstate(nodes: (keyof T & string) | (keyof T & string)[]): this {
        if (!Array.isArray(nodes)) {
            nodes = [nodes];
        }
        for (const node of nodes) {
            const idx = this.bypassedNodes.indexOf(node);
            if (idx !== -1) {
                this.bypassedNodes.splice(idx, 1);
            }
        }
        return this;
    }

    /**
     * Update the structural hash after making non-dynamic changes to the workflow.
     * Call this if you modify the workflow structure after initialization and the autoHash was disabled,
     * or if you want to recalculate the hash after making structural changes.
     * 
     * Example:
     * ```
     * const wf = Workflow.from(data, { autoHash: false });
     * wf.input('SAMPLER', 'ckpt_name', 'model_v1.safetensors');
     * wf.updateHash(); // Recompute hash after structural change
     * ```
     */
    updateHash(): this {
        this.structureHash = hashWorkflow(this.json);
        return this;
    }

    /** IDE helper returning empty object typed as final result (aliases + metadata). */
    typedResult(): WorkflowResult & O { return {} as any; }

    /** Get the raw workflow JSON structure. */
    toJSON(): T {
        return structuredClone(this.json);
    }
}

// Augment the instance method type for output() with conditional return type.
export interface Workflow<T extends WorkflowJSON = WorkflowJSON, O extends OutputMap = {}> {
    // 1. output('NODE_ID') -> key is node id, value inferred from node class_type
    output<NodeId extends keyof T & string>(nodeId: NodeId): Workflow<T, O & Record<NodeId, NodeOutputFor<T, NodeId>>>;
    // 2. output('alias:NODE_ID') -> alias key with inferred node output
    output<Spec extends `${string}:${keyof T & string}`>(spec: Spec): Workflow<T, O & (
        Spec extends `${infer Alias}:${infer Node}` ? (Node extends keyof T & string ? Record<Alias, NodeOutputFor<T, Node>> : Record<Alias, any>) : {}
    )>;
    // 3. output('alias','NODE_ID') -> alias key
    output<Alias extends string, NodeId extends keyof T & string>(alias: Alias, nodeId: NodeId): Workflow<T, O & Record<Alias, NodeOutputFor<T, NodeId>>>;
    // Fallback (keeps previous permissive behavior)
    output<A extends string>(single: A): Workflow<T, O & Record<A, any>>;
    output<Alias extends string, NodeId extends string>(alias: Alias, nodeId: NodeId): Workflow<T, O & Record<Alias, any>>;
}

// Helper: normalize to Blob for upload
function toBlob(src: Blob | Buffer | ArrayBuffer | Uint8Array, fileName?: string): Blob {
    if (src instanceof Blob) return src;
    // Normalize everything to a plain ArrayBuffer for reliable BlobPart typing
    let ab: ArrayBuffer;
    if (typeof Buffer !== 'undefined' && src instanceof Buffer) {
        const u8 = new Uint8Array(src);
        ab = u8.slice(0).buffer;
    } else if (src instanceof Uint8Array) {
        const u8 = new Uint8Array(src.byteLength);
        u8.set(src);
        ab = u8.buffer;
    } else if (src instanceof ArrayBuffer) {
        ab = src;
    } else {
        ab = new ArrayBuffer(0);
    }
    return new Blob([ab], { type: mimeFromName(fileName) });
}

function mimeFromName(name?: string): string | undefined {
    if (!name) return undefined;
    const n = name.toLowerCase();
    if (n.endsWith('.png')) return 'image/png';
    if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
    if (n.endsWith('.webp')) return 'image/webp';
    return undefined;
}
