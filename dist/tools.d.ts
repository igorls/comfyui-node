export declare const randomInt: (min: number, max: number) => number;
export declare const delay: (ms: number) => Promise<unknown>;
export declare const seed: () => number;
/**
 * Encode a POSIX path to NT path
 * Useful for loading model with Windows's ComfyUI Client
 */
export declare const encodeNTPath: (path: string) => string;
export declare const encodePosixPath: (path: string) => string;
//# sourceMappingURL=tools.d.ts.map