import { ComfyApi } from "../client.js";
import {
  Asset,
  AssetCreated,
  AssetUpdate,
  AssetUpdated,
  CreateAssetFromHashOptions,
  ListAssetsOptions,
  ListAssetsResponse,
  TagsModificationResponse,
  UploadAssetOptions
} from "../types/api.js";
import { FeatureBase } from "./base.js";

/** Cloud Assets API helpers. */
export class AssetsFeature extends FeatureBase {
  constructor(client: ComfyApi) {
    super(client);
  }

  override async checkSupported(): Promise<boolean> {
    try {
      const response = await this.client.fetchApi("/api/assets?limit=1");
      this.isSupported = response.ok;
      return this.isSupported;
    } catch {
      this.isSupported = false;
      return false;
    }
  }

  async listAssets(options: ListAssetsOptions = {}): Promise<ListAssetsResponse> {
    const params = new URLSearchParams();
    setCsv(params, "include_tags", options.include_tags);
    setCsv(params, "exclude_tags", options.exclude_tags);

    if (options.name_contains) params.set("name_contains", options.name_contains);
    if (options.metadata_filter) {
      params.set(
        "metadata_filter",
        typeof options.metadata_filter === "string" ? options.metadata_filter : JSON.stringify(options.metadata_filter)
      );
    }
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.offset !== undefined) params.set("offset", String(options.offset));
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.sort) params.set("sort", options.sort);
    if (options.order) params.set("order", options.order);
    if (options.include_public !== undefined) params.set("include_public", String(options.include_public));

    const query = params.toString();
    const response = await this.client.fetchApi(query ? `/api/assets?${query}` : "/api/assets");
    return readJsonOrThrow<ListAssetsResponse>(response, "Failed to list assets");
  }

  async getAsset(id: string): Promise<Asset | null> {
    const response = await this.client.fetchApi(`/api/assets/${encodeURIComponent(id)}`);
    if (response.status === 404) {
      return null;
    }
    return readJsonOrThrow<Asset>(response, "Failed to fetch asset");
  }

  async uploadAsset(file: Buffer | Blob, fileName: string, options: UploadAssetOptions = {}): Promise<AssetCreated> {
    const formData = new FormData();
    const fileBlob: Blob = Buffer.isBuffer(file) ? new Blob([new Uint8Array(file)]) : file;
    formData.append("file", fileBlob, options.name ?? fileName);

    for (const tag of options.tags ?? []) {
      formData.append("tags", tag);
    }
    if (options.id) formData.append("id", options.id);
    if (options.preview_id) formData.append("preview_id", options.preview_id);
    if (options.name) formData.append("name", options.name);
    if (options.mime_type) formData.append("mime_type", options.mime_type);
    if (options.user_metadata) {
      formData.append(
        "user_metadata",
        typeof options.user_metadata === "string" ? options.user_metadata : JSON.stringify(options.user_metadata)
      );
    }

    const response = await this.client.fetchApi("/api/assets", {
      method: "POST",
      body: formData
    });
    return readJsonOrThrow<AssetCreated>(response, "Failed to upload asset");
  }

  async createAssetFromHash(options: CreateAssetFromHashOptions): Promise<AssetCreated> {
    const response = await this.client.fetchApi("/api/assets/from-hash", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(options)
    });
    return readJsonOrThrow<AssetCreated>(response, "Failed to create asset reference");
  }

  async updateAsset(id: string, update: AssetUpdate): Promise<AssetUpdated> {
    const response = await this.client.fetchApi(`/api/assets/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(update)
    });
    return readJsonOrThrow<AssetUpdated>(response, "Failed to update asset");
  }

  async deleteAsset(id: string): Promise<void> {
    const response = await this.client.fetchApi(`/api/assets/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });

    if (!response.ok && response.status !== 204) {
      const error = await response.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(`Failed to delete asset: ${error.error || error.message || response.statusText}`);
    }
  }

  async addTags(id: string, tags: string[]): Promise<TagsModificationResponse> {
    return this.modifyTags(id, tags, "POST", "Failed to add asset tags");
  }

  async removeTags(id: string, tags: string[]): Promise<TagsModificationResponse> {
    return this.modifyTags(id, tags, "DELETE", "Failed to remove asset tags");
  }

  private async modifyTags(
    id: string,
    tags: string[],
    method: "POST" | "DELETE",
    errorMessage: string
  ): Promise<TagsModificationResponse> {
    const response = await this.client.fetchApi(`/api/assets/${encodeURIComponent(id)}/tags`, {
      method,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ tags })
    });
    return readJsonOrThrow<TagsModificationResponse>(response, errorMessage);
  }
}

function setCsv(params: URLSearchParams, key: string, values?: string[]) {
  if (values?.length) {
    params.set(key, values.join(","));
  }
}

async function readJsonOrThrow<T>(response: Response, message: string): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(`${message}: ${error.error || error.message || response.statusText}`);
  }
  return response.json();
}
