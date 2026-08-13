import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { CUT_INSET, cutChildren, measureLayout, occupancy } from "./element-cut.js";
import type { RawImage } from "./panels.js";

async function raw(image: sharp.Sharp): Promise<RawImage> {
  const { data, info } = await image.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** 白卡片里三个等距黑块，模拟一行并列单元 */
const threeColumns = () =>
  sharp({ create: { width: 300, height: 100, channels: 3, background: "#ffffff" } })
    .composite([
      { input: { create: { width: 40, height: 40, channels: 3, background: "#202020" } }, top: 30, left: 30 },
      { input: { create: { width: 40, height: 40, channels: 3, background: "#202020" } }, top: 30, left: 130 },
      { input: { create: { width: 40, height: 40, channels: 3, background: "#202020" } }, top: 30, left: 230 },
    ]).png();

describe("occupancy", () => {
  it("marks the rows and columns that carry content", async () => {
    const image = await raw(threeColumns());
    const { rows, cols } = occupancy(image, { x: 0, y: 0, w: 300, h: 100 }, [255, 255, 255]);
    // 下标原点是内缩之后的左上角
    expect(rows[30 - CUT_INSET]).toBe(true);
    expect(rows[10 - CUT_INSET]).toBe(false);
    expect(cols[30 - CUT_INSET]).toBe(true);
    expect(cols[100 - CUT_INSET]).toBe(false);
  });

  it("marks nothing on a flat block", async () => {
    const image = await raw(
      sharp({ create: { width: 100, height: 100, channels: 3, background: "#ffffff" } }).png());
    const { rows, cols } = occupancy(image, { x: 0, y: 0, w: 100, h: 100 }, [255, 255, 255]);
    expect(rows.some(Boolean)).toBe(false);
    expect(cols.some(Boolean)).toBe(false);
  });
});

describe("cutChildren", () => {
  // 横切出来的列在交叉轴上继承父块的完整高度——这是 X-Y cut 的固有形态，
  // 交叉轴边界由下一层反方向切分收紧，好处是兄弟天然不重叠
  it("cuts a row into its columns", async () => {
    const image = await raw(threeColumns());
    expect(cutChildren(image, { x: 0, y: 0, w: 300, h: 100 }, "row")).toEqual([
      { x: 30, y: 0, w: 40, h: 100 },
      { x: 130, y: 0, w: 40, h: 100 },
      { x: 230, y: 0, w: 40, h: 100 },
    ]);
  });

  it("cuts a column into its rows", async () => {
    const image = await raw(
      sharp({ create: { width: 100, height: 200, channels: 3, background: "#ffffff" } })
        .composite([
          { input: { create: { width: 60, height: 20, channels: 3, background: "#202020" } }, top: 20, left: 20 },
          { input: { create: { width: 60, height: 20, channels: 3, background: "#202020" } }, top: 120, left: 20 },
        ]).png());
    expect(cutChildren(image, { x: 0, y: 0, w: 100, h: 200 }, "column")).toEqual([
      { x: 0, y: 20, w: 100, h: 20 },
      { x: 0, y: 120, w: 100, h: 20 },
    ]);
  });

  it("returns nothing when the box holds a single block", async () => {
    const image = await raw(
      sharp({ create: { width: 100, height: 100, channels: 3, background: "#ffffff" } })
        .composite([{
          input: { create: { width: 40, height: 40, channels: 3, background: "#202020" } },
          top: 30, left: 30,
        }]).png());
    expect(cutChildren(image, { x: 0, y: 0, w: 100, h: 100 }, "row")).toEqual([]);
  });

  it("returns nothing for a flat block", async () => {
    const image = await raw(
      sharp({ create: { width: 100, height: 100, channels: 3, background: "#ffffff" } }).png());
    expect(cutChildren(image, { x: 0, y: 0, w: 100, h: 100 }, "row")).toEqual([]);
  });

  it("produces children that never escape the parent", async () => {
    const image = await raw(threeColumns());
    const parent = { x: 0, y: 0, w: 300, h: 100 };
    for (const child of cutChildren(image, parent, "row")) {
      expect(child.x).toBeGreaterThanOrEqual(parent.x);
      expect(child.x + child.w).toBeLessThanOrEqual(parent.x + parent.w);
      expect(child.y).toBeGreaterThanOrEqual(parent.y);
      expect(child.y + child.h).toBeLessThanOrEqual(parent.y + parent.h);
    }
  });
});

describe("measureLayout", () => {
  it("measures gap and padding from the children", () => {
    const layout = measureLayout(
      { x: 0, y: 0, w: 300, h: 100 },
      [
        { x: 30, y: 0, w: 40, h: 100 },
        { x: 130, y: 0, w: 40, h: 100 },
        { x: 230, y: 0, w: 40, h: 100 },
      ],
      "row",
    );
    expect(layout.direction).toBe("row");
    expect(layout.gap).toBe(60);
    expect(layout.padding).toEqual({ top: 0, right: 30, bottom: 0, left: 30 });
  });

  it("uses the median when gaps are uneven", () => {
    const layout = measureLayout(
      { x: 0, y: 0, w: 400, h: 50 },
      [
        { x: 0, y: 0, w: 50, h: 50 },
        { x: 60, y: 0, w: 50, h: 50 },
        { x: 130, y: 0, w: 50, h: 50 },
      ],
      "row",
    );
    expect(layout.gap).toBe(15);
  });

  it("reports zero gap for a single child", () => {
    const layout = measureLayout(
      { x: 0, y: 0, w: 100, h: 100 }, [{ x: 10, y: 10, w: 80, h: 80 }], "column",
    );
    expect(layout.gap).toBe(0);
    expect(layout.padding).toEqual({ top: 10, right: 10, bottom: 10, left: 10 });
  });

  it("measures a column layout along the vertical axis", () => {
    const layout = measureLayout(
      { x: 0, y: 0, w: 100, h: 200 },
      [{ x: 0, y: 20, w: 100, h: 20 }, { x: 0, y: 120, w: 100, h: 20 }],
      "column",
    );
    expect(layout.direction).toBe("column");
    expect(layout.gap).toBe(80);
    expect(layout.padding).toEqual({ top: 20, right: 0, bottom: 60, left: 0 });
  });

  it("never reports a negative gap or padding", () => {
    const layout = measureLayout(
      { x: 10, y: 10, w: 50, h: 50 },
      [{ x: 0, y: 0, w: 100, h: 100 }],
      "row",
    );
    expect(layout.gap).toBeGreaterThanOrEqual(0);
    expect(Object.values(layout.padding).every(v => v >= 0)).toBe(true);
  });
});
