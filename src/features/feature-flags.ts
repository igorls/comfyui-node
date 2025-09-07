import { ComfyApi } from "../client";
import { FeatureBase } from "./base";

export interface ServerFeatureFlags {
  [key: string]: boolean | string | number | object | null;
}

/**
 * Access server feature flags exposed at /features
 */
export class FeatureFlagsFeature extends FeatureBase {
  constructor(client: ComfyApi) {
    super(client);
  }

  async getServerFeatures(): Promise<ServerFeatureFlags> {
    const res = await this.client.fetchApi("/features");
    if (!res.ok) {
      throw new Error(`Failed to fetch feature flags: ${res.status}`);
    }
    return res.json();
  }

  async checkSupported(): Promise<void> {
    try {
      await this.getServerFeatures();
      this.isSupported = true;
    } catch {
      this.isSupported = false;
    }
  }
}