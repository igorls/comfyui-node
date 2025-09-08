import { TDefaultUI, EExtensionUpdateCheckResult, EUpdateResult, IExtensionInfo, TPreviewMethod, IInstallExtensionRequest, EInstallType, IExtensionUninstallRequest, IExtensionUpdateRequest, IExtensionActiveRequest, IModelInstallRequest, INodeMapItem } from "../types/manager.js";
import { AbstractFeature } from "./abstract.js";
export interface FetchOptions extends RequestInit {
    headers?: {
        [key: string]: string;
    };
}
/** ComfyUI-Manager extension operations (extension lifecycle, updates, preview config, model install). */
export declare class ManagerFeature extends AbstractFeature {
    checkSupported(): Promise<boolean>;
    destroy(): void;
    private fetchApi;
    /**
     * Set the default state to be displayed in the main menu when the browser starts.
     *
     * We use this api to checking if the manager feature is supported.
     *
     * Default will return the current state.
     * @deprecated Not working anymore
     */
    defaultUi(setUi?: TDefaultUI): Promise<boolean>;
    getVersion(): Promise<string>;
    /**
     * Retrieves a list of extension's nodes based on the specified mode.
     *
     * Useful to find the node suitable for the current workflow.
     *
     * @param mode - The mode to determine the source of the nodes. Defaults to "local".
     * @returns A promise that resolves to an array of extension nodes.
     * @throws An error if the retrieval fails.
     */
    getNodeMapList(mode?: "local" | "nickname"): Promise<Array<INodeMapItem>>;
    /**
     * Checks for extension updates.
     *
     * @param mode - The mode to use for checking updates. Defaults to "local".
     * @returns The result of the extension update check.
     */
    checkExtensionUpdate(mode?: "local" | "cache"): Promise<EExtensionUpdateCheckResult>;
    /**
     * Updates all extensions.
     * @param mode - The update mode. Can be "local" or "cache". Defaults to "local".
     * @returns An object representing the result of the extension update.
     */
    updateAllExtensions(mode?: "local" | "cache"): Promise<{
        type: EUpdateResult;
        readonly data?: undefined;
    } | {
        readonly type: EUpdateResult.SUCCESS;
        readonly data: {
            updated: number;
            failed: number;
        };
    }>;
    /**
     * Updates the ComfyUI.
     *
     * @returns The result of the update operation.
     */
    updateComfyUI(): Promise<EUpdateResult>;
    /**
     * Retrieves the list of extensions.
     *
     * @param mode - The mode to retrieve the extensions from. Can be "local" or "cache". Defaults to "local".
     * @param skipUpdate - Indicates whether to skip updating the extensions. Defaults to true.
     * @returns A promise that resolves to an object containing the channel and custom nodes, or false if the retrieval fails.
     * @throws An error if the retrieval fails.
     */
    getExtensionList(mode?: "local" | "cache", skipUpdate?: boolean): Promise<{
        channel: "local" | "default";
        custom_nodes: IExtensionInfo[];
    } | false>;
    /**
     * Reboots the instance.
     *
     * @returns A promise that resolves to `true` if the instance was successfully rebooted, or `false` otherwise.
     */
    rebootInstance(): Promise<boolean>;
    /**
     * Return the current preview method. Will set to `mode` if provided.
     *
     * @param mode - The preview method mode.
     * @returns The result of the preview method.
     * @throws An error if the preview method fails to set.
     */
    previewMethod(mode?: TPreviewMethod): Promise<TPreviewMethod | undefined>;
    /**
     * Installs an extension based on the provided configuration.
     *
     * @param config - The configuration for the extension installation.
     * @returns A boolean indicating whether the installation was successful.
     * @throws An error if the installation fails.
     */
    installExtension(config: IInstallExtensionRequest): Promise<boolean>;
    /**
     * Try to fix installation of an extension by re-install it again with fixes.
     *
     * @param config - The configuration object for fixing the extension.
     * @returns A boolean indicating whether the extension was fixed successfully.
     * @throws An error if the fix fails.
     */
    fixInstallExtension(config: Omit<IInstallExtensionRequest, "js_path" | "install_type"> & {
        install_type: EInstallType.GIT_CLONE;
    }): Promise<boolean>;
    /**
     * Install an extension from a Git URL.
     *
     * @param url - The URL of the Git repository.
     * @returns A boolean indicating whether the installation was successful.
     * @throws An error if the installation fails.
     */
    installExtensionFromGit(url: string): Promise<boolean>;
    /**
     * Installs pip packages.
     *
     * @param packages - An array of packages to install.
     * @returns A boolean indicating whether the installation was successful.
     * @throws An error if the installation fails.
     */
    installPipPackages(packages: string[]): Promise<boolean>;
    /**
     * Uninstalls an extension.
     *
     * @param config - The configuration for uninstalling the extension.
     * @returns A boolean indicating whether the uninstallation was successful.
     * @throws An error if the uninstallation fails.
     */
    uninstallExtension(config: IExtensionUninstallRequest): Promise<boolean>;
    /**
     * Updates the extension with the provided configuration. Only work with git-clone method
     *
     * @param config - The configuration object for the extension update.
     * @returns A boolean indicating whether the extension update was successful.
     * @throws An error if the extension update fails.
     */
    updateExtension(config: IExtensionUpdateRequest): Promise<boolean>;
    /**
     * Set the activation of extension.
     *
     * @param config - The configuration for the active extension.
     * @returns A boolean indicating whether the active extension was set successfully.
     * @throws An error if setting the active extension fails.
     */
    setActiveExtension(config: IExtensionActiveRequest): Promise<boolean>;
    /**
     * Install a model from given info.
     *
     * @param info - The model installation request information.
     * @returns A boolean indicating whether the model installation was successful.
     * @throws An error if the model installation fails.
     */
    installModel(info: IModelInstallRequest): Promise<boolean>;
}
//# sourceMappingURL=manager.d.ts.map