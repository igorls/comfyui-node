import { createHash } from "node:crypto";

/**
 * List of input field names that represent dynamic runtime parameters.
 * These should be excluded from the workflow hash so that the same workflow
 * structure with different prompts/seeds/resolutions maps to the same hash.
 */
const DYNAMIC_INPUT_FIELDS = new Set([
  // Random seeds
  'seed',
  'noise_seed',
  'control_after_generate',
  
  // Text inputs (prompts, negative prompts, etc.)
  'text',
  'prompt',
  'positive',
  'negative',
  'text_g',
  'text_l',
  
  // Image dimensions
  'width',
  'height',
  'target_width',
  'target_height',
  'empty_latent_width',
  'empty_latent_height',
  
  // Batch parameters
  'batch_size',
  'num_images',
  
  // Sampling parameters that users frequently adjust
  'steps',
  'cfg',
  'denoise',
  'start_at_step',
  'end_at_step',
  
  // File paths that may change
  'image',
  'upload',
  'filename_prefix',
]);

/**
 * Deterministically hash a workflow payload based on its STRUCTURE, not dynamic parameters.
 * This groups workflows with the same node graph but different prompts/seeds/resolutions together,
 * so that failover strategies can properly track which clients are compatible with a workflow type.
 */
export function hashWorkflow(workflow: object): string {
  const json = JSON.stringify(workflow, (key, value) => {
    // Exclude dynamic input fields from the hash
    if (DYNAMIC_INPUT_FIELDS.has(key)) {
      return undefined; // Exclude this field
    }
    
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
