import { encodeNTPath, encodePosixPath } from "./tools.js";
import { OSType } from "./types/api.js";
export class PromptBuilder {
    prompt;
    mapInputKeys = {};
    mapOutputKeys = {};
    bypassNodes = [];
    constructor(prompt, inputKeys, outputKeys) {
        this.prompt = structuredClone(prompt);
        inputKeys.forEach((key) => {
            this.mapInputKeys[key] = undefined;
        });
        outputKeys.forEach((key) => {
            this.mapOutputKeys[key] = undefined;
        });
        return this;
    }
    /**
     * Creates a new instance of the PromptBuilder with the same prompt, input keys, and output keys.
     *
     * @returns A new instance of the PromptBuilder.
     */
    clone() {
        const newBuilder = new PromptBuilder(this.prompt, Object.keys(this.mapInputKeys), Object.keys(this.mapOutputKeys));
        newBuilder.mapInputKeys = { ...this.mapInputKeys };
        newBuilder.mapOutputKeys = { ...this.mapOutputKeys };
        newBuilder.bypassNodes = [...this.bypassNodes];
        return newBuilder;
    }
    bypass(nodes) {
        if (!Array.isArray(nodes)) {
            nodes = [nodes];
        }
        const newBuilder = this.clone();
        newBuilder.bypassNodes.push(...nodes);
        return newBuilder;
    }
    reinstate(nodes) {
        if (!Array.isArray(nodes)) {
            nodes = [nodes];
        }
        const newBuilder = this.clone();
        for (const node of nodes) {
            newBuilder.bypassNodes.splice(newBuilder.bypassNodes.indexOf(node), 1);
        }
        return newBuilder;
    }
    /**
     * Sets the input node for a given key. Can be map multiple keys to the same input.
     *
     * @param input - The input node to set.
     * @param key - The key(s) to associate with the input node. Can be array of keys.
     * @returns This builder instance.
     */
    setInputNode(input, key) {
        return this.setRawInputNode(input, key);
    }
    /**
     * Sets the raw input node for the given input and key. This will bypass the typing check. Use for dynamic nodes.
     *
     * @param input - The input node to be set.
     * @param key - The key associated with the input node.
     * @returns The current instance for method chaining.
     */
    setRawInputNode(input, key) {
        this.mapInputKeys[input] = key;
        return this.clone();
    }
    /**
     * Appends raw input node keys to the map of input keys. This will bypass the typing check. Use for dynamic nodes.
     *
     * @param input - The input node to which the keys will be appended.
     * @param key - The key or array of keys to append to the input node.
     * @returns A clone of the current instance with the updated input keys.
     */
    appendRawInputNode(input, key) {
        let keys = typeof key === "string" ? [key] : key;
        if (typeof this.mapInputKeys[input] === "string") {
            this.mapInputKeys[input] = [this.mapInputKeys[input]];
        }
        this.mapInputKeys[input]?.push(...keys);
        return this.clone();
    }
    /**
     * Appends mapped key into the input node.
     *
     * @param input - The input node to append.
     * @param key - The key(s) to associate with the input node. Can be array of keys.
     * @returns The updated prompt builder.
     */
    appendInputNode(input, key) {
        return this.appendRawInputNode(input, key);
    }
    /**
     * Sets the output node for a given key. This will bypass the typing check. Use for dynamic nodes.
     *
     * @param output - The output node to set.
     * @param key - The key to associate with the output node.
     * @returns This builder instance.
     */
    setRawOutputNode(output, key) {
        this.mapOutputKeys[output] = key;
        return this.clone();
    }
    /**
     * Sets the output node for a given key.
     *
     * @param output - The output node to set.
     * @param key - The key to associate with the output node.
     * @returns This builder instance.
     */
    setOutputNode(output, key) {
        return this.setRawOutputNode(output, key);
    }
    /**
     * Sets the value for a specific input key in the prompt builder.
     *
     * @template V - The type of the value being set.
     * @param {I} key - The input key.
     * @param {V} value - The value to set.
     * @param {OSType} [encodeOs] - The OS type to encode the path.
     * @returns A new prompt builder with the updated value.
     * @throws {Error} - If the key is not found.
     */
    input(key, value, encodeOs) {
        if (value !== undefined) {
            let valueToSet = value;
            /**
             * Handle encode path if needed, use for load models path
             */
            if (encodeOs === OSType.NT && typeof valueToSet === "string") {
                valueToSet = encodeNTPath(valueToSet);
            }
            else if (encodeOs === OSType.POSIX && typeof valueToSet === "string") {
                valueToSet = encodePosixPath(valueToSet);
            }
            /**
             * Map the input key to the path in the prompt object
             */
            let paths = this.mapInputKeys[key];
            if (!paths) {
                throw new Error(`Key ${key} not found`);
            }
            if (typeof paths === "string") {
                paths = [paths];
            }
            for (const path of paths) {
                const keys = path.split(".");
                let current = this.prompt;
                for (let i = 0; i < keys.length - 1; i++) {
                    if (!current[keys[i]]) {
                        current[keys[i]] = {}; // Allow setting value to undefined path
                    }
                    current = current[keys[i]];
                }
                current[keys[keys.length - 1]] = valueToSet;
            }
        }
        return this;
    }
    /**
     * Sets the value for a any input key in the prompt builder.
     *
     * @template V - The type of the value being set.
     * @param {string} key - The input key.
     * @param {V} value - The value to set.
     * @param {OSType} [encodeOs] - The OS type to encode the path.
     * @returns A new prompt builder with the updated value.
     * @throws {Error} - If the key is not found.
     */
    inputRaw(key, value, encodeOs) {
        if (key === "__proto__" || key === "constructor" || key === "prototype") {
            throw new Error(`Invalid key: ${key}`);
        }
        if (value !== undefined) {
            let valueToSet = value;
            /**
             * Handle encode path if needed, use for load models path
             */
            if (encodeOs === OSType.NT && typeof valueToSet === "string") {
                valueToSet = encodeNTPath(valueToSet);
            }
            else if (encodeOs === OSType.POSIX && typeof valueToSet === "string") {
                valueToSet = encodePosixPath(valueToSet);
            }
            const keys = key.split(".");
            let current = this.prompt;
            for (let i = 0; i < keys.length - 1; i++) {
                if (keys[i] === "__proto__" || keys[i] === "constructor")
                    continue;
                if (!current[keys[i]]) {
                    current[keys[i]] = {}; // Allow to set value to undefined path
                }
                current = current[keys[i]];
            }
            if (keys[keys.length - 1] !== "__proto__" && keys[keys.length - 1] !== "constructor") {
                current[keys[keys.length - 1]] = valueToSet;
            }
        }
        return this;
    }
    /**
     * @deprecated Please call `input` directly instead
     */
    get caller() {
        return this;
    }
    /**
     * Gets the workflow object of the prompt builder.
     */
    get workflow() {
        return this.prompt;
    }
    /**
     * Validates that all declared output keys are mapped to existing nodes in the workflow.
     * Throws an Error listing missing mappings.
     */
    validateOutputMappings() {
        const missing = [];
        const promptAny = this.prompt;
        for (const [k, v] of Object.entries(this.mapOutputKeys)) {
            if (!v || typeof v !== 'string' || !(Object.prototype.hasOwnProperty.call(promptAny, v))) {
                missing.push(`${k}:${v || 'UNMAPPED'}`);
            }
        }
        if (missing.length) {
            throw new Error(`Unmapped or missing output nodes: ${missing.join(', ')}`);
        }
        return this;
    }
    /**
     * Detect simple circular references in node inputs (node referencing itself directly or via immediate tuple link).
     * More advanced graph cycles can be added later.
     */
    validateNoImmediateCycles() {
        const promptAny2 = this.prompt;
        for (const [nodeId, nodeAny] of Object.entries(promptAny2)) {
            const inputs = nodeAny?.inputs || {};
            for (const input of Object.values(inputs)) {
                if (Array.isArray(input) && input[0] === nodeId) {
                    throw new Error(`Immediate self-cycle detected at node ${nodeId}`);
                }
            }
        }
        return this;
    }
    /** Serialize builder state (excluding functions) */
    toJSON() {
        return {
            prompt: this.prompt,
            mapInputKeys: this.mapInputKeys,
            mapOutputKeys: this.mapOutputKeys,
            bypassNodes: this.bypassNodes
        };
    }
    static fromJSON(data) {
        const keysIn = Object.keys(data.mapInputKeys || {});
        const keysOut = Object.keys(data.mapOutputKeys || {});
        const builder = new PromptBuilder(data.prompt, keysIn, keysOut);
        builder.mapInputKeys = data.mapInputKeys || {};
        builder.mapOutputKeys = data.mapOutputKeys || {};
        builder.bypassNodes = data.bypassNodes || [];
        return builder;
    }
}
//# sourceMappingURL=prompt-builder.js.map