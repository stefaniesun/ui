import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { measureBorderRadius } from "./element-pixels.js";
import type { RawImage } from "./panels.js";

describe("measureBorderRadius", () => {
  const raw = async (image: sharp.Sharp): Promise<RawImage> => {
    const { data, info } = await image.removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, channels: info.channels };
  };
  /** 灰底上放一个指定圆角的白色圆角矩形 */
  const rounded = async (r: number) => {
    const svg = Buffer.from(
      `<svg width="200" height="120"><rect x="0" y="0" width="200" height="120" rx="${r}" fill="#ffffff"/></svg>`);
    return raw(sharp({ create: { width: 260, height: 180, channels: 3, background: "#f5f5f5" } })
      .composite([{ input: svg, top: 30, left: 30 }]).png());
  };
  const box = { x: 30, y: 30, w: 200, h: 120 };
  const bg: [number, number, number] = [245, 245, 245];

  it("reads a known radius off the corners", async () => {
    expect(measureBorderRadius(await rounded(24), box, bg)).toBeGreaterThanOrEqual(22);
    expect(measureBorderRadius(await rounded(24), box, bg)).toBeLessThanOrEqual(26);
  });

  it("reports zero for a square corner", async () => {
    expect(measureBorderRadius(await rounded(0), box, bg)).toBe(0);
  });

  it("scales with the radius", async () => {
    const small = measureBorderRadius(await rounded(8), box, bg);
    const large = measureBorderRadius(await rounded(40), box, bg);
    expect(large).toBeGreaterThan(small);
  });

  // 半径不可能超过短边的一半
  it("caps at half the shorter side", async () => {
    expect(measureBorderRadius(await rounded(60), box, bg)).toBeLessThanOrEqual(60);
  });

  it("returns zero for a degenerate box", async () => {
    expect(measureBorderRadius(await rounded(10), { x: 0, y: 0, w: 2, h: 2 }, bg)).toBe(0);
  });
});
