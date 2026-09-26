import { CropBounds } from "./schemas.js";
export interface ProcessedImageResult {
    buffer: Buffer;
    mimeType: string;
    width: number;
    height: number;
    originalWidth?: number;
    originalHeight?: number;
}
export interface ReviewImageInput {
    buffer: Buffer;
    label?: string;
    seed?: number;
    index?: number;
}
/**
 * Create bounded image for agent vision inspection
 */
export declare function createBoundedImage(buffer: Buffer, maxDimension?: number, format?: "jpeg" | "png" | "webp"): Promise<ProcessedImageResult>;
/**
 * Create crop region from an image
 */
export declare function createCrop(buffer: Buffer, crop: CropBounds, format?: "jpeg" | "png" | "webp"): Promise<ProcessedImageResult>;
/**
 * Generate a contact sheet grid from multiple candidate images
 */
export declare function createContactSheet(items: ReviewImageInput[], maxDimension?: number, format?: "jpeg" | "png" | "webp"): Promise<ProcessedImageResult>;
/**
 * Create side-by-side comparison between parent and revised generation
 */
export declare function createSideBySideComparison(leftItem: ReviewImageInput, rightItem: ReviewImageInput, maxDimension?: number, format?: "jpeg" | "png" | "webp"): Promise<ProcessedImageResult>;
/**
 * Helper to convert processed image result to MCP image content block
 */
export declare function toMcpImageContent(image: {
    buffer: Buffer;
    mimeType: string;
}): {
    type: "image";
    data: string;
    mimeType: string;
};
//# sourceMappingURL=review-images.d.ts.map