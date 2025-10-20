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
    bypassedNodes = []; // nodes to bypass during execution
    // Pending assets to upload before execution
    _pendingImageInputs = [];
    _pendingFolderFiles = [];
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
    /** Attach a single image buffer to a node input (e.g., LoadImage.image). Will upload on run() then set the input to the filename. */
    attachImage(nodeId, inputName, data, fileName, opts) {
        const blob = toBlob(data, fileName);
        this._pendingImageInputs.push({ nodeId: String(nodeId), inputName, blob, fileName, subfolder: opts?.subfolder, override: opts?.override });
        return this;
    }
    /** Attach multiple files into a server subfolder (useful for LoadImageSetFromFolderNode). */
    attachFolderFiles(subfolder, files, opts) {
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
            // Heuristic: if first arg looks like a node id and second arg looks like an alias, swap
            // Node ids are often numeric strings (e.g., '2'); aliases are non-numeric labels.
            const looksLikeNodeId = (s) => /^\d+$/.test(s) || this.json[s];
            if (looksLikeNodeId(String(a)) && !looksLikeNodeId(String(b))) {
                nodeId = String(a);
                alias = String(b);
                try {
                    console.warn(`Workflow.output called as output(nodeId, alias). Interpreting as output(alias,nodeId): '${alias}:${nodeId}'`);
                }
                catch { }
            }
            else {
                alias = String(a);
                nodeId = String(b);
            }
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
        if (alias) {
            this.outputAliases[nodeId] = alias;
        }
        return this; // typed refinement handled via declaration merging below
    }
    bypass(nodes) {
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
    reinstate(nodes) {
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
        // Upload any pending assets first, then patch JSON inputs
        if (this._pendingFolderFiles.length || this._pendingImageInputs.length) {
            // Upload folder files
            for (const f of this._pendingFolderFiles) {
                await api.ext.file.uploadImage(f.blob, f.fileName, { subfolder: f.subfolder, override: f.override });
            }
            // Upload and set single-image inputs
            for (const it of this._pendingImageInputs) {
                await api.ext.file.uploadImage(it.blob, it.fileName, { subfolder: it.subfolder, override: it.override });
                // Prefer just the filename; many LoadImage nodes look up by filename (subfolder managed server-side)
                this.input(it.nodeId, it.inputName, it.fileName);
            }
            // Clear pending once applied
            this._pendingFolderFiles = [];
            this._pendingImageInputs = [];
        }
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
        // apply bypassed nodes
        if (this.bypassedNodes.length > 0) {
            pb = pb.bypass(this.bypassedNodes);
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
            // Forward preview metadata when available
            .onPreviewMeta((payload) => job._emit('preview_meta', payload))
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
// Helper: normalize to Blob for upload
function toBlob(src, fileName) {
    if (src instanceof Blob)
        return src;
    // Normalize everything to a plain ArrayBuffer for reliable BlobPart typing
    let ab;
    if (typeof Buffer !== 'undefined' && src instanceof Buffer) {
        const u8 = new Uint8Array(src);
        ab = u8.slice(0).buffer;
    }
    else if (src instanceof Uint8Array) {
        const u8 = new Uint8Array(src.byteLength);
        u8.set(src);
        ab = u8.buffer;
    }
    else if (src instanceof ArrayBuffer) {
        ab = src;
    }
    else {
        ab = new ArrayBuffer(0);
    }
    return new Blob([ab], { type: mimeFromName(fileName) });
}
function mimeFromName(name) {
    if (!name)
        return undefined;
    const n = name.toLowerCase();
    if (n.endsWith('.png'))
        return 'image/png';
    if (n.endsWith('.jpg') || n.endsWith('.jpeg'))
        return 'image/jpeg';
    if (n.endsWith('.webp'))
        return 'image/webp';
    return undefined;
}
//# sourceMappingURL=workflow.js.map