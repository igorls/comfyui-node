import { ComfyApi } from "../client.js";
import { QueuePromptResponse } from "../types/api.js";
import { FeatureBase } from "./base.js";
/**
 * Queue & execution control endpoints (enqueue / append / interrupt).
 * Emits structured enqueue errors with detailed diagnostics.
 */
export declare class QueueFeature extends FeatureBase {
    constructor(client: ComfyApi);
    /**
     * Enqueue a workflow for execution.
     * @param number Explicit queue position: `null` append (default), `-1` front, `0` auto, positive integer index.
     * @param workflow Serialized workflow / graph JSON.
     */
    queuePrompt(number: number | null, workflow: object): Promise<QueuePromptResponse>;
    /** Shorthand for append enqueue (position null). */
    appendPrompt(workflow: object): Promise<QueuePromptResponse>;
    /**
     * Interrupt an in‑flight prompt by id (or all if omitted depending on server semantics).
     */
    interrupt(promptId?: string): Promise<void>;
}
//# sourceMappingURL=queue.d.ts.map