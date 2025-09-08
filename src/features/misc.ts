import { ComfyApi } from "../client.js";
import { FeatureBase } from "./base.js";

/** Miscellaneous endpoints (extensions list, embeddings with legacy fallback). */
export class MiscFeature extends FeatureBase {
  constructor(client: ComfyApi) {
    super(client);
  }

  /**
   * Retrieves a list of extension URLs.
   * @returns {Promise<string[]>} A list of extension URLs.
   */
  async getExtensions(): Promise<string[]> {
    const response = await this.client.fetchApi("/extensions");
    return response.json();
  }

  /**
   * Retrieves a list of embedding names.
   * @returns {Promise<string[]>} A list of embedding names.
   */
  async getEmbeddings(): Promise<string[]> {
    let results: string[] | undefined = undefined;
    try {
      const response = await this.client.fetchApi("/api/embeddings?page_size=100");
      const data = await response.json();
      if (data && data.items) {
        results = data.items.map((model: any) => model.model_name);
      } else {
        if (data && Array.isArray(data)) {
          results = data;
        }
      }
    } catch (error: any) {
      console.error("[ComfyUI] Error fetching embeddings:", error);
    }
    if (!results) {
      // Fallback to the legacy format
      try {
        const response = await this.client.fetchApi("/embeddings");
        return response.json();
      } catch (e: any) {
        console.error("[ComfyUI] Error fetching embeddings:", e);
      }
    }
    if (!results) {
      results = [];
    }
    return results;
  }
}
