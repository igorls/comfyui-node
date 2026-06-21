import { ComfyApi } from "../client.js";
import { Asset, AssetCreated, AssetUpdate, AssetUpdated, CreateAssetFromHashOptions, ListAssetsOptions, ListAssetsResponse, TagsModificationResponse, UploadAssetOptions } from "../types/api.js";
import { FeatureBase } from "./base.js";
/** Cloud Assets API helpers. */
export declare class AssetsFeature extends FeatureBase {
    constructor(client: ComfyApi);
    checkSupported(): Promise<boolean>;
    listAssets(options?: ListAssetsOptions): Promise<ListAssetsResponse>;
    getAsset(id: string): Promise<Asset | null>;
    uploadAsset(file: Buffer | Blob, fileName: string, options?: UploadAssetOptions): Promise<AssetCreated>;
    createAssetFromHash(options: CreateAssetFromHashOptions): Promise<AssetCreated>;
    updateAsset(id: string, update: AssetUpdate): Promise<AssetUpdated>;
    deleteAsset(id: string): Promise<void>;
    addTags(id: string, tags: string[]): Promise<TagsModificationResponse>;
    removeTags(id: string, tags: string[]): Promise<TagsModificationResponse>;
    private modifyTags;
}
//# sourceMappingURL=assets.d.ts.map