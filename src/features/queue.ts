import { ComfyApi } from "../client.js";
import { QueueManageResponse, QueuePromptResponse } from "../types/api.js";
import { buildEnqueueFailedError } from "../utils/response-error.js";
import { FeatureBase } from "./base.js";

/**
 * Queue & execution control endpoints (enqueue / append / interrupt).
 * Emits structured enqueue errors with detailed diagnostics.
 */
export class QueueFeature extends FeatureBase {
  constructor(client: ComfyApi) {
    super(client);
  }

  /**
   * Enqueue a workflow for execution.
   * @param number Explicit queue position: `null` append (default), `-1` front, `0` auto, positive integer index.
   * @param workflow Serialized workflow / graph JSON.
   */
  async queuePrompt(number: number | null, workflow: object): Promise<QueuePromptResponse> {

    const body = {
      client_id: this.client.id,
      prompt: workflow,
      extra_data: {}
    } as any;

    if (this.client.comfyOrgApiKey) {
      body.extra_data["api_key_comfy_org"] = this.client.comfyOrgApiKey;
    }

    if (number !== null) {
      if (number === -1) {
        body["front"] = true;
      } else if (number !== 0) {
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
  async appendPrompt(workflow: object): Promise<QueuePromptResponse> {
    try {
      return await this.queuePrompt(null, workflow);
    } catch (e: any) {
      this.client.dispatchEvent(new CustomEvent("queue_error", { detail: e }));
      throw e;
    }
  }

  /**
   * Interrupt an in‑flight prompt by id (or all if omitted depending on server semantics).
   */
  async interrupt(promptId?: string): Promise<void> {
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

  /**
   * Cancel a pending prompt by id. This does not interrupt a currently running prompt.
   */
  async cancelPrompt(promptId: string): Promise<QueueManageResponse> {
    return this.cancelPrompts([promptId]);
  }

  /**
   * Cancel pending prompts by id. Maps to ComfyUI's queue management endpoint.
   */
  async cancelPrompts(promptIds: string[]): Promise<QueueManageResponse> {
    const response = await this.client.fetchApi("/queue", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ delete: promptIds })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(`Failed to cancel prompts: ${error.error || error.message || response.statusText}`);
    }

    return response.json().catch(() => ({ deleted: promptIds }));
  }

  /**
   * Clear all pending prompts from the queue. Does not interrupt the running prompt.
   */
  async clearPending(): Promise<QueueManageResponse> {
    const response = await this.client.fetchApi("/queue", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ clear: true })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(`Failed to clear pending prompts: ${error.error || error.message || response.statusText}`);
    }

    return response.json().catch(() => ({ cleared: true }));
  }
}
