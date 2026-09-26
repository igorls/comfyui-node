import { ComfyApi } from "../client.js";
import { NodeDefsResponse } from "../types/api.js";
import { LOAD_CHECKPOINTS_EXTENSION, LOAD_KSAMPLER_EXTENSION, LOAD_LORAS_EXTENSION } from "../constants.js";
import { FeatureBase } from "./base.js";

/** Node definition introspection + model/sampler metadata helpers. */
export class NodeFeature extends FeatureBase {
  constructor(client: ComfyApi) {
    super(client);
  }

  /**
   * Retrieves node object definitions for the graph.
   * @returns {Promise<NodeDefsResponse>} The node definitions.
   */
  async getNodeDefs(nodeName?: string): Promise<NodeDefsResponse | null> {
    const route = `/object_info${nodeName ? `/${nodeName}` : ""}`;
    try {
      const response = await this.client.fetchApi(route);
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
      }
      const text = await response.text();
      if (!text || text.trim().length === 0) return null;
      return JSON.parse(text);
    } catch {
      // Fallback to streaming node:http for large payloads in Bun/Windows environments.
      // Loaded with import() because this package is ESM, where `require` does not exist under Node.
      const fullUrl = this.client.apiURL(route);
      const isHttps = new URL(fullUrl).protocol === "https:";
      const httpLib: { get: typeof import("node:http").get } = isHttps
        ? await import("node:https")
        : await import("node:http");
      return new Promise<NodeDefsResponse | null>((resolve, reject) => {
        const req = httpLib.get(fullUrl, (res: any) => {
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            return reject(new Error(`HTTP error ${res.statusCode}: ${res.statusMessage}`));
          }
          let data = "";
          res.setEncoding("utf-8");
          res.on("data", (chunk: string) => {
            data += chunk;
          });
          res.on("end", () => {
            if (!data || data.trim().length === 0) return resolve(null);
            try {
              resolve(JSON.parse(data));
            } catch (err) {
              reject(err);
            }
          });
        });

        req.on("error", (err: any) => reject(err));
        req.setTimeout(30000, () => {
          req.destroy(new Error("Request timed out"));
        });
      });
    }
  }

  /**
   * Retrieves the checkpoints from the server.
   * @returns A promise that resolves to an array of strings representing the checkpoints.
   */
  async getCheckpoints(): Promise<string[]> {
    const nodeInfo = await this.getNodeDefs(LOAD_CHECKPOINTS_EXTENSION);
    if (!nodeInfo) return [];
    const output = nodeInfo[LOAD_CHECKPOINTS_EXTENSION].input.required?.ckpt_name?.[0];
    if (!output) return [];
    return output as string[];
  }

  /**
   * Retrieves the Loras from the node definitions.
   * @returns A Promise that resolves to an array of strings representing the Loras.
   */
  async getLoras(): Promise<string[]> {
    const nodeInfo = await this.getNodeDefs(LOAD_LORAS_EXTENSION);
    if (!nodeInfo) return [];
    const output = nodeInfo[LOAD_LORAS_EXTENSION].input.required?.lora_name?.[0];
    if (!output) return [];
    return output as string[];
  }

  /**
   * Retrieves the unets/diffusion models from the server.
   */
  async getUnets(): Promise<string[]> {
    const nodeInfo = await this.getNodeDefs("UNETLoader");
    if (!nodeInfo) return [];
    const output = nodeInfo.UNETLoader?.input?.required?.unet_name;
    if (!output) return [];
    return Array.isArray(output[0]) ? (output[0] as string[]) : (output as string[]);
  }

  /**
   * Retrieves the CLIP text encoders from the server.
   */
  async getClips(): Promise<string[]> {
    const nodeInfo = await this.getNodeDefs("CLIPLoader");
    if (!nodeInfo) return [];
    const output = nodeInfo.CLIPLoader?.input?.required?.clip_name;
    if (!output) return [];
    return Array.isArray(output[0]) ? (output[0] as string[]) : (output as string[]);
  }

  /**
   * Retrieves the VAE models from the server.
   */
  async getVaes(): Promise<string[]> {
    const nodeInfo = await this.getNodeDefs("VAELoader");
    if (!nodeInfo) return [];
    const output = nodeInfo.VAELoader?.input?.required?.vae_name;
    if (!output) return [];
    return Array.isArray(output[0]) ? (output[0] as string[]) : (output as string[]);
  }

  /**
   * Retrieves the sampler information.
   * @returns An object containing the sampler and scheduler information.
   */
  async getSamplerInfo() {
    const nodeInfo = await this.getNodeDefs(LOAD_KSAMPLER_EXTENSION);
    if (!nodeInfo) return {};
    const rawSampler = nodeInfo[LOAD_KSAMPLER_EXTENSION]?.input?.required?.sampler_name;
    const rawScheduler = nodeInfo[LOAD_KSAMPLER_EXTENSION]?.input?.required?.scheduler;
    const sampler = Array.isArray(rawSampler?.[0]) ? rawSampler[0] : (Array.isArray(rawSampler) ? rawSampler : []);
    const scheduler = Array.isArray(rawScheduler?.[0]) ? rawScheduler[0] : (Array.isArray(rawScheduler) ? rawScheduler : []);
    return {
      sampler,
      scheduler
    };
  }
}
