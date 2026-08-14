import { describe, expect, it } from "vitest";
import {
  FONT_WEIGHTS, REFERENCE_SIZE, fitFontSize, matchFont, type MetricsSource,
} from "./font-metrics.js";

/**
 * 假的渲染源。数值取自浏览器里的真实测量，这样单测验的是拟合与选择逻辑，
 * 而不是 canvas 本身——jsdom 没有真实 canvas，渲染只能靠手工验收。
 */
function source(
  ratios: Record<string, Partial<Record<number, number>>>,
  coverages: Record<string, Partial<Record<number, number>>>,
): MetricsSource {
  return {
    inkHeightAtReference: (text, weight) =>
      (ratios[text]?.[weight] ?? 0) * REFERENCE_SIZE,
    coverage: (text, weight) => coverages[text]?.[weight] ?? 0,
  };
}

describe("fitFontSize", () => {
  // 实测：联系客服在 100px 下墨高 94，即比例 0.940
  it("derives the size from this very string's ratio", () => {
    const s = source({ 联系客服: { 400: 0.94 } }, {});
    expect(fitFontSize(s, "联系客服", 400, 28)).toBeCloseTo(29.8, 1);
  });

  // 同一字体下比例随内容差 34%，所以绝不能用固定系数
  it("gives different sizes for the same ink height on different text", () => {
    const s = source({ 联系客服: { 400: 0.94 }, "¥18": { 400: 0.77 } }, {});
    const cjk = fitFontSize(s, "联系客服", 400, 28)!;
    const digits = fitFontSize(s, "¥18", 400, 28)!;
    expect(digits).toBeGreaterThan(cjk);
    expect(digits / cjk).toBeCloseTo(0.94 / 0.77, 2);
  });

  it("returns null without a usable ink height", () => {
    const s = source({ x: { 400: 0.9 } }, {});
    expect(fitFontSize(s, "x", 400, 0)).toBeNull();
    expect(fitFontSize(s, "x", 400, -5)).toBeNull();
  });

  it("returns null when the font cannot be measured", () => {
    expect(fitFontSize(source({}, {}), "x", 400, 28)).toBeNull();
  });
});

describe("matchFont", () => {
  // 三组数字全部来自浏览器实测
  const measured = source(
    {
      关注领券: { 400: 0.94, 500: 0.94, 700: 0.96 },
      免费领30元: { 400: 0.94, 500: 0.94, 700: 0.96 },
      联系客服: { 400: 0.94, 500: 0.96, 700: 0.97 },
    },
    {
      关注领券: { 400: 0.354, 500: 0.415, 700: 0.490 },
      免费领30元: { 400: 0.360, 500: 0.437, 700: 0.510 },
      联系客服: { 400: 0.451, 500: 0.522, 700: 0.604 },
    },
  );

  it("calls the bold-looking title medium", () => {
    const match = matchFont(measured, "关注领券", 40, 0.431)!;
    expect(match.fontWeight).toBe(500);
    expect(match.fontSize).toBeCloseTo(42.6, 0);
  });

  it("calls the subtitle regular", () => {
    expect(matchFont(measured, "免费领30元", 34, 0.344)!.fontWeight).toBe(400);
  });

  it("calls the small label regular", () => {
    const match = matchFont(measured, "联系客服", 28, 0.429)!;
    expect(match.fontWeight).toBe(400);
    expect(match.fontSize).toBeCloseTo(29.8, 0);
  });

  // 最优要明显甩开次优，否则这个判定不该被信任
  it("reports a margin over the runner up", () => {
    const match = matchFont(measured, "联系客服", 28, 0.429)!;
    expect(match.error).toBeLessThan(0.03);
    expect(match.margin).toBeGreaterThan(0.05);
  });

  it("tries every candidate weight", () => {
    const seen: number[] = [];
    const spy: MetricsSource = {
      inkHeightAtReference: (_t, w) => { seen.push(w); return 94; },
      coverage: () => 0.4,
    };
    matchFont(spy, "文字", 28, 0.4);
    expect(seen).toEqual([...FONT_WEIGHTS]);
  });

  it("returns null for blank text", () => {
    expect(matchFont(measured, "   ", 28, 0.4)).toBeNull();
  });

  it("returns null when nothing can be rendered", () => {
    expect(matchFont(source({}, {}), "文字", 28, 0.4)).toBeNull();
  });

  it("returns null without a measured coverage", () => {
    expect(matchFont(measured, "联系客服", 28, 0)).toBeNull();
  });
});
