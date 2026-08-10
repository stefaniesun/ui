import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { normalizeReference } from "./normalization.js";

const input = join(process.cwd(), "normalize-input.png");
const output = join(process.cwd(), "normalize-output.png");
afterEach(async () => {
  await Promise.all([unlink(input).catch(() => undefined), unlink(output).catch(() => undefined)]);
});

describe("reference normalization", () => {
  it("normalizes a 2x screenshot to logical pixels", async () => {
    await sharp({ create: { width: 750, height: 1624, channels: 3, background: "#ffffff" } }).png().toFile(input);
    const result = await normalizeReference(input, { outputPath: output, logicalWidth: 375 });
    expect(result.scale).toBe(2);
    expect(result.logicalSize).toEqual({ w: 375, h: 812 });
    await expect(sharp(output).metadata()).resolves.toMatchObject({ width: 375, height: 812 });
  });

  it("records and applies crop coordinates", async () => {
    await sharp({ create: { width: 100, height: 200, channels: 3, background: "#ffffff" } }).png().toFile(input);
    const crop = { x: 0, y: 20, w: 100, h: 180 };
    const result = await normalizeReference(input, { outputPath: output, logicalWidth: 100, statusBarCrop: crop });
    expect(result.statusBarCrop).toEqual(crop);
    expect(result.logicalSize).toEqual({ w: 100, h: 180 });
  });
});
