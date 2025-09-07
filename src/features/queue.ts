import { ComfyApi } from "../client";
import { QueuePromptResponse } from "../types/api";
import { buildEnqueueFailedError } from "../utils/response-error";

import { FeatureBase } from "./base";

export class QueueFeature extends FeatureBase {
  constructor(client: ComfyApi) {
    super(client);
  }

  /**
   * Queues a prompt for processing.
   * @param {number} number The index at which to queue the prompt. using NULL will append to the end of the queue.
   * @param {object} workflow Additional workflow data.
   * @returns {Promise<QueuePromptResponse>} The response from the API.
   */
  async queuePrompt(number: number | null, workflow: object): Promise<QueuePromptResponse> {
    const body = {
      client_id: this.client.id,
      prompt: workflow
    } as any;

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

  /**
   * Appends a prompt to the workflow queue.
   *
   * @param {object} workflow Additional workflow data.
   * @returns {Promise<QueuePromptResponse>} The response from the API.
   */
  async appendPrompt(workflow: object): Promise<QueuePromptResponse> {
    try {
      return await this.queuePrompt(null, workflow);
    } catch (e: any) {
      this.client.dispatchEvent(new CustomEvent("queue_error", { detail: e }));
      throw e;
    }
  }

  /**
   * Interrupts the execution of the running prompt.
   * @param {string} [promptId] - The ID of the prompt to interrupt. If not provided, a global interrupt will be triggered.
   * @returns {Promise<void>}
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
}
