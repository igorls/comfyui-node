/**
 * Enum representing the installation state of an extension
 */
export var EInstallationState;
(function (EInstallationState) {
    /**
     * Extension is not installed
     */
    EInstallationState["NOT_INSTALLED"] = "not-installed";
    /**
     * Extension is installed
     */
    EInstallationState["INSTALLED"] = "installed";
})(EInstallationState || (EInstallationState = {}));
/**
 * Enum representing the model types in ComfyUI Manager
 */
var EModelType;
(function (EModelType) {
    /**
     * Checkpoint model type
     */
    EModelType["CHECKPOINT"] = "checkpoint";
    /**
     * Unclip model type
     */
    EModelType["UNCLIP"] = "unclip";
    /**
     * CLIP model type
     */
    EModelType["CLIP"] = "clip";
    /**
     * VAE model type
     */
    EModelType["VAE"] = "VAE";
    /**
     * LORA model type
     */
    EModelType["LORA"] = "lora";
    /**
     * T2I Adapter model type
     */
    EModelType["T2I_ADAPTER"] = "T2I-Adapter";
    /**
     * T2I Style model type
     */
    EModelType["T2I_STYLE"] = "T2I-Style";
    /**
     * ControlNet model type
     */
    EModelType["CONTROLNET"] = "controlnet";
    /**
     * CLIP Vision model type
     */
    EModelType["CLIP_VISION"] = "clip_vision";
    /**
     * GLIGEN model type
     */
    EModelType["GLIGEN"] = "gligen";
    /**
     * Upscale model type
     */
    EModelType["UPSCALE"] = "upscale";
    /**
     * Embeddings model type
     */
    EModelType["EMBEDDINGS"] = "embeddings";
    /**
     * Other model type
     */
    EModelType["ETC"] = "etc";
})(EModelType || (EModelType = {}));
/**
 * Enum representing the installation types in ComfyUI Manager
 */
export var EInstallType;
(function (EInstallType) {
    /**
     * Install via git clone
     */
    EInstallType["GIT_CLONE"] = "git-clone";
    /**
     * Install via copy
     */
    EInstallType["COPY"] = "copy";
    /**
     * Install via CNR (ComfyUI Node Registry)
     */
    EInstallType["CNR"] = "cnr";
    /**
     * Install via unzip
     */
    EInstallType["UNZIP"] = "unzip";
})(EInstallType || (EInstallType = {}));
/**
 * Enum representing the extension update check results in ComfyUI Manager
 */
export var EExtensionUpdateCheckResult;
(function (EExtensionUpdateCheckResult) {
    /**
     * No update available
     */
    EExtensionUpdateCheckResult[EExtensionUpdateCheckResult["NO_UPDATE"] = 0] = "NO_UPDATE";
    /**
     * Update available
     */
    EExtensionUpdateCheckResult[EExtensionUpdateCheckResult["UPDATE_AVAILABLE"] = 1] = "UPDATE_AVAILABLE";
    /**
     * Update check failed
     */
    EExtensionUpdateCheckResult[EExtensionUpdateCheckResult["FAILED"] = 2] = "FAILED";
})(EExtensionUpdateCheckResult || (EExtensionUpdateCheckResult = {}));
/**
 * Enum representing the update results in ComfyUI Manager
 */
export var EUpdateResult;
(function (EUpdateResult) {
    /**
     * No changes made
     */
    EUpdateResult[EUpdateResult["UNCHANGED"] = 0] = "UNCHANGED";
    /**
     * Update successful
     */
    EUpdateResult[EUpdateResult["SUCCESS"] = 1] = "SUCCESS";
    /**
     * Update failed
     */
    EUpdateResult[EUpdateResult["FAILED"] = 2] = "FAILED";
})(EUpdateResult || (EUpdateResult = {}));
//# sourceMappingURL=manager.js.map