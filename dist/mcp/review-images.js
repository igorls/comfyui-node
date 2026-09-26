import sharp from "sharp";
/**
 * Format string to MIME type
 */
function getMimeType(format) {
    switch (format) {
        case "png":
            return "image/png";
        case "webp":
            return "image/webp";
        case "jpeg":
        default:
            return "image/jpeg";
    }
}
/**
 * Create bounded image for agent vision inspection
 */
export async function createBoundedImage(buffer, maxDimension = 1024, format = "jpeg") {
    const instance = sharp(buffer);
    const metadata = await instance.metadata();
    const originalWidth = metadata.width || 0;
    const originalHeight = metadata.height || 0;
    let pipeline = instance;
    if (originalWidth > maxDimension || originalHeight > maxDimension) {
        pipeline = pipeline.resize({
            width: maxDimension,
            height: maxDimension,
            fit: "inside",
            withoutEnlargement: true
        });
    }
    const mimeType = getMimeType(format);
    let processedBuffer;
    if (format === "png") {
        processedBuffer = await pipeline.png().toBuffer();
    }
    else if (format === "webp") {
        processedBuffer = await pipeline.webp({ quality: 85 }).toBuffer();
    }
    else {
        processedBuffer = await pipeline.jpeg({ quality: 85 }).toBuffer();
    }
    const outputMeta = await sharp(processedBuffer).metadata();
    return {
        buffer: processedBuffer,
        mimeType,
        width: outputMeta.width || originalWidth,
        height: outputMeta.height || originalHeight,
        originalWidth,
        originalHeight
    };
}
/**
 * Create crop region from an image
 */
export async function createCrop(buffer, crop, format = "jpeg") {
    const instance = sharp(buffer);
    const metadata = await instance.metadata();
    const imgWidth = metadata.width || 1;
    const imgHeight = metadata.height || 1;
    const isNormalized = crop.normalized === true ||
        (crop.normalized !== false &&
            crop.x <= 1.0 &&
            crop.y <= 1.0 &&
            crop.width <= 1.0 &&
            crop.height <= 1.0 &&
            (crop.x > 0 || crop.y > 0 || crop.width < 1.0 || crop.height < 1.0));
    let left = Math.round(isNormalized ? crop.x * imgWidth : crop.x);
    let top = Math.round(isNormalized ? crop.y * imgHeight : crop.y);
    let width = Math.round(isNormalized ? crop.width * imgWidth : crop.width);
    let height = Math.round(isNormalized ? crop.height * imgHeight : crop.height);
    // Clamp within image bounds
    left = Math.max(0, Math.min(left, imgWidth - 1));
    top = Math.max(0, Math.min(top, imgHeight - 1));
    width = Math.max(1, Math.min(width, imgWidth - left));
    height = Math.max(1, Math.min(height, imgHeight - top));
    const mimeType = getMimeType(format);
    let pipeline = sharp(buffer).extract({ left, top, width, height });
    if (format === "png") {
        pipeline = pipeline.png();
    }
    else if (format === "webp") {
        pipeline = pipeline.webp({ quality: 85 });
    }
    else {
        pipeline = pipeline.jpeg({ quality: 85 });
    }
    const processedBuffer = await pipeline.toBuffer();
    const outputMeta = await sharp(processedBuffer).metadata();
    return {
        buffer: processedBuffer,
        mimeType,
        width: outputMeta.width || width,
        height: outputMeta.height || height,
        originalWidth: imgWidth,
        originalHeight: imgHeight
    };
}
/**
 * Escape XML entities for safe SVG text embedding
 */
function escapeXml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}
/**
 * Generate a contact sheet grid from multiple candidate images
 */
export async function createContactSheet(items, maxDimension = 1536, format = "jpeg") {
    if (items.length === 0) {
        throw new Error("Cannot create contact sheet from empty image list");
    }
    if (items.length === 1) {
        return createBoundedImage(items[0].buffer, maxDimension, format);
    }
    const count = items.length;
    const cols = count <= 2 ? count : count <= 4 ? 2 : count <= 9 ? 3 : 4;
    const rows = Math.ceil(count / cols);
    const tileWidth = 512;
    const tileHeight = 512;
    const headerHeight = 36;
    const padding = 12;
    const totalWidth = cols * tileWidth + (cols + 1) * padding;
    const totalHeight = rows * (tileHeight + headerHeight) + (rows + 1) * padding;
    const composites = [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = padding + col * (tileWidth + padding);
        const y = padding + row * (tileHeight + headerHeight + padding);
        const labelText = item.label || `Candidate ${item.index !== undefined ? item.index + 1 : i + 1}${item.seed !== undefined ? ` (Seed: ${item.seed})` : ""}`;
        const escapedLabel = escapeXml(labelText);
        // Create SVG banner header
        const headerSvg = Buffer.from(`<svg width="${tileWidth}" height="${headerHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${tileWidth}" height="${headerHeight}" fill="#1e293b" rx="4" ry="4"/>
        <text x="12" y="24" font-family="sans-serif" font-size="14" font-weight="bold" fill="#f8fafc">${escapedLabel}</text>
      </svg>`);
        composites.push({
            input: headerSvg,
            left: x,
            top: y
        });
        // Resize image tile
        const resizedTile = await sharp(item.buffer)
            .resize({
            width: tileWidth,
            height: tileHeight,
            fit: "contain",
            background: { r: 15, g: 23, b: 42, alpha: 1 }
        })
            .toBuffer();
        composites.push({
            input: resizedTile,
            left: x,
            top: y + headerHeight
        });
    }
    // Render canvas
    let canvas = sharp({
        create: {
            width: totalWidth,
            height: totalHeight,
            channels: 4,
            background: { r: 10, g: 15, b: 30, alpha: 1 }
        }
    }).composite(composites);
    const mimeType = getMimeType(format);
    let processedBuffer = await canvas.png().toBuffer();
    // Resize composited canvas if total dimensions exceed maxDimension
    if (totalWidth > maxDimension || totalHeight > maxDimension) {
        processedBuffer = await sharp(processedBuffer)
            .resize({
            width: maxDimension,
            height: maxDimension,
            fit: "inside",
            withoutEnlargement: true
        })
            .toBuffer();
    }
    if (format === "png") {
        processedBuffer = await sharp(processedBuffer).png().toBuffer();
    }
    else if (format === "webp") {
        processedBuffer = await sharp(processedBuffer).webp({ quality: 85 }).toBuffer();
    }
    else {
        processedBuffer = await sharp(processedBuffer).jpeg({ quality: 85 }).toBuffer();
    }
    const outputMeta = await sharp(processedBuffer).metadata();
    return {
        buffer: processedBuffer,
        mimeType,
        width: outputMeta.width || totalWidth,
        height: outputMeta.height || totalHeight
    };
}
/**
 * Create side-by-side comparison between parent and revised generation
 */
