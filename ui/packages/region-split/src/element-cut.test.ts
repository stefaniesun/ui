import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  CUT_INSET, cutChildren, looksLikeTextRun, measureLayout, occupancy,
  symmetrizePadding, PADDING_SYMMETRY_TOLERANCE,
} from "./element-cut.js";
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
    // 下标原点就是 rect 左上角，两个数组都覆盖完整范围
    expect(rows).toHaveLength(100);
    expect(cols).toHaveLength(300);
    expect(rows[30]).toBe(true);
    expect(rows[10]).toBe(false);
    expect(cols[30]).toBe(true);
    expect(cols[100]).toBe(false);
  });

  // 内缩只该垂直于被测轴。两根轴一起内缩会宣告"贴边 6px 内没有内容"，
  // 实测让「常用服务」的标签框矮了 6px、字号从 37 算成 30。
  it("still sees content flush against the edge", async () => {
    const image = await raw(
      sharp({ create: { width: 100, height: 100, channels: 3, background: "#ffffff" } })
        .composite([{
          input: { create: { width: 100, height: 4, channels: 3, background: "#202020" } },
          top: 96, left: 0,
        }]).png());
    const { rows } = occupancy(image, { x: 0, y: 0, w: 100, h: 100 }, [255, 255, 255]);
    expect(rows[99]).toBe(true);
    expect(rows[96]).toBe(true);
    expect(rows[95]).toBe(false);
  });

  // 一条左边框会让每一行都有内容、把竖切彻底堵死，这才是内缩要防的东西
  it("ignores a side border when marking rows", async () => {
    const image = await raw(
      sharp({ create: { width: 100, height: 100, channels: 3, background: "#ffffff" } })
        .composite([{
          input: { create: { width: 2, height: 100, channels: 3, background: "#202020" } },
          top: 0, left: 0,
        }]).png());
    const { rows, cols } = occupancy(
      image, { x: 0, y: 0, w: 100, h: 100 }, [255, 255, 255], CUT_INSET);
    expect(rows.some(Boolean)).toBe(false);   // 左边框被 dx 排除，行仍然是空的
    expect(cols[0]).toBe(true);               // 但它自己所在的列照常记为有内容
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
  // 切完就地把子块沿交叉轴收紧到真实内容范围：三个 40×40 的黑块位于 y=30，
  // 结果就该是 40×40 而不是继承父高的 40×100。
  // 不收紧的话叶子的 Y 轴数据全是假的——它们没有"下一层"去收紧。
  it("cuts a row into its columns and tightens them vertically", async () => {
    const image = await raw(threeColumns());
    expect(cutChildren(image, { x: 0, y: 0, w: 300, h: 100 }, "row")).toEqual([
      { x: 30, y: 30, w: 40, h: 40 },
      { x: 130, y: 30, w: 40, h: 40 },
      { x: 230, y: 30, w: 40, h: 40 },
    ]);
  });

  it("cuts a column into its rows", async () => {
    const image = await raw(
      sharp({ create: { width: 100, height: 200, channels: 3, background: "#ffffff" } })
        .composite([
          { input: { create: { width: 60, height: 20, channels: 3, background: "#202020" } }, top: 20, left: 20 },
          { input: { create: { width: 60, height: 20, channels: 3, background: "#202020" } }, top: 120, left: 20 },
        ]).png());
    // 纵切的交叉轴是 X，同样收紧到内容真实横向范围（黑块在 x=20 宽 60）
    expect(cutChildren(image, { x: 0, y: 0, w: 100, h: 200 }, "column")).toEqual([
      { x: 20, y: 20, w: 60, h: 20 },
      { x: 20, y: 120, w: 60, h: 20 },
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

describe("looksLikeTextRun", () => {
  const runs = (spans: [number, number][]) =>
    spans.map(([start, length]) => ({ start, end: start + length }));

  // 实测「猜你喜欢」这个 216×90 的胶囊被逐字切成 4 个 34×90 的块，字距只有 2
  it("recognises a line of glyphs by its tiny tracking", () => {
    expect(looksLikeTextRun(runs([[37, 34], [73, 34], [109, 34], [145, 34]]))).toBe(true);
  });

  // 实测「企业采购」这行字距偏宽（比值 0.173），是两侧数据里最靠近阈值的文字样本
  it("recognises a line with wider tracking", () => {
    expect(looksLikeTextRun(runs([
      [6, 28], [38, 13], [55, 13], [74, 30], [109, 26],
    ]))).toBe(true);
  });

  // 判别量是"间隙 / 子块尺寸"，不是间隙绝对值——下面这些都是真正的并列元素
  it("does not mistake real columns for text", () => {
    // 常用服务五格：间隙 98，子块约 140
    expect(looksLikeTextRun(runs([[38, 142], [257, 141], [496, 103]]))).toBe(false);
    // 关注领券两列：间隙 55，子块 182 / 89
    expect(looksLikeTextRun(runs([[32, 182], [269, 89]]))).toBe(false);
    // 关注领券文案列两行：间隙 19，子块 40 / 34
    expect(looksLikeTextRun(runs([[45, 40], [104, 34]]))).toBe(false);
  });

  it("returns false for a single run", () => {
    expect(looksLikeTextRun(runs([[0, 100]]))).toBe(false);
  });
});

describe("symmetrizePadding", () => {
  // 实测左右差 0/2/3/4/6 是测量噪声，17/20/40 是真实不对称
  it("averages a pair that differs within tolerance", () => {
    expect(symmetrizePadding({ top: 44, right: 38, bottom: 45, left: 32 }))
      .toEqual({ top: 45, right: 35, bottom: 45, left: 35 });
  });

  it("leaves a genuinely asymmetric pair alone", () => {
    expect(symmetrizePadding({ top: 79, right: 58, bottom: 56, left: 38 }))
      .toEqual({ top: 79, right: 58, bottom: 56, left: 38 });
  });

  // 断层就在 6 与 17 之间，阈值 8 两边都要钉住
  it("takes 8 but not 9", () => {
    expect(symmetrizePadding({ top: 0, right: 54, bottom: 0, left: 46 }))
      .toEqual({ top: 0, right: 50, bottom: 0, left: 50 });
    expect(symmetrizePadding({ top: 0, right: 55, bottom: 0, left: 46 }))
      .toEqual({ top: 0, right: 55, bottom: 0, left: 46 });
    expect(PADDING_SYMMETRY_TOLERANCE).toBe(8);
  });

  // 一半是 0 时不能抹：那是"内容贴着一边"，不是噪声
  it("keeps a zero side as zero", () => {
    expect(symmetrizePadding({ top: 0, right: 0, bottom: 0, left: 6 }))
      .toEqual({ top: 0, right: 0, bottom: 0, left: 6 });
  });

  it("handles the two axes independently", () => {
    expect(symmetrizePadding({ top: 10, right: 40, bottom: 12, left: 12 }))
      .toEqual({ top: 11, right: 40, bottom: 11, left: 12 });
  });
});

describe("measureLayout 的内边距", () => {
  // 左 32 / 右 34 差 2，应当被抹成 33
  it("returns symmetrized padding", () => {
    const layout = measureLayout(
      { x: 0, y: 0, w: 100, h: 50 },
      [{ x: 32, y: 10, w: 15, h: 30 }, { x: 52, y: 10, w: 14, h: 30 }],
      "row",
    );
    expect(layout.padding.left).toBe(33);
    expect(layout.padding.right).toBe(33);
  });
});
