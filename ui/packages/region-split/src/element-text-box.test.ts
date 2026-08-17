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

import { checkTextBox } from "./element-text-box.js";
import { readFile } from "node:fs/promises";

/** 基准图上的真实文字框，坐标是原图像素 */
const FIXTURE = "test-fixtures/maicai.png";
async function fixture(): Promise<RawImage> {
  return raw(sharp(await readFile(FIXTURE)));
}

describe("checkTextBox", () => {
  // 实测：5 段，段宽 34/32/34/13/18，中位数 32 / 墨高 34 = 0.94
  it("accepts a clean single line", async () => {
    const check = checkTextBox(await fixture(), { x: 74, y: 1290, w: 142, h: 34 });
    expect(check.ok).toBe(true);
    expect(check.bands).toBe(1);
    expect(check.glyphAspect).toBeCloseTo(0.94, 2);
  });

  // 实测：5 段，段宽中位数 49 / 墨高 51 = 0.96。大字也得过
  it("accepts a larger single line", async () => {
    const check = checkTextBox(await fixture(), { x: 269, y: 236, w: 239, h: 51 });
    expect(check.ok).toBe(true);
  });

  // 实测：墨迹 476..478 与 528..561 两段，框上方多包了 50px 空白
  it("rejects a box that swallowed blank space", async () => {
    const check = checkTextBox(await fixture(), { x: 74, y: 475, w: 141, h: 87 });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("multi-band");
    expect(check.bands).toBe(2);
  });

  // 实测：列投影只有 1 段、整条 216 宽连成一片，216 / 90 = 2.40
  it("rejects a box whose content is not glyph-shaped", async () => {
    const check = checkTextBox(await fixture(), { x: 36, y: 1821, w: 216, h: 90 });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("wide-glyph");
    expect(check.glyphAspect).toBeCloseTo(2.4, 1);
  });

  // 只卡上界：西文字形本来就窄，卡下界会把正常西文全部误判
  it("does not reject narrow glyphs", async () => {
    const narrow = await raw(
      sharp({ create: { width: 60, height: 40, channels: 3, background: "#ffffff" } })
        .composite([0, 20, 40].map(left => ({
          input: { create: { width: 6, height: 30, channels: 3, background: "#101010" } },
          top: 5, left,
        }))).png());
    const check = checkTextBox(narrow, { x: 0, y: 0, w: 60, h: 40 });
    expect(check.glyphAspect).toBeLessThan(0.5);
    expect(check.ok).toBe(true);
  });

  it("rejects a box with no ink at all", async () => {
    const blank = await raw(
      sharp({ create: { width: 40, height: 20, channels: 3, background: "#ffffff" } }).png());
    expect(checkTextBox(blank, { x: 0, y: 0, w: 40, h: 20 }).ok).toBe(false);
  });
});
