import { createHash } from "node:crypto";

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
export function hashWorkflow(workflow: object): string {
  const json = JSON.stringify(workflow, (_key, value) => {
    // Sort object keys for deterministic ordering
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.keys(value)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = (value as Record<string, unknown>)[key];
          return acc;
        }, {});
    }
    return value;
  });
  return createHash("sha256").update(json).digest("hex");
}