export async function createSideBySideComparison(leftItem, rightItem, maxDimension = 1536, format = "jpeg") {
    const targetHeight = 640;
    const headerHeight = 44;
    const padding = 16;
    // Process left image
    const leftResized = await sharp(leftItem.buffer)
        .resize({
        height: targetHeight,
        fit: "inside",
        withoutEnlargement: false
    })
        .toBuffer();
    const leftMeta = await sharp(leftResized).metadata();
    const leftWidth = leftMeta.width || 512;
    const leftHeight = leftMeta.height || targetHeight;
    // Process right image
    const rightResized = await sharp(rightItem.buffer)
        .resize({
        height: targetHeight,
        fit: "inside",
        withoutEnlargement: false
    })
        .toBuffer();
    const rightMeta = await sharp(rightResized).metadata();
    const rightWidth = rightMeta.width || 512;
    const rightHeight = rightMeta.height || targetHeight;
    const actualImageHeight = Math.max(leftHeight, rightHeight);
    const totalWidth = padding + leftWidth + padding + rightWidth + padding;
    const totalHeight = padding + headerHeight + actualImageHeight + padding;
    const leftLabel = escapeXml(leftItem.label || "Original / Parent");
    const rightLabel = escapeXml(rightItem.label || "Revision / Child");
    const leftHeaderSvg = Buffer.from(`<svg width="${leftWidth}" height="${headerHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${leftWidth}" height="${headerHeight}" fill="#334155" rx="6" ry="6"/>
      <text x="${leftWidth / 2}" y="28" font-family="sans-serif" font-size="16" font-weight="bold" fill="#f8fafc" text-anchor="middle">${leftLabel}</text>
    </svg>`);
    const rightHeaderSvg = Buffer.from(`<svg width="${rightWidth}" height="${headerHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${rightWidth}" height="${headerHeight}" fill="#1e40af" rx="6" ry="6"/>
      <text x="${rightWidth / 2}" y="28" font-family="sans-serif" font-size="16" font-weight="bold" fill="#f8fafc" text-anchor="middle">${rightLabel}</text>
    </svg>`);
    const composites = [
        {
            input: leftHeaderSvg,
            left: padding,
            top: padding
        },
        {
            input: leftResized,
            left: padding,
            top: padding + headerHeight
        },
        {
            input: rightHeaderSvg,
            left: padding + leftWidth + padding,
            top: padding
        },
        {
            input: rightResized,
            left: padding + leftWidth + padding,
            top: padding + headerHeight
        }
    ];
    const canvas = sharp({
        create: {
            width: totalWidth,
            height: totalHeight,
            channels: 4,
            background: { r: 10, g: 15, b: 30, alpha: 1 }
        }
    }).composite(composites);
    const mimeType = getMimeType(format);
    let processedBuffer = await canvas.png().toBuffer();
    if (totalWidth > maxDimension || totalHeight > maxDimension) {
        processedBuffer = await sharp(processedBuffer)
            .resize({
            width: maxDimension,
            height: maxDimension,
            fit: "inside",
            withoutEnlargement: true
        })
            .toBuffer();
    }
    if (format === "png") {
        processedBuffer = await sharp(processedBuffer).png().toBuffer();
    }
    else if (format === "webp") {
        processedBuffer = await sharp(processedBuffer).webp({ quality: 85 }).toBuffer();
    }
    else {
        processedBuffer = await sharp(processedBuffer).jpeg({ quality: 85 }).toBuffer();
    }
    const outputMeta = await sharp(processedBuffer).metadata();
    return {
        buffer: processedBuffer,
        mimeType,
        width: outputMeta.width || totalWidth,
        height: outputMeta.height || totalHeight
    };
}
/**
 * Helper to convert processed image result to MCP image content block
 */
export function toMcpImageContent(image) {
    return {
        type: "image",
        data: image.buffer.toString("base64"),
        mimeType: image.mimeType
    };
}
//# sourceMappingURL=review-images.js.map