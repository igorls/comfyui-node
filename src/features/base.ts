import { ComfyApi } from "../client";

export class FeatureBase {
  public isSupported: boolean = false;

  constructor(protected client: ComfyApi) {}

  public destroy() {
    // Base destroy method
  }

  public async checkSupported(): Promise<void> {
    // Base checkSupported method
  }
}
