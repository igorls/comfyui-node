import { FeatureBase } from "./base.js";
/** Experimental model browsing + preview retrieval. */
export class ModelFeature extends FeatureBase {
    constructor(client) {
        super(client);
    }
    /**
     * Retrieves a list of all available model folders.
     * @experimental API that may change in future versions
     * @returns A promise that resolves to an array of ModelFolder objects.
     */
    async getModelFolders() {
        try {
            const response = await this.client.fetchApi("/experiment/models");
            if (!response.ok) {
                throw new Error(`Failed to fetch model folders: ${response.status} ${response.statusText}`);
            }
            return response.json();
        }
        catch (error) {
            throw error;
        }
    }
    /**
     * Retrieves a list of all model files in a specific folder.
     * @experimental API that may change in future versions
     * @param folder - The name of the model folder.
     * @returns A promise that resolves to an array of ModelFile objects.
     */
    async getModelFiles(folder) {
        try {
            const response = await this.client.fetchApi(`/experiment/models/${encodeURIComponent(folder)}`);
            if (!response.ok) {
                throw new Error(`Failed to fetch model files: ${response.status} ${response.statusText}`);
            }
            return response.json();
        }
        catch (error) {
            throw error;
        }
    }
    /**
     * Retrieves a preview image for a specific model file.
     * @experimental API that may change in future versions
     * @param folder - The name of the model folder.
     * @param pathIndex - The index of the folder path where the file is stored.
     * @param filename - The name of the model file.
     * @returns A promise that resolves to a ModelPreviewResponse object containing the preview image data.
     */
    async getModelPreview(folder, pathIndex, filename) {
        try {
            const response = await this.client.fetchApi(`/experiment/models/preview/${encodeURIComponent(folder)}/${pathIndex}/${encodeURIComponent(filename)}`);
            if (!response.ok) {
                throw new Error(`Failed to fetch model preview: ${response.status} ${response.statusText}`);
            }
            const contentType = response.headers.get("content-type") || "image/webp";
            const body = await response.arrayBuffer();
            return {
                body,
                contentType
            };
        }
        catch (error) {
            throw error;
        }
    }
    /**
     * Creates a URL for a model preview image.
     * @experimental API that may change in future versions
     * @param folder - The name of the model folder.
     * @param pathIndex - The index of the folder path where the file is stored.
     * @param filename - The name of the model file.
     * @returns The URL string for the model preview.
     */
    getModelPreviewUrl(folder, pathIndex, filename) {
        return this.client.apiURL(`/experiment/models/preview/${encodeURIComponent(folder)}/${pathIndex}/${encodeURIComponent(filename)}`);
    }
}
//# sourceMappingURL=model.js.map