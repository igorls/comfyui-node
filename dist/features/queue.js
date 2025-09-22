import { buildEnqueueFailedError } from "../utils/response-error.js";
import { FeatureBase } from "./base.js";
/**
 * Queue & execution control endpoints (enqueue / append / interrupt).
 * Emits structured enqueue errors with detailed diagnostics.
 */
export class QueueFeature extends FeatureBase {
    constructor(client) {
        super(client);
    }
    /**
     * Enqueue a workflow for execution.
     * @param number Explicit queue position: `null` append (default), `-1` front, `0` auto, positive integer index.
     * @param workflow Serialized workflow / graph JSON.
     */
    async queuePrompt(number, workflow) {
        const body = {
            client_id: this.client.id,
            prompt: workflow,
            extra_data: {}
        };
        if (this.client.comfyOrgApiKey) {
            body.extra_data["api_key_comfy_org"] = this.client.comfyOrgApiKey;
        }
        if (number !== null) {
            if (number === -1) {
                body["front"] = true;
            }
            else if (number !== 0) {
                body["number"] = number;
            }
        }
        const response = await this.client.fetchApi("/prompt", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });
        if (response.status !== 200) {
            const err = await buildEnqueueFailedError(response);
            this.client.dispatchEvent(new CustomEvent("error", { detail: err }));
            throw err;
        }
        return response.json();
    }
    /** Shorthand for append enqueue (position null). */
    async appendPrompt(workflow) {
        try {
            return await this.queuePrompt(null, workflow);
        }
        catch (e) {
            this.client.dispatchEvent(new CustomEvent("queue_error", { detail: e }));
            throw e;
        }
    }
    /**
     * Interrupt an in‑flight prompt by id (or all if omitted depending on server semantics).
     */
    async interrupt(promptId) {
        await this.client.fetchApi("/interrupt", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                prompt_id: promptId
            })
        });
    }
}
//# sourceMappingURL=queue.js.map