/**
 * Generates a random integer between the specified minimum and maximum values (inclusive).
 * @param min - The minimum value (inclusive)
 * @param max - The maximum value (inclusive)
 * @returns A random integer between min and max
 */
export declare const randomInt: (min: number, max: number) => number;
/**
 * Creates a delay promise that resolves after the specified number of milliseconds.
 * @param ms - The number of milliseconds to delay
 * @returns A promise that resolves after ms milliseconds
 */
export declare const delay: (ms: number) => Promise<unknown>;
/**
 * Generates a random seed value for ComfyUI operations.
 * @returns A random integer between 10000000000 and 999999999999
 */
export declare const seed: () => number;
/**
 * Encode a POSIX path to NT path
 * Useful for loading model with Windows's ComfyUI Client
 * @param path - The POSIX path to encode
 * @returns The encoded NT path
 */
export declare const encodeNTPath: (path: string) => string;
/**
 * Encodes an NT path to a POSIX path.
 * @param path - The NT path to encode
 * @returns The encoded POSIX path
 */
export declare const encodePosixPath: (path: string) => string;
//# sourceMappingURL=tools.d.ts.map