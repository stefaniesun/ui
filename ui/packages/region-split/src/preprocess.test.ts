import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { preprocessScreenshot } from "./preprocess.js";

const W = 240;
const H = 800;

/** 合成一张带手机系统外壳的图：顶部状态栏图标 + 底部 Home Indicator + 中间内容 */
async function screenshot(opts: {
  topGlyphs?: boolean; bottomIndicator?: boolean; background?: string;
} = {}): Promise<Buffer> {
  const layers: sharp.OverlayOptions[] = [];
  if (opts.topGlyphs ?? true) {
    // 左侧时间、右侧电量：两个深色小块，都在顶部 40px 内
    layers.push({ input: { create: { width: 40, height: 14, channels: 3, background: "#111111" } }, top: 12, left: 16 });
    layers.push({ input: { create: { width: 28, height: 12, channels: 3, background: "#111111" } }, top: 13, left: W - 50 });
  }
  // 中间内容：一条深色横幅，距离顶部足够远，不该被误伤
  layers.push({ input: { create: { width: W - 40, height: 60, channels: 3, background: "#3355cc" } }, top: 200, left: 20 });
  // 底部文字（不是系统外壳，必须保留）
  layers.push({ input: { create: { width: 120, height: 16, channels: 3, background: "#666666" } }, top: H - 90, left: 60 });
  if (opts.bottomIndicator ?? true) {
    layers.push({ input: { create: { width: 90, height: 8, channels: 3, background: "#000000" } }, top: H - 26, left: (W - 90) / 2 });
  }
  return sharp({ create: { width: W, height: H, channels: 3, background: opts.background ?? "#ffffff" } })
    .composite(layers).png().toBuffer();
}

async function pixelAt(png: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
}
const isDark = (p: [number, number, number]) => Math.max(...p) < 120;

describe("preprocessScreenshot", () => {
  it("keeps the native resolution — it only rewrites pixels, never resizes or crops", async () => {
    const result = await preprocessScreenshot(await screenshot());
    expect([result.width, result.height]).toEqual([W, H]);
    const meta = await sharp(result.png).metadata();
    expect([meta.width, meta.height]).toEqual([W, H]);
  });

  it("erases the top status bar glyphs", async () => {
    const src = await screenshot();
    expect(isDark(await pixelAt(src, 20, 18))).toBe(true);        // 清理前有时间文字
    const result = await preprocessScreenshot(src);
    expect(isDark(await pixelAt(result.png, 20, 18))).toBe(false); // 清理后是背景
    expect(result.removed.some(band => band.edge === "top")).toBe(true);
  });

  it("erases the bottom home indicator", async () => {
    const src = await screenshot();
    expect(isDark(await pixelAt(src, W / 2, H - 22))).toBe(true);
    const result = await preprocessScreenshot(src);
    expect(isDark(await pixelAt(result.png, W / 2, H - 22))).toBe(false);
    expect(result.removed.some(band => band.edge === "bottom")).toBe(true);
  });

  it("stops at the first clean gap so real content is never touched", async () => {
    const result = await preprocessScreenshot(await screenshot());
    // 中间的横幅（y=200..260）和底部文字（y=710..726）都是设计内容，必须原样保留
    expect(await pixelAt(result.png, W / 2, 230)).toEqual([51, 85, 204]);
    expect(isDark(await pixelAt(result.png, 100, H - 82))).toBe(true);
    for (const band of result.removed) {
      expect(band.height).toBeLessThan(H * 0.1);
    }
  });

  it("reconstructs the background from the neighbouring rows, keeping horizontal variation", async () => {
    // 左右色调不同（幅度与真实页头渐变相当）：按行填充会抹平这个差异，按列外推则保留
    const src = await sharp({ create: { width: W, height: H, channels: 3, background: "#ffffff" } })
      .composite([
        { input: { create: { width: W / 2, height: H, channels: 3, background: "#f4f4ff" } }, top: 0, left: 0 },
        { input: { create: { width: 40, height: 14, channels: 3, background: "#111111" } }, top: 12, left: 16 },
      ]).png().toBuffer();
    const result = await preprocessScreenshot(src);
    expect(result.removed.some(band => band.edge === "top")).toBe(true);
    const [left, right] = [await pixelAt(result.png, 30, 18), await pixelAt(result.png, W - 30, 18)];
    expect(isDark(left)).toBe(false);           // 图标已抹掉
    expect(left[2]).toBeGreaterThan(left[0]);   // 左半仍偏蓝，横向差异保住了
    expect(right).toEqual([255, 255, 255]);     // 右半仍是白
  });

  // 行中位色代表背景的前提是背景在这一行里占多数。左右硬分色时这个前提不成立，
  // 整个左半会被误判成"图标"。此时应当放弃清理而不是乱填——安全的失败方式。
  it("declines to clean when the row background is not dominated by one colour", async () => {
    const src = await sharp({ create: { width: W, height: H, channels: 3, background: "#ffffff" } })
      .composite([
        { input: { create: { width: W / 2, height: H, channels: 3, background: "#3355cc" } }, top: 0, left: 0 },
        { input: { create: { width: 40, height: 14, channels: 3, background: "#111111" } }, top: 12, left: 16 },
      ]).png().toBuffer();
    const result = await preprocessScreenshot(src);
    expect(result.removed).toEqual([]);
    // 原图逐像素未被改动
    expect(await pixelAt(result.png, 30, 5)).toEqual([51, 85, 204]);
    expect(await pixelAt(result.png, W - 30, 5)).toEqual([255, 255, 255]);
  });

  // 真实截图里，图标簇上方常有一两行抗锯齿噪声（占比零点几个百分点）。
  // 早先的逐行状态机会把这种噪声当成图标簇的开始、立刻在其后的留白里判定出
  // "间隙"，切出一个过小的假带并整个否决检测，真正的状态栏反而漏掉。
  it("is not fooled by a faint antialiasing row above the real glyph cluster", async () => {
    const src = await sharp({ create: { width: W, height: H, channels: 3, background: "#ffffff" } })
      .composite([
        // 极窄的噪声：只有 2px 宽，占一行的 0.8%，低于图标阈值
        { input: { create: { width: 2, height: 1, channels: 3, background: "#cccccc" } }, top: 4, left: 100 },
        // 真正的状态栏图标，与噪声之间隔着一段留白
        { input: { create: { width: 40, height: 14, channels: 3, background: "#111111" } }, top: 24, left: 16 },
      ]).png().toBuffer();
    const result = await preprocessScreenshot(src);
    const top = result.removed.find(band => band.edge === "top");
    expect(top).toBeDefined();
    expect(top!.height).toBeGreaterThan(24);          // 覆盖到真正的图标簇
    expect(isDark(await pixelAt(result.png, 20, 30))).toBe(false);
  });

  it("does nothing to an image that has no system chrome", async () => {
    const src = await screenshot({ topGlyphs: false, bottomIndicator: false });
    const result = await preprocessScreenshot(src);
    expect(result.removed).toEqual([]);
    expect(await pixelAt(result.png, W / 2, 230)).toEqual([51, 85, 204]);
  });
});
