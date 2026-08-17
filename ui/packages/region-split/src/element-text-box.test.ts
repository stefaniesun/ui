import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { inkCols, inkRows } from "./element-text-box.js";
import { runsFromOccupancy } from "./element-runs.js";
import type { RawImage } from "./panels.js";

async function raw(image: sharp.Sharp): Promise<RawImage> {
  const { data, info } = await image.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** 白底上两个黑块，中间横向留白 20px、纵向留白 10px */
const twoBlocks = () =>
  sharp({ create: { width: 100, height: 50, channels: 3, background: "#ffffff" } })
    .composite([
      { input: { create: { width: 20, height: 20, channels: 3, background: "#101010" } }, top: 10, left: 10 },
      { input: { create: { width: 20, height: 20, channels: 3, background: "#101010" } }, top: 10, left: 50 },
    ]).png();

describe("inkRows", () => {
  it("marks only the rows that carry ink", async () => {
    const rows = inkRows(await raw(twoBlocks()), { x: 0, y: 0, w: 100, h: 50 });
    expect(rows).toHaveLength(50);
    expect(rows[9]).toBe(false);
    expect(rows[10]).toBe(true);
    expect(rows[29]).toBe(true);
    expect(rows[30]).toBe(false);
  });

  // 浅灰的抗锯齿边缘不算墨：阈值只认明显是笔画的像素
  it("ignores near-white pixels", async () => {
    const faint = sharp({ create: { width: 20, height: 10, channels: 3, background: "#f2f2f2" } }).png();
    expect(inkRows(await raw(faint), { x: 0, y: 0, w: 20, h: 10 }).some(Boolean)).toBe(false);
  });
});

describe("inkCols", () => {
  it("separates the two blocks into two runs", async () => {
    const cols = inkCols(await raw(twoBlocks()), { x: 0, y: 0, w: 100, h: 50 });
    expect(runsFromOccupancy(cols)).toEqual([
      { start: 10, end: 30 },
      { start: 50, end: 70 },
    ]);
  });
});
