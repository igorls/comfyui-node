export var EInstallationState;
(function (EInstallationState) {
    EInstallationState["NOT_INSTALLED"] = "not-installed";
    EInstallationState["INSTALLED"] = "installed";
})(EInstallationState || (EInstallationState = {}));
var EModelType;
(function (EModelType) {
    EModelType["CHECKPOINT"] = "checkpoint";
    EModelType["UNCLIP"] = "unclip";
    EModelType["CLIP"] = "clip";
    EModelType["VAE"] = "VAE";
    EModelType["LORA"] = "lora";
    EModelType["T2I_ADAPTER"] = "T2I-Adapter";
    EModelType["T2I_STYLE"] = "T2I-Style";
    EModelType["CONTROLNET"] = "controlnet";
    EModelType["CLIP_VISION"] = "clip_vision";
    EModelType["GLIGEN"] = "gligen";
    EModelType["UPSCALE"] = "upscale";
    EModelType["EMBEDDINGS"] = "embeddings";
    EModelType["ETC"] = "etc";
})(EModelType || (EModelType = {}));
export var EInstallType;
(function (EInstallType) {
    EInstallType["GIT_CLONE"] = "git-clone";
    EInstallType["COPY"] = "copy";
    EInstallType["CNR"] = "cnr";
    EInstallType["UNZIP"] = "unzip";
})(EInstallType || (EInstallType = {}));
export var EExtensionUpdateCheckResult;
(function (EExtensionUpdateCheckResult) {
    EExtensionUpdateCheckResult[EExtensionUpdateCheckResult["NO_UPDATE"] = 0] = "NO_UPDATE";
    EExtensionUpdateCheckResult[EExtensionUpdateCheckResult["UPDATE_AVAILABLE"] = 1] = "UPDATE_AVAILABLE";
    EExtensionUpdateCheckResult[EExtensionUpdateCheckResult["FAILED"] = 2] = "FAILED";
})(EExtensionUpdateCheckResult || (EExtensionUpdateCheckResult = {}));
export var EUpdateResult;
(function (EUpdateResult) {
    EUpdateResult[EUpdateResult["UNCHANGED"] = 0] = "UNCHANGED";
    EUpdateResult[EUpdateResult["SUCCESS"] = 1] = "SUCCESS";
    EUpdateResult[EUpdateResult["FAILED"] = 2] = "FAILED";
})(EUpdateResult || (EUpdateResult = {}));
//# sourceMappingURL=manager.js.map