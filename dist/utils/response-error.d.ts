import { EnqueueFailedError } from "../types/error.js";
/**
 * Builds a detailed EnqueueFailedError from a Response object
 * @param resp - The Response object to extract error information from
 * @returns A promise that resolves to an EnqueueFailedError with detailed information
 */
export declare function buildEnqueueFailedError(resp: Response): Promise<EnqueueFailedError>;
/**
 * Normalizes an unknown error to an EnqueueFailedError
 * @param e - The unknown error to normalize
 * @returns An EnqueueFailedError instance
 */
export declare function normalizeUnknownError(e: unknown): EnqueueFailedError;
//# sourceMappingURL=response-error.d.ts.map