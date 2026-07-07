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
export declare function hashWorkflow(workflow: object): string;
//# sourceMappingURL=hash.d.ts.map