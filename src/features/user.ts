import { ComfyApi } from "../client";

import { FeatureBase } from "./base";

export class UserFeature extends FeatureBase {
  constructor(client: ComfyApi) {
    super(client);
  }

  /**
   * Retrieves user configuration data.
   * @returns {Promise<any>} The user configuration data.
   */
  async getUserConfig(): Promise<any> {
    const response = await this.client.fetchApi("/users");
    return response.json();
  }

  /**
   * Creates a new user.
   * @param {string} username The username of the new user.
   * @returns {Promise<Response>} The response from the API.
   */
  async createUser(username: string): Promise<Response> {
    return await this.client.fetchApi("/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username })
    });
  }

  /**
   * Retrieves all setting values for the current user.
   * @returns {Promise<any>} A dictionary of setting id to value.
   */
  async getSettings(): Promise<any> {
    const response = await this.client.fetchApi("/settings");
    return response.json();
  }

  /**
   * Retrieves a specific setting for the current user.
   * @param {string} id The id of the setting to fetch.
   * @returns {Promise<any>} The setting value.
   */
  async getSetting(id: string): Promise<any> {
    const response = await this.client.fetchApi(`/settings/${encodeURIComponent(id)}`);
    return response.json();
  }

  /**
   * Stores a dictionary of settings for the current user.
   * @param {Record<string, unknown>} settings Dictionary of setting id to value to save.
   * @returns {Promise<void>}
   */
  async storeSettings(settings: Record<string, unknown>): Promise<void> {
    await this.client.fetchApi(`/settings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(settings)
    });
  }

  /**
   * Stores a specific setting for the current user.
   * @param {string} id The id of the setting to update.
   * @param {unknown} value The value of the setting.
   * @returns {Promise<void>}
   */
  async storeSetting(id: string, value: unknown): Promise<void> {
    await this.client.fetchApi(`/settings/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(value)
    });
  }
}
