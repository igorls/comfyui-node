import { describe, it, expect } from "bun:test";
import sharp from "sharp";
import {
  createBoundedImage,
  createCrop,
  createContactSheet,
  createSideBySideComparison,
  toMcpImageContent
} from "../../src/mcp/review-images.js";

describe("review-images", () => {
  // Helper to create synthetic test image
  async function createTestImage(width: number, height: number, color: { r: number; g: number; b: number }): Promise<Buffer> {
    return sharp({
      create: {
        width,
        height,
        channels: 3,
        background: color
      }
    })
      .png()
      .toBuffer();
  }

  it("creates bounded image maintaining aspect ratio", async () => {
    const original = await createTestImage(2000, 1000, { r: 255, g: 0, b: 0 });
    const result = await createBoundedImage(original, 1024, "jpeg");

    expect(result.mimeType).toBe("image/jpeg");
    expect(result.width).toBe(1024);
    expect(result.height).toBe(512);
    expect(result.originalWidth).toBe(2000);
    expect(result.originalHeight).toBe(1000);
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it("does not upscale smaller images with createBoundedImage", async () => {
    const original = await createTestImage(300, 200, { r: 0, g: 255, b: 0 });
    const result = await createBoundedImage(original, 1024, "png");

    expect(result.mimeType).toBe("image/png");
    expect(result.width).toBe(300);
    expect(result.height).toBe(200);
  });

  it("extracts pixel-based crop", async () => {
    const original = await createTestImage(800, 600, { r: 0, g: 0, b: 255 });
    const result = await createCrop(
      original,
      { x: 100, y: 50, width: 200, height: 150, normalized: false },
      "jpeg"
    );

    expect(result.width).toBe(200);
    expect(result.height).toBe(150);
  });

  it("extracts normalized coordinate crop", async () => {
    const original = await createTestImage(1000, 1000, { r: 255, g: 255, b: 0 });
    const result = await createCrop(
      original,
      { x: 0.1, y: 0.2, width: 0.5, height: 0.4 },
      "jpeg"
    );

    expect(result.width).toBe(500);
    expect(result.height).toBe(400);
  });

  it("generates multi-candidate contact sheet", async () => {
    const img1 = await createTestImage(512, 512, { r: 255, g: 0, b: 0 });
    const img2 = await createTestImage(512, 512, { r: 0, g: 255, b: 0 });
    const img3 = await createTestImage(512, 512, { r: 0, g: 0, b: 255 });
    const img4 = await createTestImage(512, 512, { r: 255, g: 255, b: 0 });

    const result = await createContactSheet([
      { buffer: img1, label: "Candidate 1", seed: 1001 },
      { buffer: img2, label: "Candidate 2", seed: 1002 },
      { buffer: img3, label: "Candidate 3", seed: 1003 },
      { buffer: img4, label: "Candidate 4", seed: 1004 }
    ]);

    expect(result.mimeType).toBe("image/jpeg");
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  it("generates side-by-side comparison", async () => {
    const parentImg = await createTestImage(600, 600, { r: 100, g: 100, b: 100 });
    const childImg = await createTestImage(600, 600, { r: 200, g: 200, b: 200 });

    const result = await createSideBySideComparison(
      { buffer: parentImg, label: "Parent Run #1" },
      { buffer: childImg, label: "Revision #2" }
    );

    expect(result.mimeType).toBe("image/jpeg");
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  it("converts to MCP image content block", async () => {
    const img = await createTestImage(100, 100, { r: 255, g: 0, b: 0 });
    const mcpBlock = toMcpImageContent({ buffer: img, mimeType: "image/png" });

    expect(mcpBlock.type).toBe("image");
    expect(mcpBlock.mimeType).toBe("image/png");
    expect(typeof mcpBlock.data).toBe("string");
    expect(mcpBlock.data.length).toBeGreaterThan(0);
  });
});
