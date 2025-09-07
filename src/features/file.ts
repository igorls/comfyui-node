import { ComfyApi } from "../client";
import { ImageInfo } from "../types/api";

import { FeatureBase } from "./base";

export class FileFeature extends FeatureBase {
  constructor(client: ComfyApi) {
    super(client);
  }

  /**
   * Uploads an image file to the server.
   * @param file - The image file to upload.
   * @param fileName - The name of the image file.
   * @param override - Optional. Specifies whether to override an existing file with the same name. Default is true.
   * @returns A Promise that resolves to an object containing the image information and the URL of the uploaded image,
   *          or false if the upload fails.
   */
  async uploadImage(
    file: Buffer | Blob,
    fileName: string,
    config?: {
      override?: boolean;
      subfolder?: string;
    }
  ): Promise<{ info: ImageInfo; url: string } | false> {
    const formData = new FormData();
    const fileBlob = file instanceof Buffer ? new Blob([new Uint8Array(file)]) : (file as Blob);
    formData.append("image", fileBlob, fileName);
    formData.append("subfolder", config?.subfolder ?? "");
    formData.append("overwrite", config?.override?.toString() ?? "false");

    try {
      const response = await this.client.fetchApi("/upload/image", {
        method: "POST",
        body: formData
      });
      const imgInfo = await response.json();
      const mapped = { ...imgInfo, filename: imgInfo.name };

      if (!response.ok) {
        return false;
      }

      return {
        info: mapped,
        url: this.getPathImage(mapped)
      };
    } catch (e) {
      return false;
    }
  }

  /**
   * Uploads a mask file to the server.
   *
   * @param file - The mask file to upload, can be a Buffer or Blob.
   * @param originalRef - The original reference information for the file.
   * @returns A Promise that resolves to an object containing the image info and URL if the upload is successful, or false if the upload fails.
   */
  async uploadMask(file: Buffer | Blob, originalRef: ImageInfo): Promise<{ info: ImageInfo; url: string } | false> {
    const formData = new FormData();

    const fileBlob = file instanceof Buffer ? new Blob([new Uint8Array(file)]) : (file as Blob);
    formData.append("image", fileBlob, "mask.png");

    formData.append("original_ref", JSON.stringify(originalRef));

    try {
      const response = await this.client.fetchApi("/upload/mask", {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        return false;
      }

      const imgInfo = await response.json();
      const mapped = { ...imgInfo, filename: imgInfo.name };
      return {
        info: mapped,
        url: this.getPathImage(mapped)
      };
    } catch (error) {
      return false;
    }
  }

  /**
   * Returns the path to an image based on the provided image information.
   * @param imageInfo - The information of the image.
   * @returns The path to the image.
   */
  getPathImage(imageInfo: ImageInfo): string {
    return this.client.apiURL(
      `/view?filename=${imageInfo.filename}&type=${imageInfo.type}&subfolder=${imageInfo.subfolder ?? ""}`
    );
  }

  /**
   * Get blob of image based on the provided image information. Use when the server have credential.
   */
  async getImage(imageInfo: ImageInfo): Promise<Blob> {
    return this.client.fetchApi(
      `/view?filename=${imageInfo.filename}&type=${imageInfo.type}&subfolder=${imageInfo.subfolder ?? ""}`
    ).then((res) => res.blob());
  }

  /**
   * Retrieves a user data file for the current user.
   * @param {string} file The name of the userdata file to load.
   * @returns {Promise<Response>} The fetch response object.
   */
  async getUserData(file: string): Promise<Response> {
    return this.client.fetchApi(`/userdata/${encodeURIComponent(file)}`);
  }

  /**
   * Stores a user data file for the current user.
   * @param {string} file The name of the userdata file to save.
   * @param {unknown} data The data to save to the file.
   * @param {RequestInit & { overwrite?: boolean, stringify?: boolean, throwOnError?: boolean }} [options] Additional options for storing the file.
   * @returns {Promise<Response>}
   */
  async storeUserData(
    file: string,
    data: unknown,
    options: RequestInit & {
      overwrite?: boolean;
      stringify?: boolean;
      throwOnError?: boolean;
    } = { overwrite: true, stringify: true, throwOnError: true }
  ): Promise<Response> {
    const response = await this.client.fetchApi(`/userdata/${encodeURIComponent(file)}?overwrite=${options.overwrite}`, {
      method: "POST",
      headers: {
        "Content-Type": options.stringify ? "application/json" : "application/octet-stream"
      } as any,
      body: options.stringify ? JSON.stringify(data) : (data as any),
      ...options
    });

    if (response.status !== 200 && options.throwOnError !== false) {
      throw new Error(`Error storing user data file '${file}': ${response.status} ${response.statusText}`);
    }

    return response;
  }

  /**
   * Deletes a user data file for the current user.
   * @param {string} file The name of the userdata file to delete.
   * @returns {Promise<void>}
   */
  async deleteUserData(file: string): Promise<void> {
    const response = await this.client.fetchApi(`/userdata/${encodeURIComponent(file)}`, {
      method: "DELETE"
    });

    if (response.status !== 204) {
      throw new Error(`Error removing user data file '${file}': ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Moves a user data file for the current user.
   * @param {string} source The userdata file to move.
   * @param {string} dest The destination for the file.
   * @param {RequestInit & { overwrite?: boolean }} [options] Additional options for moving the file.
   * @returns {Promise<Response>}
   */
  async moveUserData(
    source: string,
    dest: string,
    options: RequestInit & { overwrite?: boolean } = { overwrite: false }
  ): Promise<Response> {
    return this.client.fetchApi(
      `/userdata/${encodeURIComponent(source)}/move/${encodeURIComponent(dest)}?overwrite=${options.overwrite}`,
      {
        method: "POST"
      }
    );
  }

  /**
   * Lists user data files for the current user.
   * @param {string} dir The directory in which to list files.
   * @param {boolean} [recurse] If the listing should be recursive.
   * @param {boolean} [split] If the paths should be split based on the OS path separator.
   * @returns {Promise<string[]>} The list of files.
   */
  async listUserData(dir: string, recurse?: boolean, split?: boolean): Promise<string[]> {
    const response = await this.client.fetchApi(
      `/userdata?${new URLSearchParams({
        dir,
        recurse: recurse?.toString() ?? "",
        split: split?.toString() ?? ""
      })}`
    );

    if (response.status === 404) return [];
    if (response.status !== 200) {
      throw new Error(`Error getting user data list '${dir}': ${response.status} ${response.statusText}`);
    }

    return response.json();
  }
}
