import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { rgbToLab, sampleMedianColor } from "./color.js";

const fixture = join(process.cwd(), "color-fixture.png");
afterEach(() => unlink(fixture).catch(() => undefined));

describe("color measurement", () => {
  it("converts known colors to Lab", () => {
    const white = rgbToLab(255, 255, 255);
    expect(white[0]).toBeCloseTo(100, 1);
    expect(white[1]).toBeCloseTo(0, 1);
    expect(white[2]).toBeCloseTo(0, 1);
  });

  it("samples a region median", async () => {
    await sharp({ create: { width: 2, height: 2, channels: 3, background: "#336699" } }).png().toFile(fixture);
    const sample = await sampleMedianColor(fixture, { x: 0, y: 0, w: 2, h: 2 }, "accent");
    expect(sample.hex).toBe("#336699");
    expect(sample.sampleRegion).toEqual({ x: 0, y: 0, w: 2, h: 2 });
  });
});
