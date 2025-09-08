import { ComfyApi } from "../client.js";
import { ImageInfo } from "../types/api.js";
import { FeatureBase } from "./base.js";
/** File upload helpers and userdata file operations. */
export declare class FileFeature extends FeatureBase {
    constructor(client: ComfyApi);
    /**
     * Uploads an image file to the server.
     * @param file - The image file to upload.
     * @param fileName - The name of the image file.
     * @param override - Optional. Specifies whether to override an existing file with the same name. Default is true.
     * @returns A Promise that resolves to an object containing the image information and the URL of the uploaded image,
     *          or false if the upload fails.
     */
    uploadImage(file: Buffer | Blob, fileName: string, config?: {
        override?: boolean;
        subfolder?: string;
    }): Promise<{
        info: ImageInfo;
        url: string;
    } | false>;
    /**
     * Uploads a mask file to the server.
     *
     * @param file - The mask file to upload, can be a Buffer or Blob.
     * @param originalRef - The original reference information for the file.
     * @returns A Promise that resolves to an object containing the image info and URL if the upload is successful, or false if the upload fails.
     */
    uploadMask(file: Buffer | Blob, originalRef: ImageInfo): Promise<{
        info: ImageInfo;
        url: string;
    } | false>;
    /**
     * Returns the path to an image based on the provided image information.
     * @param imageInfo - The information of the image.
     * @returns The path to the image.
     */
    getPathImage(imageInfo: ImageInfo): string;
    /**
     * Get blob of image based on the provided image information. Use when the server have credential.
     */
    getImage(imageInfo: ImageInfo): Promise<Blob>;
    /**
     * Retrieves a user data file for the current user.
     * @param {string} file The name of the userdata file to load.
     * @returns {Promise<Response>} The fetch response object.
     */
    getUserData(file: string): Promise<Response>;
    /**
     * Stores a user data file for the current user.
     * @param {string} file The name of the userdata file to save.
     * @param {unknown} data The data to save to the file.
     * @param {RequestInit & { overwrite?: boolean, stringify?: boolean, throwOnError?: boolean }} [options] Additional options for storing the file.
     * @returns {Promise<Response>}
     */
    storeUserData(file: string, data: unknown, options?: RequestInit & {
        overwrite?: boolean;
        stringify?: boolean;
        throwOnError?: boolean;
    }): Promise<Response>;
    /**
     * Deletes a user data file for the current user.
     * @param {string} file The name of the userdata file to delete.
     * @returns {Promise<void>}
     */
    deleteUserData(file: string): Promise<void>;
    /**
     * Moves a user data file for the current user.
     * @param {string} source The userdata file to move.
     * @param {string} dest The destination for the file.
     * @param {RequestInit & { overwrite?: boolean }} [options] Additional options for moving the file.
     * @returns {Promise<Response>}
     */
    moveUserData(source: string, dest: string, options?: RequestInit & {
        overwrite?: boolean;
    }): Promise<Response>;
    /**
     * Lists user data files for the current user.
     * @param {string} dir The directory in which to list files.
     * @param {boolean} [recurse] If the listing should be recursive.
     * @param {boolean} [split] If the paths should be split based on the OS path separator.
     * @returns {Promise<string[]>} The list of files.
     */
    listUserData(dir: string, recurse?: boolean, split?: boolean): Promise<string[]>;
}
//# sourceMappingURL=file.d.ts.map