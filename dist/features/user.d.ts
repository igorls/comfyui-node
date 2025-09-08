import { ComfyApi } from "../client.js";
import { FeatureBase } from "./base.js";
/** User configuration & settings CRUD. */
export declare class UserFeature extends FeatureBase {
    constructor(client: ComfyApi);
    /**
     * Retrieves user configuration data.
     * @returns {Promise<any>} The user configuration data.
     */
    getUserConfig(): Promise<any>;
    /**
     * Creates a new user.
     * @param {string} username The username of the new user.
     * @returns {Promise<Response>} The response from the API.
     */
    createUser(username: string): Promise<Response>;
    /**
     * Retrieves all setting values for the current user.
     * @returns {Promise<any>} A dictionary of setting id to value.
     */
    getSettings(): Promise<any>;
    /**
     * Retrieves a specific setting for the current user.
     * @param {string} id The id of the setting to fetch.
     * @returns {Promise<any>} The setting value.
     */
    getSetting(id: string): Promise<any>;
    /**
     * Stores a dictionary of settings for the current user.
     * @param {Record<string, unknown>} settings Dictionary of setting id to value to save.
     * @returns {Promise<void>}
     */
    storeSettings(settings: Record<string, unknown>): Promise<void>;
    /**
     * Stores a specific setting for the current user.
     * @param {string} id The id of the setting to update.
     * @param {unknown} value The value of the setting.
     * @returns {Promise<void>}
     */
    storeSetting(id: string, value: unknown): Promise<void>;
}
//# sourceMappingURL=user.d.ts.map