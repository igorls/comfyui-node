import { createHash } from "node:crypto";

/**
 * Deterministically hash a workflow payload so failover heuristics can group related jobs.
 */
export function hashWorkflow(workflow: object): string {
  const json = JSON.stringify(workflow, (_key, value) => {
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
