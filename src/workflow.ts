import { PromptBuilder } from './prompt-builder.js';
import { CallWrapper } from './call-wrapper.js';
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
    private inputPaths: string[] = []; // retained for compatibility with PromptBuilder signature

    // Overloads to preserve literal type inference when passing an object
    static from<TD extends WorkflowJSON>(data: TD): Workflow<TD, {}>;
    static from(data: string): Workflow;
    static from(data: any): Workflow<any, {}> {
        if (typeof data === 'string') {
            try {
                const parsed = JSON.parse(data);
                return new Workflow(parsed);
            } catch (e) {
                throw new Error('Failed to parse workflow JSON string', { cause: e });
            }
        }
        return new Workflow(structuredClone(data));
    }

    constructor(json: T) {
        this.json = structuredClone(json);
    }

    /**
     * Like from(), but augments known node types (e.g., KSampler) with soft union hints
     * for inputs such as sampler_name & scheduler while still allowing arbitrary strings.
     */
    static fromAugmented<TD extends WorkflowJSON>(data: TD): Workflow<AugmentNodes<TD>, {}> {
        return Workflow.from(data) as unknown as Workflow<AugmentNodes<TD>, {}>;
    }

    /** Set a nested input path on a node e.g. set('9.inputs.text','hello') */
    set(path: string, value: any) {
        const keys = path.split('.');
        let cur: any = this.json;
        for (let i = 0; i < keys.length - 1; i++) {
            if (cur[keys[i]] === undefined) cur[keys[i]] = {};
            cur = cur[keys[i]];
        }
        cur[keys.at(-1)!] = value;
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
            alias = a; nodeId = b;
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
        if (alias) this.outputAliases[nodeId] = alias;
        return this as any; // typed refinement handled via declaration merging below
    }

    private inferDefaultOutputs() {
        if (this.outputNodeIds.length === 0) {
            // naive heuristic: collect SaveImage nodes
            for (const [id, node] of Object.entries(this.json)) {
                if ((node as any).class_type?.toLowerCase().includes('saveimage')) this.outputNodeIds.push(id);
            }
        }
    }

    async run(api: ComfyApi, opts: WorkflowRunOptions = {}): Promise<WorkflowJob<WorkflowResult & O>> {
        this.inferDefaultOutputs();
        if (opts.includeOutputs) {
            for (const id of opts.includeOutputs) this.outputNodeIds.push(id);
        }
        const job = new WorkflowJob<WorkflowResult & O>();

        // Auto-randomize any node input field named 'seed' whose value is -1 (common ComfyUI convention)
        const autoSeeds: Record<string, number> = {};
        try {
            for (const [nodeId, node] of Object.entries(this.json)) {
                const n: any = node;
                if (n && n.inputs && Object.prototype.hasOwnProperty.call(n.inputs, 'seed')) {
                    if (n.inputs.seed === -1) {
                        const val = Math.floor(Math.random() * 2_147_483_647); // 32-bit positive range typical for seeds
                        n.inputs.seed = val;
                        autoSeeds[nodeId] = val;
                    }
                }
            }
        } catch { /* non-fatal */ }

        let pb = new PromptBuilder(this.json as any, this.inputPaths as any, this.outputNodeIds as any);
        // map outputs
        for (const nodeId of this.outputNodeIds) {
            pb = (pb as any).setOutputNode(nodeId as any, nodeId) as any; // reassign clone with relaxed typing
        }
        const wrapper = new CallWrapper(api as any, pb)
            .onPending(pid => job._emit('pending', pid!))
            .onStart(pid => job._emit('start', pid!))
            .onProgress((info) => {
                job._emit('progress', info);
                if (info && typeof info.value === 'number' && typeof info.max === 'number' && info.max > 0) {
                    const pct = Math.floor((info.value / info.max) * 100);
                    if (pct !== job.lastProgressPct) {
                        job.lastProgressPct = pct;
                        job._emit('progress_pct', pct, info);
                    }
                }
            })
            .onPreview((blob) => job._emit('preview', blob))
            .onOutput((key, data) => job._emit('output', key as string, data))
            .onFinished((data, pid) => {
                const out: WorkflowResult = {} as any;
                for (const nodeId of this.outputNodeIds) {
                    const key = this.outputAliases[nodeId] || nodeId;
                    out[key] = (data as any)[nodeId];
                }
                // Provide raw mapping context for advanced users
                (out as any)._nodes = this.outputNodeIds.slice();
                (out as any)._aliases = { ...this.outputAliases };
                (out as any)._promptId = pid;
                if (Object.keys(autoSeeds).length) (out as any)._autoSeeds = autoSeeds;
                const typedOut = out as WorkflowResult & O;
                job._emit('finished', typedOut as any, pid!);
                job._finish(typedOut as any);
            })
            .onFailed((err, pid) => {
                job._emit('failed', err, pid);
                job._fail(err, pid);
            });

        // Execute directly or via pool
        const exec = async () => {
            try {
                await wrapper.run();
            } catch (e) {
                job._fail(e as any);
            }
        };
        if (opts.pool) {
            opts.pool.run(exec).catch(e => job._fail(e));
        } else {
            exec();
        }
        // Wait until the job is accepted (pending) OR failed during enqueue
        await new Promise<void>((resolve, reject) => {
            let settled = false;
            job.on('pending', () => { if (!settled) { settled = true; resolve(); } });
            job.on('failed', (err: any) => { if (!settled) { settled = true; reject(err); } });
            // Safety timeout in case events never fire (e.g., silent failure) -> resolve to allow user to still interact
            setTimeout(() => { if (!settled) { settled = true; resolve(); } }, 5000);
        });
        return job;
    }

    /** IDE helper returning empty object typed as final result (aliases + metadata). */
    typedResult(): WorkflowResult & O { return {} as any; }
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
