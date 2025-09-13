/**
 * Generates a random integer between the specified minimum and maximum values (inclusive).
 * @param min - The minimum value (inclusive)
 * @param max - The maximum value (inclusive)
 * @returns A random integer between min and max
 */
export const randomInt = (min: number, max: number) => {
  return Math.floor(Math.random() * (max - min + 1) + min);
};

/**
 * Creates a delay promise that resolves after the specified number of milliseconds.
 * @param ms - The number of milliseconds to delay
 * @returns A promise that resolves after ms milliseconds
 */
export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Generates a random seed value for ComfyUI operations.
 * @returns A random integer between 10000000000 and 999999999999
 */
export const seed = () => randomInt(10000000000, 999999999999);

/**
 * Encode a POSIX path to NT path
 * Useful for loading model with Windows's ComfyUI Client
 * @param path - The POSIX path to encode
 * @returns The encoded NT path
 */
export const encodeNTPath = (path: string) => {
  return path.replace(/\//g, "\\");
};

/**
 * Encodes an NT path to a POSIX path.
 * @param path - The NT path to encode
 * @returns The encoded POSIX path
 */
export const encodePosixPath = (path: string) => {
  return path.replace(/\\/g, "/");
};
