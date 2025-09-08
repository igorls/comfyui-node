import { PromptBuilder } from './prompt-builder.js';
import { CallWrapper } from './call-wrapper.js';
class TinyEmitter {
    listeners = new Map();
    on(evt, fn) {
        if (!this.listeners.has(evt))
            this.listeners.set(evt, new Set());
        this.listeners.get(evt).add(fn);
        return () => this.off(evt, fn);
    }
    off(evt, fn) { this.listeners.get(evt)?.delete(fn); }
    emit(evt, ...args) { this.listeners.get(evt)?.forEach(fn => { try {
        fn(...args);
    }
    catch { } }); }
    removeAll() { this.listeners.clear(); }
}
export class WorkflowJob {
    emitter = new TinyEmitter();
    donePromise;
    doneResolve;
    doneReject;
    lastProgressPct = -1;
    constructor() {
        this.donePromise = new Promise((res, rej) => { this.doneResolve = res; this.doneReject = rej; });
    }
    on(evt, fn) { this.emitter.on(evt, fn); return this; }
    off(evt, fn) { this.emitter.off(evt, fn); return this; }
    /** Await final mapped outputs */
    done() { return this.donePromise; }
    _emit(evt, ...args) { this.emitter.emit(evt, ...args); }
    _finish(data) { this.doneResolve(data); this.emitter.emit('finished', data, data._promptId); }
    _fail(err, promptId) { this.doneReject(err); this.emitter.emit('failed', err, promptId); }
}
export class Workflow {
    json;
    outputNodeIds = [];
    outputAliases = {}; // nodeId -> alias
    inputPaths = []; // retained for compatibility with PromptBuilder signature
    static from(data) {
        if (typeof data === 'string') {
            try {
                const parsed = JSON.parse(data);
                return new Workflow(parsed);
            }
            catch (e) {
                throw new Error('Failed to parse workflow JSON string', { cause: e });
            }
        }
        return new Workflow(structuredClone(data));
    }
    constructor(json) {
        this.json = structuredClone(json);
    }
    /**
     * Like from(), but augments known node types (e.g., KSampler) with soft union hints
     * for inputs such as sampler_name & scheduler while still allowing arbitrary strings.
     */
    static fromAugmented(data) {
        return Workflow.from(data);
    }
    /** Set a nested input path on a node e.g. set('9.inputs.text','hello') */
    set(path, value) {
        const keys = path.split('.');
        let cur = this.json;
        for (let i = 0; i < keys.length - 1; i++) {
            if (cur[keys[i]] === undefined)
                cur[keys[i]] = {};
            cur = cur[keys[i]];
        }
        cur[keys.at(-1)] = value;
        return this;
    }
    /**
     * Sugar for setting a node's input: wf.input('SAMPLER','steps',30)
     * Equivalent to set('SAMPLER.inputs.steps', 30).
     * Performs a light existence check to aid DX (doesn't throw if missing by design unless strict parameter is passed).
     */
    input(nodeId, inputName, value, opts) {
        const nodeKey = String(nodeId);
        const node = this.json[nodeKey];
        if (!node) {
            if (opts?.strict)
                throw new Error(`Workflow.input: node '${String(nodeId)}' not found`);
            // create minimal node shell if non-strict (lets users build up dynamically)
            this.json[nodeKey] = { inputs: { [inputName]: value } };
            return this;
        }
        if (!node.inputs) {
            if (opts?.strict)
                throw new Error(`Workflow.input: node '${String(nodeId)}' missing inputs object`);
            node.inputs = {};
        }
        node.inputs[inputName] = value;
        return this;
    }
    batchInputs(a, b, c) {
        // Form 1: (nodeId, values, opts)
        if (typeof a === 'string') {
            const nodeId = a;
            const values = b || {};
            const opts = c || {};
            for (const [k, v] of Object.entries(values)) {
                this.input(nodeId, k, v, opts);
            }
            return this;
        }
        // Form 2: (batchObject, opts)
        const batch = a || {};
        const opts = b || {};
        for (const [nodeId, values] of Object.entries(batch)) {
            if (!values)
                continue;
            for (const [k, v] of Object.entries(values)) {
                this.input(nodeId, k, v, opts);
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
    output(a, b) {
        let alias;
        let nodeId;
        if (b) {
            alias = a;
            nodeId = b;
        }
        else {
            // single param variant: maybe "alias:node" or just node
            if (a.includes(':')) {
                const [al, id] = a.split(':');
                if (al && id) {
                    alias = al;
                    nodeId = id;
                }
                else {
                    nodeId = a;
                }
            }
            else {
                nodeId = a;
            }
        }
        if (!this.outputNodeIds.includes(nodeId))
            this.outputNodeIds.push(nodeId);
        if (alias)
            this.outputAliases[nodeId] = alias;
        return this; // typed refinement handled via declaration merging below
    }
    inferDefaultOutputs() {
        if (this.outputNodeIds.length === 0) {
            // naive heuristic: collect SaveImage nodes
            for (const [id, node] of Object.entries(this.json)) {
                if (node.class_type?.toLowerCase().includes('saveimage'))
                    this.outputNodeIds.push(id);
            }
        }
    }
    async run(api, opts = {}) {
        this.inferDefaultOutputs();
        if (opts.includeOutputs) {
            for (const id of opts.includeOutputs)
                this.outputNodeIds.push(id);
        }
        const job = new WorkflowJob();
        // Auto-randomize any node input field named 'seed' whose value is -1 (common ComfyUI convention)
        const autoSeeds = {};
        try {
            for (const [nodeId, node] of Object.entries(this.json)) {
                const n = node;
                if (n && n.inputs && Object.prototype.hasOwnProperty.call(n.inputs, 'seed')) {
                    if (n.inputs.seed === -1) {
                        const val = Math.floor(Math.random() * 2_147_483_647); // 32-bit positive range typical for seeds
                        n.inputs.seed = val;
                        autoSeeds[nodeId] = val;
                    }
                }
            }
        }
        catch { /* non-fatal */ }
        let pb = new PromptBuilder(this.json, this.inputPaths, this.outputNodeIds);
        // map outputs
        for (const nodeId of this.outputNodeIds) {
            pb = pb.setOutputNode(nodeId, nodeId); // reassign clone with relaxed typing
        }
        const wrapper = new CallWrapper(api, pb)
            .onPending(pid => job._emit('pending', pid))
            .onStart(pid => job._emit('start', pid))
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
            .onOutput((key, data) => job._emit('output', key, data))
            .onFinished((data, pid) => {
            const out = {};
            for (const nodeId of this.outputNodeIds) {
                const key = this.outputAliases[nodeId] || nodeId;
                out[key] = data[nodeId];
            }
            // Provide raw mapping context for advanced users
            out._nodes = this.outputNodeIds.slice();
            out._aliases = { ...this.outputAliases };
            out._promptId = pid;
            if (Object.keys(autoSeeds).length)
                out._autoSeeds = autoSeeds;
            const typedOut = out;
            job._emit('finished', typedOut, pid);
            job._finish(typedOut);
        })
            .onFailed((err, pid) => {
            job._emit('failed', err, pid);
            job._fail(err, pid);
        });
        // Execute directly or via pool
        const exec = async () => {
            try {
                await wrapper.run();
            }
            catch (e) {
                job._fail(e);
            }
        };
        if (opts.pool) {
            opts.pool.run(exec).catch(e => job._fail(e));
        }
        else {
            exec();
        }
        // Wait until the job is accepted (pending) OR failed during enqueue
        await new Promise((resolve, reject) => {
            let settled = false;
            job.on('pending', () => { if (!settled) {
                settled = true;
                resolve();
            } });
            job.on('failed', (err) => { if (!settled) {
                settled = true;
                reject(err);
            } });
            // Safety timeout in case events never fire (e.g., silent failure) -> resolve to allow user to still interact
            setTimeout(() => { if (!settled) {
                settled = true;
                resolve();
            } }, 5000);
        });
        return job;
    }
    /** IDE helper returning empty object typed as final result (aliases + metadata). */
    typedResult() { return {}; }
}
//# sourceMappingURL=workflow.js.map