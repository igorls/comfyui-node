import { ComfyApi } from "../client.js";

export class FeatureBase {
  public isSupported: boolean = false;
  protected client: ComfyApi;

  constructor(client: ComfyApi) {
    this.client = client;
  }

  public destroy() {
    // Base destroy method
  }

  public async checkSupported(): Promise<boolean> {
    // Base checkSupported method does nothing; concrete features override.
    return this.isSupported;
  }
}
