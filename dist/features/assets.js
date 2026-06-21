import { FeatureBase } from "./base.js";
/** Cloud Assets API helpers. */
export class AssetsFeature extends FeatureBase {
    constructor(client) {
        super(client);
    }
    async checkSupported() {
        try {
            const response = await this.client.fetchApi("/api/assets?limit=1");
            this.isSupported = response.ok;
            return this.isSupported;
        }
        catch {
            this.isSupported = false;
            return false;
        }
    }
    async listAssets(options = {}) {
        const params = new URLSearchParams();
        setCsv(params, "include_tags", options.include_tags);
        setCsv(params, "exclude_tags", options.exclude_tags);
        if (options.name_contains)
            params.set("name_contains", options.name_contains);
        if (options.metadata_filter) {
            params.set("metadata_filter", typeof options.metadata_filter === "string" ? options.metadata_filter : JSON.stringify(options.metadata_filter));
        }
        if (options.limit !== undefined)
            params.set("limit", String(options.limit));
        if (options.offset !== undefined)
            params.set("offset", String(options.offset));
        if (options.cursor)
            params.set("cursor", options.cursor);
        if (options.sort)
            params.set("sort", options.sort);
        if (options.order)
            params.set("order", options.order);
        if (options.include_public !== undefined)
            params.set("include_public", String(options.include_public));
        const query = params.toString();
        const response = await this.client.fetchApi(query ? `/api/assets?${query}` : "/api/assets");
        return readJsonOrThrow(response, "Failed to list assets");
    }
    async getAsset(id) {
        const response = await this.client.fetchApi(`/api/assets/${encodeURIComponent(id)}`);
        if (response.status === 404) {
            return null;
        }
        return readJsonOrThrow(response, "Failed to fetch asset");
    }
    async uploadAsset(file, fileName, options = {}) {
        const formData = new FormData();
        const fileBlob = Buffer.isBuffer(file) ? new Blob([new Uint8Array(file)]) : file;
        formData.append("file", fileBlob, options.name ?? fileName);
        for (const tag of options.tags ?? []) {
            formData.append("tags", tag);
        }
        if (options.id)
            formData.append("id", options.id);
        if (options.preview_id)
            formData.append("preview_id", options.preview_id);
        if (options.name)
            formData.append("name", options.name);
        if (options.mime_type)
            formData.append("mime_type", options.mime_type);
        if (options.user_metadata) {
            formData.append("user_metadata", typeof options.user_metadata === "string" ? options.user_metadata : JSON.stringify(options.user_metadata));
        }
        const response = await this.client.fetchApi("/api/assets", {
            method: "POST",
            body: formData
        });
        return readJsonOrThrow(response, "Failed to upload asset");
    }
    async createAssetFromHash(options) {
        const response = await this.client.fetchApi("/api/assets/from-hash", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(options)
        });
        return readJsonOrThrow(response, "Failed to create asset reference");
    }
    async updateAsset(id, update) {
        const response = await this.client.fetchApi(`/api/assets/${encodeURIComponent(id)}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(update)
        });
        return readJsonOrThrow(response, "Failed to update asset");
    }
    async deleteAsset(id) {
        const response = await this.client.fetchApi(`/api/assets/${encodeURIComponent(id)}`, {
            method: "DELETE"
        });
        if (!response.ok && response.status !== 204) {
            const error = await response.json().catch(() => ({ error: "Unknown error" }));
            throw new Error(`Failed to delete asset: ${error.error || error.message || response.statusText}`);
        }
    }
    async addTags(id, tags) {
        return this.modifyTags(id, tags, "POST", "Failed to add asset tags");
    }
    async removeTags(id, tags) {
        return this.modifyTags(id, tags, "DELETE", "Failed to remove asset tags");
    }
    async modifyTags(id, tags, method, errorMessage) {
        const response = await this.client.fetchApi(`/api/assets/${encodeURIComponent(id)}/tags`, {
            method,
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ tags })
        });
        return readJsonOrThrow(response, errorMessage);
    }
}
function setCsv(params, key, values) {
    if (values?.length) {
        params.set(key, values.join(","));
    }
}
async function readJsonOrThrow(response, message) {
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(`${message}: ${error.error || error.message || response.statusText}`);
    }
    return response.json();
}
//# sourceMappingURL=assets.js.map