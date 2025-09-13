/**
 * Helper type to fix array types for better type inference
 */
export type FixArr<T> = T extends readonly any[] ? Omit<T, Exclude<keyof any[], number>> : T;
/**
 * Helper type to drop the initial dot from a string type
 */
export type DropInitDot<T> = T extends `.${infer U}` ? U : T;
/**
 * Helper type to extract deep keys from an object type
 */
export type _DeepKeys<T> = T extends object ? {
    [K in (string | number) & keyof T]: `${`.${K}`}${"" | _DeepKeys<FixArr<T[K]>>}`;
}[(string | number) & keyof T] : never;
/**
 * Type to extract all deep keys from an object type, removing the initial dot
 */
export type DeepKeys<T> = DropInitDot<_DeepKeys<FixArr<T>>>;
/**
 * Helper type to simplify complex types for better IntelliSense
 */
export type Simplify<T> = {
    [K in keyof T]: T[K];
} & {};
//# sourceMappingURL=tool.d.ts.map