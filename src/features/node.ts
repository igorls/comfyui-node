import { ComfyApi } from "../client";
import { NodeDefsResponse } from "../types/api";
import { LOAD_CHECKPOINTS_EXTENSION, LOAD_KSAMPLER_EXTENSION, LOAD_LORAS_EXTENSION } from "../constants";

import { FeatureBase } from "./base";

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
    const response = await this.client.fetchApi(`/object_info${nodeName ? `/${nodeName}` : ""}`);

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }

    const text = await response.text();

    if (!text || text.trim().length === 0) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch (jsonError) {
      throw jsonError;
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
   * Retrieves the sampler information.
   * @returns An object containing the sampler and scheduler information.
   */
  async getSamplerInfo() {
    const nodeInfo = await this.getNodeDefs(LOAD_KSAMPLER_EXTENSION);
    if (!nodeInfo) return {};
    return {
      sampler: nodeInfo[LOAD_KSAMPLER_EXTENSION].input.required.sampler_name ?? [],
      scheduler: nodeInfo[LOAD_KSAMPLER_EXTENSION].input.required.scheduler ?? []
    };
  }
}
