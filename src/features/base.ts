import { ComfyApi } from "../client.js";

/**
 * Base class for all ComfyUI features.
 * Provides common functionality and interface for feature implementations.
 */
export class FeatureBase {
  /**
   * Indicates whether the feature is supported by the current client
   */
  public isSupported: boolean = false;
  
  /**
   * The ComfyUI client instance
   */
  protected client: ComfyApi;

  /**
   * Creates a new FeatureBase instance
   * @param client - The ComfyUI client instance
   */
  constructor(client: ComfyApi) {
    this.client = client;
  }

  /**
   * Destroys the feature instance and cleans up resources
   */
  public destroy() {
    // Base destroy method
  }

  /**
   * Checks if the feature is supported by the current client
   * @returns A promise that resolves to a boolean indicating whether the feature is supported
   */
  public async checkSupported(): Promise<boolean> {
    // Base checkSupported method does nothing; concrete features override.
    return this.isSupported;
  }
}
