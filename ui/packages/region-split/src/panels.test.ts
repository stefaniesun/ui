import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { crossesPanel, detectPanels, panelsFromOpenRows, rowOpenness, type RawImage } from "./panels.js";

const W = 200;

async function toRaw(png: Buffer): Promise<RawImage> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** 浅灰底 + 若干带侧边距的白卡片，和真实移动端页面同构 */
async function pageWithCards(cards: { top: number; height: number }[], height = 600): Promise<RawImage> {
  return toRaw(await sharp({ create: { width: W, height, channels: 3, background: "#f5f5f5" } })
    .composite(cards.map(card => ({
      input: { create: { width: W - 40, height: card.height, channels: 3, background: "#ffffff" } },
      top: card.top, left: 20,
    })))
    .png().toBuffer());
}

describe("rowOpenness", () => {
  it("is 1 on a row of pure page background and low inside a card", async () => {
    const raw = await pageWithCards([{ top: 100, height: 120 }]);
    expect(await rowOpenness(raw, 50)).toBe(1);          // 卡片之间
    expect(await rowOpenness(raw, 160)).toBeLessThan(0.3); // 卡片内部
  });

  // 白卡片(255) 与浅灰底(245) 的欧氏距离只有 17.3，判定阈值必须比它小，
  // 否则卡片会被当成底色，整个面板检测失效。
  it("separates a white card from a near-white page background", async () => {
    const raw = await pageWithCards([{ top: 100, height: 120 }]);
    expect(await rowOpenness(raw, 160)).toBeLessThan(0.3);
  });
});

describe("detectPanels", () => {
  it("finds each card as its own panel", async () => {
    const raw = await pageWithCards([
      { top: 60, height: 100 },
      { top: 220, height: 140 },
    ]);
    const panels = detectPanels(raw);
    expect(panels).toHaveLength(2);
    expect(panels[0]!.top).toBeCloseTo(60, -1);
    expect(panels[0]!.bottom).toBeCloseTo(160, -1);
    expect(panels[1]!.top).toBeCloseTo(220, -1);
  });

  it("returns nothing for a page with no cards", async () => {
    const raw = await toRaw(await sharp({
      create: { width: W, height: 400, channels: 3, background: "#f5f5f5" },
    }).png().toBuffer());
    expect(detectPanels(raw)).toEqual([]);
  });

  // 页面顶部大面积彩色渐变时，全局底色会被拽偏、哪一行都不匹配，
  // 整页会被误判成一整块面板。逐行取页边距颜色才不会。
  it("is not confused by a coloured header band", async () => {
    const raw = await toRaw(await sharp({ create: { width: W, height: 600, channels: 3, background: "#f5f5f5" } })
      .composite([
        { input: { create: { width: W, height: 200, channels: 3, background: "#f0c040" } }, top: 0, left: 0 },
        { input: { create: { width: W - 40, height: 120, channels: 3, background: "#ffffff" } }, top: 300, left: 20 },
      ]).png().toBuffer());
    const panels = detectPanels(raw);
    // 满宽的彩色页头不是卡片（它整行都等于自己的页边距色），只有那张白卡片是
    expect(panels).toHaveLength(1);
    expect(panels[0]!.top).toBeCloseTo(300, -1);
  });
});

describe("panelsFromOpenRows", () => {
  it("turns runs of closed rows into panels and drops noise", () => {
    const open = Array.from({ length: 60 }, (_, y) => !(y >= 10 && y < 40));
    open[50] = false;   // 单行噪声，不该成为面板
    expect(panelsFromOpenRows(open)).toEqual([{ top: 10, bottom: 40 }]);
  });
});

describe("crossesPanel", () => {
  const panels = [{ top: 100, bottom: 200 }];
  it("flags a line through the middle of a panel", () => {
    expect(crossesPanel(panels, 150)).toBe(true);
  });
  it("allows lines at the panel edges and outside it", () => {
    expect(crossesPanel(panels, 100)).toBe(false);
    expect(crossesPanel(panels, 200)).toBe(false);
    expect(crossesPanel(panels, 50)).toBe(false);
  });
});
