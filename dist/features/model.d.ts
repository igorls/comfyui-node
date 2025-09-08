import { ComfyApi } from "../client.js";
import { ModelFile, ModelFolder, ModelPreviewResponse } from "../types/api.js";
import { FeatureBase } from "./base.js";
/** Experimental model browsing + preview retrieval. */
export declare class ModelFeature extends FeatureBase {
    constructor(client: ComfyApi);
    /**
     * Retrieves a list of all available model folders.
     * @experimental API that may change in future versions
     * @returns A promise that resolves to an array of ModelFolder objects.
     */
    getModelFolders(): Promise<ModelFolder[]>;
    /**
     * Retrieves a list of all model files in a specific folder.
     * @experimental API that may change in future versions
     * @param folder - The name of the model folder.
     * @returns A promise that resolves to an array of ModelFile objects.
     */
    getModelFiles(folder: string): Promise<ModelFile[]>;
    /**
     * Retrieves a preview image for a specific model file.
     * @experimental API that may change in future versions
     * @param folder - The name of the model folder.
     * @param pathIndex - The index of the folder path where the file is stored.
     * @param filename - The name of the model file.
     * @returns A promise that resolves to a ModelPreviewResponse object containing the preview image data.
     */
    getModelPreview(folder: string, pathIndex: number, filename: string): Promise<ModelPreviewResponse>;
    /**
     * Creates a URL for a model preview image.
     * @experimental API that may change in future versions
     * @param folder - The name of the model folder.
     * @param pathIndex - The index of the folder path where the file is stored.
     * @param filename - The name of the model file.
     * @returns The URL string for the model preview.
     */
    getModelPreviewUrl(folder: string, pathIndex: number, filename: string): string;
}
//# sourceMappingURL=model.d.ts.map