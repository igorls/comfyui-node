import { hashWorkflow } from "../pool/utils/hash.js";
class TinyEmitter {
    listeners = new Map();
    on(evt, fn) {
        if (!this.listeners.has(evt))
            this.listeners.set(evt, new Set());
        this.listeners.get(evt).add(fn);
        return () => this.off(evt, fn);
    }
    off(evt, fn) {
        this.listeners.get(evt)?.delete(fn);
    }
    emit(evt, ...args) {
        this.listeners.get(evt)?.forEach(fn => {
            try {
                fn(...args);
            }
            catch {
            }
        });
    }
    removeAll() {
        this.listeners.clear();
    }
}
export class WorkflowJob {
    emitter = new TinyEmitter();
    donePromise;
    doneResolve;
    doneReject;
    lastProgressPct = -1;
    constructor() {
        this.donePromise = new Promise((res, rej) => {
            this.doneResolve = res;
            this.doneReject = rej;
        });
        // Prevent unhandled rejection warnings by attaching a catch handler
        // The actual error handling happens when user calls done()
        this.donePromise.catch(() => {
        });
    }
    on(evt, fn) {
        this.emitter.on(evt, fn);
        return this;
    }
    off(evt, fn) {
        this.emitter.off(evt, fn);
        return this;
    }
    /** Await final mapped outputs */
    done() {
        return this.donePromise;
    }
    _emit(evt, ...args) {
        this.emitter.emit(evt, ...args);
    }
    _finish(data) {
        this.doneResolve(data);
        this.emitter.emit("finished", data, data._promptId);
    }
    _fail(err, promptId) {
        this.doneReject(err);
        this.emitter.emit("failed", err, promptId);
    }
}
export class Workflow {
    json;
    outputNodeIds = [];
    outputAliases = {}; // nodeId -> alias
    bypassedNodes = []; // nodes to bypass during execution
    // Pending assets to upload before execution
    _pendingImageInputs = [];
    _pendingFolderFiles = [];
    /** Structural hash of the workflow JSON for compatibility tracking in failover scenarios */
    structureHash;
    static from(data, opts) {
        if (typeof data === "string") {
            try {
                const parsed = JSON.parse(data);
                return new Workflow(parsed, opts);
            }
            catch (e) {
                throw new Error("Failed to parse workflow JSON string", { cause: e });
            }
        }
        return new Workflow(structuredClone(data), opts);
    }
    constructor(json, opts) {
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
    static fromAugmented(data, opts) {
        return Workflow.from(data, opts);
    }
    /** Set a nested input path on a node e.g. set('9.inputs.text','hello') */
    set(path, value) {
        const keys = path.split(".");
        let cur = this.json;
        for (let i = 0; i < keys.length - 1; i++) {
            if (cur[keys[i]] === undefined)
                cur[keys[i]] = {};
            cur = cur[keys[i]];
        }
        cur[keys[keys.length - 1]] = value;
        return this;
    }
    /** Attach a single image buffer to a node input (e.g., LoadImage.image). Will upload on run() then set the input to the filename. */
    attachImage(nodeId, inputName, data, fileName, opts) {
        const blob = toBlob(data, fileName);
        this._pendingImageInputs.push({
            nodeId: String(nodeId),
            inputName,
            blob,
            fileName,
            subfolder: opts?.subfolder,
            override: opts?.override
        });
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
        if (typeof a === "string") {
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
                catch {
                }
            }
            else {
                alias = String(a);
                nodeId = String(b);
            }
        }
        else {
            // single param variant: maybe "alias:node" or just node
            if (a.includes(":")) {
                const [al, id] = a.split(":");
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
    updateHash() {
        this.structureHash = hashWorkflow(this.json);
        return this;
    }
    /** IDE helper returning empty object typed as final result (aliases + metadata). */
    typedResult() {
        return {};
    }
    /** Get the raw workflow JSON structure. */
    toJSON() {
        return structuredClone(this.json);
    }
    /** Upload pending images to client */
    async uploadAssets(api) {
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
    }
}
// Helper: normalize to Blob for upload
function toBlob(src, fileName) {
    if (src instanceof Blob)
        return src;
    // Normalize everything to a plain ArrayBuffer for reliable BlobPart typing
    let ab;
    if (typeof Buffer !== "undefined" && src instanceof Buffer) {
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
    if (n.endsWith(".png"))
        return "image/png";
    if (n.endsWith(".jpg") || n.endsWith(".jpeg"))
        return "image/jpeg";
    if (n.endsWith(".webp"))
        return "image/webp";
    return undefined;
}
//# sourceMappingURL=workflow.js.map