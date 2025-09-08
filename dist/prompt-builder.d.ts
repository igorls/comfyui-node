import { NodeData, OSType } from "./types/api.js";
import { DeepKeys, Simplify } from "./types/tool.js";
export declare class PromptBuilder<I extends string, O extends string, T extends NodeData> {
    prompt: T;
    mapInputKeys: Partial<Record<I, string | string[]>>;
    mapOutputKeys: Partial<Record<O, string>>;
    bypassNodes: (keyof T)[];
    constructor(prompt: T, inputKeys: I[], outputKeys: O[]);
    /**
     * Creates a new instance of the PromptBuilder with the same prompt, input keys, and output keys.
     *
     * @returns A new instance of the PromptBuilder.
     */
    clone(): PromptBuilder<I, O, T>;
    /**
     * Marks a node to be bypassed at generation.
     *
     * @param node Node which will be bypassed.
     */
    bypass(node: keyof T): PromptBuilder<I, O, T>;
    /**
     * Marks multiple nodes to be bypassed at generation.
     *
     * @param nodes Array of nodes which will be bypassed.
     */
    bypass(nodes: (keyof T)[]): PromptBuilder<I, O, T>;
    /**
     * Unmarks a node from bypass at generation.
     *
     * @param node Node to reverse bypass on.
     */
    reinstate(node: keyof T): PromptBuilder<I, O, T>;
    /**
     * Unmarks a collection of nodes from bypass at generation.
     *
     * @param nodes Array of nodes to reverse bypass on.
     */
    reinstate(nodes: (keyof T)[]): PromptBuilder<I, O, T>;
    /**
     * Sets the input node for a given key. Can be map multiple keys to the same input.
     *
     * @param input - The input node to set.
     * @param key - The key(s) to associate with the input node. Can be array of keys.
     * @returns This builder instance.
     */
    setInputNode(input: I, key: DeepKeys<T> | Array<DeepKeys<T>>): PromptBuilder<I, O, T>;
    /**
     * Sets the raw input node for the given input and key. This will bypass the typing check. Use for dynamic nodes.
     *
     * @param input - The input node to be set.
     * @param key - The key associated with the input node.
     * @returns The current instance for method chaining.
     */
    setRawInputNode(input: I, key: string | string[]): PromptBuilder<I, O, T>;
    /**
     * Appends raw input node keys to the map of input keys. This will bypass the typing check. Use for dynamic nodes.
     *
     * @param input - The input node to which the keys will be appended.
     * @param key - The key or array of keys to append to the input node.
     * @returns A clone of the current instance with the updated input keys.
     */
    appendRawInputNode(input: I, key: string | string[]): PromptBuilder<I, O, T>;
    /**
     * Appends mapped key into the input node.
     *
     * @param input - The input node to append.
     * @param key - The key(s) to associate with the input node. Can be array of keys.
     * @returns The updated prompt builder.
     */
    appendInputNode(input: I, key: DeepKeys<T> | Array<DeepKeys<T>>): PromptBuilder<I, O, T>;
    /**
     * Sets the output node for a given key. This will bypass the typing check. Use for dynamic nodes.
     *
     * @param output - The output node to set.
     * @param key - The key to associate with the output node.
     * @returns This builder instance.
     */
    setRawOutputNode(output: O, key: string): PromptBuilder<I, O, T>;
    /**
     * Sets the output node for a given key.
     *
     * @param output - The output node to set.
     * @param key - The key to associate with the output node.
     * @returns This builder instance.
     */
    setOutputNode(output: O, key: DeepKeys<T>): PromptBuilder<I, O, T>;
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
    input<V = string | number | undefined>(key: I, value: V, encodeOs?: OSType): Simplify<PromptBuilder<I, O, T>>;
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
    inputRaw<V = string | number | undefined>(key: string, value: V, encodeOs?: OSType): Simplify<PromptBuilder<I, O, T>>;
    /**
     * @deprecated Please call `input` directly instead
     */
    get caller(): this;
    /**
     * Gets the workflow object of the prompt builder.
     */
    get workflow(): Simplify<T>;
    /**
     * Validates that all declared output keys are mapped to existing nodes in the workflow.
     * Throws an Error listing missing mappings.
     */
    validateOutputMappings(): this;
    /**
     * Detect simple circular references in node inputs (node referencing itself directly or via immediate tuple link).
     * More advanced graph cycles can be added later.
     */
    validateNoImmediateCycles(): this;
    /** Serialize builder state (excluding functions) */
    toJSON(): any;
    static fromJSON<I extends string, O extends string, T extends NodeData>(data: any): PromptBuilder<I, O, T>;
}
//# sourceMappingURL=prompt-builder.d.ts.map