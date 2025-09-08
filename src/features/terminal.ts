import { ComfyApi } from "../client";

import { FeatureBase } from "./base";

/** Terminal log retrieval & subscription control. */
export class TerminalFeature extends FeatureBase {
  constructor(client: ComfyApi) {
    super(client);
  }

  /**
   * Retrieves the terminal logs from the server.
   */
  async getTerminalLogs(): Promise<{
    entries: Array<{ t: string; m: string }>;
    size: { cols: number; rows: number };
  }> {
    const response = await this.client.fetchApi("/internal/logs/raw");
    return response.json();
  }

  /**
   * Sets the terminal subscription status.
   * Enable will subscribe to terminal logs from the websocket.
   */
  async setTerminalSubscription(subscribe: boolean) {
    this.client.listenTerminal = subscribe;
    await this.client.fetchApi("/internal/logs/subscribe", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        clientId: this.client.id,
        enabled: subscribe
      })
    });
  }
}
