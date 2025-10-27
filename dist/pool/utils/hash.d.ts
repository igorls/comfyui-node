/**
 * Deterministically hash a workflow JSON structure (node graph, connections, node types).
 * This hash is computed on workflow initialization and can be used by failover strategies
 * to group related jobs and track client compatibility.
 *
 * The hash is based on the STRUCTURE of the workflow (nodes, connections, class types),
 * NOT on parameter values. This ensures that running the same workflow with different
 * prompts, seeds, or dimensions produces the same hash.
 *
 * If you modify the workflow structure AFTER initialization (e.g., changing a checkpoint),
 * call workflow.updateHash() to recalculate the hash.
 *
 * @param workflow - The workflow JSON object
 * @returns SHA256 hash of the normalized workflow structure
 */
export declare function hashWorkflow(workflow: object): string;
//# sourceMappingURL=hash.d.ts.map