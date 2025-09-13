/**
 * Union type representing the default UI options in ComfyUI Manager
 */
export type TDefaultUI = "none" | "history" | "queue";

/**
 * Union type representing the extension active status options
 */
export type TExtensionActive = "Enabled" | "Disabled";

/**
 * Union type representing the preview method options in ComfyUI Manager
 */
export type TPreviewMethod = "auto" | "latent2rgb" | "taesd" | "none";

/**
 * Enum representing the installation state of an extension
 */
export enum EInstallationState {
  /**
   * Extension is not installed
   */
  NOT_INSTALLED = "not-installed",
  /**
   * Extension is installed
   */
  INSTALLED = "installed"
}

/**
 * Enum representing the model types in ComfyUI Manager
 */
enum EModelType {
  /**
   * Checkpoint model type
   */
  CHECKPOINT = "checkpoint",
  /**
   * Unclip model type
   */
  UNCLIP = "unclip",
  /**
   * CLIP model type
   */
  CLIP = "clip",
  /**
   * VAE model type
   */
  VAE = "VAE",
  /**
   * LORA model type
   */
  LORA = "lora",
  /**
   * T2I Adapter model type
   */
  T2I_ADAPTER = "T2I-Adapter",
  /**
   * T2I Style model type
   */
  T2I_STYLE = "T2I-Style",
  /**
   * ControlNet model type
   */
  CONTROLNET = "controlnet",
  /**
   * CLIP Vision model type
   */
  CLIP_VISION = "clip_vision",
  /**
   * GLIGEN model type
   */
  GLIGEN = "gligen",
  /**
   * Upscale model type
   */
  UPSCALE = "upscale",
  /**
   * Embeddings model type
   */
  EMBEDDINGS = "embeddings",
  /**
   * Other model type
   */
  ETC = "etc"
}

/**
 * Enum representing the installation types in ComfyUI Manager
 */
export enum EInstallType {
  /**
   * Install via git clone
   */
  GIT_CLONE = "git-clone",
  /**
   * Install via copy
   */
  COPY = "copy",
  /**
   * Install via CNR (ComfyUI Node Registry)
   */
  CNR = "cnr",
  /**
   * Install via unzip
   */
  UNZIP = "unzip"
}

/**
 * Enum representing the extension update check results in ComfyUI Manager
 */
export enum EExtensionUpdateCheckResult {
  /**
   * No update available
   */
  NO_UPDATE = 0,
  /**
   * Update available
   */
  UPDATE_AVAILABLE = 1,
  /**
   * Update check failed
   */
  FAILED = 2
}

/**
 * Enum representing the update results in ComfyUI Manager
 */
export enum EUpdateResult {
  /**
   * No changes made
   */
  UNCHANGED = 0,
  /**
   * Update successful
   */
  SUCCESS = 1,
  /**
   * Update failed
   */
  FAILED = 2
}
export type TExtensionNodeItem = {
  url: string;
  /**
   * Included nodes
   */
  nodeNames: string[];
  title_aux: string;
  title?: string;
  author?: string;
  description?: string;
  nickname?: string;
};

export interface IExtensionInfo {
  author: string;
  title: string;
  id: string;
  reference: string;
  repository: string;
  files: string[];
  install_type: EInstallType;
  description: string;
  stars: number;
  last_update: string;
  trust: boolean;
  state: EInstallationState;
  /**
   * @deprecated Use `state` instead
   */
  installed: boolean;
  version: string;
  updatable: boolean;
}

export interface IExtensionBaseRequest {
  /**
   * Custom Node name
   */
  title?: string;
  /**
   * Install method
   */
  install_type: EInstallType;
  /**
   * Files to download, clone or copy (can be git url, file url or file path)
   */
  files: string[];
}

export interface IInstallExtensionRequest extends IExtensionBaseRequest {
  /**
   * Destination path for copying files when install_type is "copy", default is custom_node folder
   */
  js_path?: string;
  /**
   * Python packages to be installed
   */
  pip?: string[];
}

export interface IExtensionUninstallRequest extends IExtensionBaseRequest {
  /**
   * Install method
   */
  install_type: EInstallType.GIT_CLONE | EInstallType.COPY;
  /**
   * Destination path for remove files when install_type is "copy", default is custom_node folder
   */
  js_path?: string;
}

export interface IExtensionUpdateRequest extends IExtensionBaseRequest {
  /**
   * Install method
   */
  install_type: EInstallType.GIT_CLONE;
}

export interface IExtensionActiveRequest extends IExtensionBaseRequest {
  /**
   * Install method
   */
  install_type: EInstallType.GIT_CLONE | EInstallType.COPY;
  /**
   * Active status
   */
  installed: TExtensionActive;
  /**
   * Destination path of extension when install_type is "copy". Default is custom_node folder
   */
  js_path?: string;
}

export interface IModelInstallRequest {
  /**
   * Model name
   */
  name?: string;
  /**
   * Place to save the model, set to `default` to use type instead
   */
  save_path: string;
  /**
   * Type of model
   */
  type: EModelType;
  /**
   * Model filename
   */
  filename: string;
  /**
   * Model url to be downloaded
   */
  url: string;
}

export interface INodeMapItem {
  url: string;
  nodeNames: Array<string>;
  title_aux: string;
  title?: string;
  author?: string;
  nickname?: string;
  description?: string;
}
