import { join } from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  connectedBoxes, detectTopLevel, regionBackground, toHex, uniformity,
} from "./element-detect.js";
import { checkElementTreeInvariants } from "./element-types.js";
import type { RawImage } from "./panels.js";
import type { Rect } from "./types.js";

const NOW = "2026-08-13T00:00:00.000Z";

async function raw(image: sharp.Sharp): Promise<RawImage> {
  const { data, info } = await image.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** 灰底上两张白卡片 */
const page = () =>
  sharp({ create: { width: 200, height: 300, channels: 3, background: "#f5f5f5" } })
    .composite([
      { input: { create: { width: 160, height: 80, channels: 3, background: "#ffffff" } }, top: 20, left: 20 },
      { input: { create: { width: 160, height: 80, channels: 3, background: "#ffffff" } }, top: 160, left: 20 },
    ]).png();

async function noiseImage(width: number, height: number): Promise<Buffer> {
  const bytes = Buffer.alloc(width * height * 3);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 97) % 256;
  return sharp(bytes, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

describe("toHex", () => {
  it("formats a colour as lowercase hex", () => {
    expect(toHex([255, 255, 255])).toBe("#ffffff");
    expect(toHex([245, 246, 250])).toBe("#f5f6fa");
  });
});

describe("regionBackground", () => {
  it("reads the page colour from the left and right margins", async () => {
    expect(regionBackground(await raw(page()), { x: 0, y: 0, w: 200, h: 300 }))
      .toEqual([245, 245, 245]);
  });
});

describe("uniformity", () => {
  it("returns 1 for a flat rectangle", async () => {
    const result = uniformity(await raw(page()), { x: 20, y: 20, w: 160, h: 80 });
    expect(result.fill).toEqual([255, 255, 255]);
    expect(result.ratio).toBeCloseTo(1, 2);
  });

  it("returns a low ratio for noisy content", async () => {
    const image = await raw(sharp(await noiseImage(60, 60)));
    expect(uniformity(image, { x: 0, y: 0, w: 60, h: 60 }).ratio).toBeLessThan(0.1);
  });
});

describe("connectedBoxes", () => {
  it("finds each card as its own box", async () => {
    expect(connectedBoxes(await raw(page()), { x: 0, y: 0, w: 200, h: 300 }, [245, 245, 245]))
      .toEqual([
        { x: 20, y: 20, w: 160, h: 80 },
        { x: 20, y: 160, w: 160, h: 80 },
      ]);
  });

  it("drops blocks below the minimum size", async () => {
    const image = await raw(
      sharp({ create: { width: 200, height: 100, channels: 3, background: "#f5f5f5" } })
        .composite([{
          input: { create: { width: 20, height: 10, channels: 3, background: "#000000" } },
          top: 10, left: 10,
        }]).png());
    expect(connectedBoxes(image, { x: 0, y: 0, w: 200, h: 100 }, [245, 245, 245])).toEqual([]);
  });
});

describe("detectTopLevel", () => {
  const region: Rect = { x: 0, y: 0, w: 200, h: 300 };

  it("produces a flat tree of containers", async () => {
    const tree = detectTopLevel(await raw(page()), region, NOW);
    expect(tree.regionKey).toBe("0-300");
    expect(tree.detectedAt).toBe(NOW);
    expect(tree.nodes).toHaveLength(2);
    expect(tree.nodes.every(node => node.parentId === null)).toBe(true);
    expect(checkElementTreeInvariants(tree, region)).toEqual([]);
  });

  it("records the flat container background", async () => {
    const tree = detectTopLevel(await raw(page()), region, NOW);
    expect(tree.nodes[0]!.kind).toBe("component");
    expect(tree.nodes[0]!.style.background).toBe("#ffffff");
  });

  // 内部主色占比一个数就把 <div> 和 <img> 分开：实测白卡片 0.83–0.96，位图 0.02
  it("marks a raster block as an image leaf", async () => {
    const image = await raw(
      sharp({ create: { width: 300, height: 200, channels: 3, background: "#f5f5f5" } })
        .composite([{ input: await noiseImage(200, 120), top: 40, left: 50 }]).png());
    const tree = detectTopLevel(image, { x: 0, y: 0, w: 300, h: 200 }, NOW);
    expect(tree.nodes).toHaveLength(1);
    expect(tree.nodes[0]!.kind).toBe("image");
    expect(tree.nodes[0]!.style.background).toBeUndefined();
  });

  it("returns no nodes for a blank region", async () => {
    const image = await raw(
      sharp({ create: { width: 200, height: 100, channels: 3, background: "#f5f5f5" } }).png());
    expect(detectTopLevel(image, { x: 0, y: 0, w: 200, h: 100 }, NOW).nodes).toEqual([]);
  });

  it("gives every node a placeholder name", async () => {
    const tree = detectTopLevel(await raw(page()), region, NOW);
    expect(tree.nodes.every(node => node.displayName.length > 0)).toBe(true);
    expect(tree.nodes.every(node => node.source === "auto")).toBe(true);
  });
});

// 真实截图回归：这些数值是这套算法唯一的事实基准，不得为了让测试变绿而放宽
describe("real screenshot", () => {
  const FIXTURE = join(import.meta.dirname, "..", "test-fixtures", "maicai.png");
  const fixture = async (): Promise<RawImage> => {
    const { data, info } = await sharp(FIXTURE).removeAlpha().raw()
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, channels: info.channels };
  };

  it("frames the common-service card exactly", async () => {
    const tree = detectTopLevel(await fixture(), { x: 0, y: 1131, w: 1170, h: 255 }, NOW);
    expect(tree.nodes).toHaveLength(1);
    expect(tree.nodes[0]!.box).toEqual({ x: 36, y: 1131, w: 1098, h: 255 });
    expect(tree.nodes[0]!.kind).toBe("component");
  });

  it("frames the card-wallet card exactly", async () => {
    const tree = detectTopLevel(await fixture(), { x: 0, y: 396, w: 1170, h: 222 }, NOW);
    expect(tree.nodes[0]!.box).toEqual({ x: 36, y: 396, w: 1098, h: 222 });
  });

  it("treats the promotional banner as an image", async () => {
    const image = await fixture();
    expect(uniformity(image, { x: 36, y: 1413, w: 1098, h: 216 }).ratio).toBeLessThan(0.1);
    const tree = detectTopLevel(image, { x: 0, y: 1413, w: 1170, h: 216 }, NOW);
    expect(tree.nodes[0]!.kind).toBe("image");
  });

  it("finds three separate coupon cards", async () => {
    const tree = detectTopLevel(await fixture(), { x: 0, y: 921, w: 1170, h: 183 }, NOW);
    expect(tree.nodes).toHaveLength(3);
    expect(tree.nodes.map(node => node.box.x)).toEqual([36, 459, 882]);
  });

  // 已知失败面：白底连白底会并块。如实断言，不要假装不存在——
  // 拆开它是阶段二递归切分的事，阶段一由人工框选处理。
  it("merges the product grid with the tab bar, as expected at this stage", async () => {
    const tree = detectTopLevel(await fixture(), { x: 0, y: 1937, w: 1170, h: 595 }, NOW);
    expect(tree.nodes).toHaveLength(1);
    expect(tree.nodes[0]!.box.h).toBeGreaterThan(500);
  });
});
