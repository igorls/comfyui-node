import { createHash } from "node:crypto";
/**
 * Input values that reference a model / weights / config file determine a
 * client's CAPABILITY — whether a given host actually has that checkpoint,
 * LoRA, VAE, etc. installed — so they are part of the structural identity used
 * for routing and failover. We detect them by file extension, which is
 * node-agnostic (works for custom nodes with arbitrary input names).
 *
 * Note: per-job DATA files (input images/video: .png/.jpg/.mp4) are deliberately
 * excluded — they vary per job and are not a host capability.
 */
const RESOURCE_VALUE = /\.(safetensors|sft|ckpt|pt|pth|bin|gguf|onnx|pkl|npz|vae|yaml|yml)$/i;
/**
 * Deterministically hash a workflow's STRUCTURE, for pools/failover strategies
 * to group related jobs and track which clients can run them.
 *
 * The hash is derived from the workflow's structure, NOT its volatile
 * parameters. It includes:
 *   - each node's id and `class_type`,
 *   - the connection topology (inputs wired as `[sourceNodeId, slotIndex]`),
 *   - the set of input keys, and
 *   - model/resource reference values (checkpoints, LoRAs, VAEs, …) — these are
 *     capability-relevant, so changing a checkpoint DOES change the hash.
 * It excludes prompts, seeds, dimensions, cfg, steps, samplers and other
 * scalar parameters, and node `_meta` (titles). So the same graph run with
 * different prompts / seeds / dimensions produces the SAME hash, while a
 * different graph — or the same graph pointed at a different model — produces a
 * different hash.
 *
 * If you mutate the workflow after construction, call `workflow.updateHash()`.
 *
 * @param workflow - The workflow JSON object (ComfyUI prompt: id → node)
 * @returns SHA256 hash of the normalized workflow structure
 */
export function hashWorkflow(workflow) {
    return createHash("sha256").update(structuralJson(workflow)).digest("hex");
}
/** Build a canonical, value-stable JSON string of a workflow's structure. */
function structuralJson(workflow) {
    const nodes = workflow;
    const canonical = {};
    for (const id of Object.keys(nodes).sort()) {
        const node = nodes[id];
        if (!node || typeof node !== "object" || Array.isArray(node)) {
            canonical[id] = node ?? null; // non-standard entry: keep as-is
            continue;
        }
        const rawInputs = node.inputs && typeof node.inputs === "object" ? node.inputs : {};
        const inputs = {};
        for (const key of Object.keys(rawInputs).sort()) {
            inputs[key] = canonicalInput(rawInputs[key]);
        }
        // node._meta (titles etc.) is display-only and intentionally excluded.
        canonical[id] = { class_type: node.class_type ?? null, inputs };
    }
    return JSON.stringify(canonical);
}
/** Reduce a single input value to its structural/capability contribution. */
function canonicalInput(value) {
    // A connection edge [sourceNodeId, slotIndex] IS topology → keep verbatim.
    if (Array.isArray(value))
        return value;
    // A model/resource filename determines capability → keep the value; any other
    // string (prompts, sampler names, "default", …) is a volatile param → drop it
    // but keep the key present (empty string) so input shape still registers.
    if (typeof value === "string")
        return RESOURCE_VALUE.test(value) ? value : "";
    // Nested object input (rare) → recurse structurally.
    if (value !== null && typeof value === "object") {
        const out = {};
        for (const k of Object.keys(value).sort()) {
            out[k] = canonicalInput(value[k]);
        }
        return out;
    }
    // Volatile scalar (seed, steps, cfg, width/height, denoise, boolean, null) →
    // drop the value, keep a type token so the input's presence/shape registers.
    return value === null ? null : typeof value;
}
//# sourceMappingURL=hash.js.map