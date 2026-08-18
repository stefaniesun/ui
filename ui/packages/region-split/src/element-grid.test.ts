import { describe, expect, it } from "vitest";
import { centersOf, detectRepeat, detectScroll, pitchesOf } from "./element-grid.js";
import type { Rect } from "./types.js";

/** 用 [x, 宽] 描述一行并列子块 */
const row = (spans: [number, number][]): Rect[] =>
  spans.map(([x, w]) => ({ x, y: 0, w, h: 100 }));

describe("centersOf / pitchesOf", () => {
  it("measures centre to centre spacing along the main axis", () => {
    const boxes = row([[0, 100], [220, 100], [440, 100]]);
    expect(centersOf(boxes, "row")).toEqual([50, 270, 490]);
    expect(pitchesOf(centersOf(boxes, "row"))).toEqual([220, 220]);
  });

  it("measures along the vertical axis for a column", () => {
    const boxes = [
      { x: 0, y: 0, w: 100, h: 40 },
      { x: 0, y: 60, w: 100, h: 40 },
    ];
    expect(centersOf(boxes, "column")).toEqual([20, 80]);
  });
});

describe("detectRepeat", () => {
  // 实测常用服务卡片列心间距 218.5 / 220.0 / 218.0 / 220.0，全部落在 ±4 内
  it("marks an evenly pitched row as a repeat", () => {
    const boxes = row([[38, 142], [257, 141], [496, 103], [714, 103], [915, 141]]);
    const repeat = detectRepeat(boxes, "row");
    expect(repeat).not.toBeNull();
    expect(repeat!.count).toBe(5);
    expect(Math.abs(repeat!.pitch - 219.5)).toBeLessThanOrEqual(1);
  });

  // 模板不能取被截断的那个：它偏小，照它生成会漏内容
  it("picks the largest child as the template", () => {
    const boxes = row([[36, 216], [276, 216], [516, 252], [792, 180], [996, 138]]);
    const repeat = detectRepeat(boxes, "row");
    if (repeat) expect(repeat.templateIndex).toBe(2);
  });

  it("refuses when the pitch is uneven", () => {
    expect(detectRepeat(row([[0, 50], [100, 50], [400, 50]]), "row")).toBeNull();
  });

  it("refuses with fewer than three children", () => {
    expect(detectRepeat(row([[0, 50], [100, 50]]), "row")).toBeNull();
  });

  // 入参顺序不可信：recomputeLayout 给的是数组顺序，而 AI 重构可以任意排列
  it("finds the repeat whatever the input order", () => {
    const boxes = [
      { x: 200, y: 0, w: 40, h: 40 },
      { x: 0, y: 0, w: 40, h: 40 },
      { x: 100, y: 0, w: 40, h: 40 },
    ];
    const repeat = detectRepeat(boxes, "row")!;
    expect(repeat).not.toBeNull();
    expect(repeat.pitch).toBe(100);
  });

  // templateIndex 是下标，调用方（element-detect.ts、element-layout.ts）都拿它去
  // "入参数组"里取模板节点。detectRepeat 内部要按主轴排序才能算对 pitch，
  // 但绝不能把排序后的下标当成 templateIndex 返回——那样会静默指错模板。
  it("keeps templateIndex relative to the input array, not the sorted one", () => {
    const boxes = [
      { x: 80, y: 0, w: 80, h: 40 }, // 最大的一个，输入顺序里排第 0 位
      { x: 200, y: 0, w: 40, h: 40 },
      { x: 0, y: 0, w: 40, h: 40 },
    ];
    const repeat = detectRepeat(boxes, "row")!;
    expect(repeat).not.toBeNull();
    expect(boxes[repeat.templateIndex]).toBe(boxes[0]);
  });
});

describe("detectRepeat 的槽位", () => {
  // 实测「快捷功能菜单」×5：宽 142/141/103/103/141、高 132/134/172/129/134。
  // 槽位取中位数而不是最大值——172 是框切错了，取最大会把整行撑高。
  it("takes the median of the children, not the maximum", () => {
    const boxes = [
      { x: 38, y: 192, w: 142, h: 132 },
      { x: 257, y: 190, w: 141, h: 134 },
      { x: 496, y: 196, w: 103, h: 172 },
      { x: 714, y: 195, w: 103, h: 129 },
      { x: 915, y: 190, w: 141, h: 134 },
    ];
    expect(detectRepeat(boxes, "row")!.slot).toEqual({ w: 141, h: 134 });
  });

  it("rounds the slot to whole pixels", () => {
    const boxes = [
      { x: 0, y: 0, w: 50, h: 41 },
      { x: 100, y: 0, w: 51, h: 40 },
      { x: 200, y: 0, w: 52, h: 42 },
      { x: 300, y: 0, w: 51, h: 40 },
    ];
    const repeat = detectRepeat(boxes, "row")!;
    expect(Number.isInteger(repeat.slot.w)).toBe(true);
    expect(Number.isInteger(repeat.slot.h)).toBe(true);
  });
});

describe("detectScroll", () => {
  // 实测分类胶囊：宽 216/216/252/180/138，间隙恒为 24，末块右端 1134，
  // 右余量 36 == 左边距 36。末块显著小于其余中位且贴住内容右边缘 = 被截断。
  it("flags a clipped last child as horizontally scrollable", () => {
    const boxes = row([[36, 216], [276, 216], [516, 252], [792, 180], [996, 138]]);
    expect(detectScroll({ x: 0, y: 0, w: 1170, h: 100 }, boxes, "row", 36)).toBe(true);
  });

  // 实测卡券资产列宽 141/105/103/140/105：末块只是文字短，不是被截断
  it("does not flag a merely narrower last child", () => {
    const boxes = row([[38, 141], [257, 105], [496, 103], [714, 140], [915, 105]]);
    expect(detectScroll({ x: 0, y: 0, w: 1098, h: 100 }, boxes, "row", 38)).toBe(false);
  });

  // 实测常用服务列宽 142/141/103/103/141
  it("does not flag an evenly filled row", () => {
    const boxes = row([[38, 142], [257, 141], [496, 103], [714, 103], [915, 141]]);
    expect(detectScroll({ x: 0, y: 0, w: 1098, h: 100 }, boxes, "row", 38)).toBe(false);
  });

  // 只看尺寸会误判：末块虽小，但离父边还很远，说明它本来就短
  it("does not flag a small last child that is far from the edge", () => {
    const boxes = row([[0, 200], [220, 200], [440, 60]]);
    expect(detectScroll({ x: 0, y: 0, w: 1170, h: 100 }, boxes, "row", 0)).toBe(false);
  });

  it("returns false with fewer than three children", () => {
    expect(detectScroll({ x: 0, y: 0, w: 200, h: 100 }, row([[0, 50], [60, 20]]), "row", 0))
      .toBe(false);
  });
});
