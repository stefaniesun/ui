import { join } from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  connectedBoxes, detectElementTree, regionBackground, toHex,
  uncoveredContentRatio, uniformity,
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

describe("detectElementTree", () => {
  const region: Rect = { x: 0, y: 0, w: 200, h: 300 };

  it("produces a flat tree of containers", async () => {
    const tree = detectElementTree(await raw(page()), region, NOW);
    expect(tree.regionKey).toBe("0-300");
    expect(tree.detectedAt).toBe(NOW);
    expect(tree.nodes).toHaveLength(2);
    expect(tree.nodes.every(node => node.parentId === null)).toBe(true);
    expect(checkElementTreeInvariants(tree, region)).toEqual([]);
  });

  it("records the flat container background", async () => {
    const tree = detectElementTree(await raw(page()), region, NOW);
    expect(tree.nodes[0]!.kind).toBe("component");
    expect(tree.nodes[0]!.style.background).toBe("#ffffff");
  });

  // 内部主色占比一个数就把 <div> 和 <img> 分开：实测白卡片 0.83–0.96，位图 0.02
  it("marks a raster block as an image leaf", async () => {
    const image = await raw(
      sharp({ create: { width: 300, height: 200, channels: 3, background: "#f5f5f5" } })
        .composite([{ input: await noiseImage(200, 120), top: 40, left: 50 }]).png());
    const tree = detectElementTree(image, { x: 0, y: 0, w: 300, h: 200 }, NOW);
    expect(tree.nodes).toHaveLength(1);
    expect(tree.nodes[0]!.kind).toBe("image");
    expect(tree.nodes[0]!.style.background).toBeUndefined();
  });

  it("returns no nodes for a blank region", async () => {
    const image = await raw(
      sharp({ create: { width: 200, height: 100, channels: 3, background: "#f5f5f5" } }).png());
    expect(detectElementTree(image, { x: 0, y: 0, w: 200, h: 100 }, NOW).nodes).toEqual([]);
  });

  it("gives every node a placeholder name", async () => {
    const tree = detectElementTree(await raw(page()), region, NOW);
    expect(tree.nodes.every(node => node.displayName.length > 0)).toBe(true);
    expect(tree.nodes.every(node => node.source === "auto")).toBe(true);
  });

  // 连通块的外接矩形会互相重叠——实测账户顶部的头像圆被切成两块，
  // 后者只差 1px 没被前者完全包含。同层重叠会直接撞上不变量。
  it("merges two partially overlapping blocks into one", async () => {
    const image = await raw(
      sharp({ create: { width: 300, height: 300, channels: 3, background: "#f5f5f5" } })
        .composite([
          { input: { create: { width: 160, height: 100, channels: 3, background: "#303030" } }, top: 40, left: 40 },
          // 与上一块横向错开、纵向搭住 10px，且底边比它低 1px：既不包含也不被包含
          { input: { create: { width: 120, height: 51, channels: 3, background: "#303030" } }, top: 130, left: 100 },
        ]).png());
    const target = { x: 0, y: 0, w: 300, h: 300 };
    const tree = detectElementTree(image, target, NOW);
    // 合并的结果是**一个顶层节点**；它内部会不会再切出子节点是另一回事
    const roots = tree.nodes.filter(node => node.parentId === null);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.box).toEqual({ x: 40, y: 40, w: 180, h: 141 });
    expect(checkElementTreeInvariants(tree, target)).toEqual([]);
  });

  // 完整包含是真实层级，应该变成父子而不是被合并掉。
  // 描边卡片就是这个形态：边框是一个连通块，框内内容是另一个，
  // 两者被页底色隔开，但边框的外接矩形包住了内容。
  it("nests a fully contained block under its container", async () => {
    const image = await raw(
      sharp({ create: { width: 300, height: 300, channels: 3, background: "#f5f5f5" } })
        .composite([
          { input: { create: { width: 200, height: 200, channels: 3, background: "#303030" } }, top: 40, left: 40 },
          // 掏空中间，只留 10px 的边框
          { input: { create: { width: 180, height: 180, channels: 3, background: "#f5f5f5" } }, top: 50, left: 50 },
          { input: { create: { width: 120, height: 60, channels: 3, background: "#303030" } }, top: 90, left: 80 },
        ]).png());
    const target = { x: 0, y: 0, w: 300, h: 300 };
    const tree = detectElementTree(image, target, NOW);
    expect(tree.nodes).toHaveLength(2);
    const outer = tree.nodes.find(node => node.parentId === null)!;
    const inner = tree.nodes.find(node => node.parentId !== null)!;
    expect(outer.box).toEqual({ x: 40, y: 40, w: 200, h: 200 });
    expect(inner.parentId).toBe(outer.id);
    expect(checkElementTreeInvariants(tree, target)).toEqual([]);
  });

  // image 是叶子类型，挂子节点会撞上 leaf-with-children
  it("drops blocks that fall inside a raster image", async () => {
    const noise = await noiseImage(200, 200);
    const image = await raw(
      sharp({ create: { width: 300, height: 300, channels: 3, background: "#f5f5f5" } })
        .composite([
          { input: noise, top: 40, left: 40 },
          { input: { create: { width: 100, height: 40, channels: 3, background: "#f5f5f5" } }, top: 100, left: 80 },
        ]).png());
    const target = { x: 0, y: 0, w: 300, h: 300 };
    const tree = detectElementTree(image, target, NOW);
    expect(tree.nodes).toHaveLength(1);
    expect(tree.nodes[0]!.kind).toBe("image");
    expect(checkElementTreeInvariants(tree, target)).toEqual([]);
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

  it("frames the common-service card exactly without inferring a radius", async () => {
    const tree = detectElementTree(await fixture(), { x: 0, y: 1131, w: 1170, h: 255 }, NOW);
    const roots = tree.nodes.filter(node => node.parentId === null);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.box).toEqual({ x: 36, y: 1131, w: 1098, h: 255 });
    expect(tree.nodes.every(node => node.style.borderRadius === undefined)).toBe(true);
  });

  it("frames the card-wallet card exactly", async () => {
    const tree = detectElementTree(await fixture(), { x: 0, y: 396, w: 1170, h: 222 }, NOW);
    expect(tree.nodes[0]!.box).toEqual({ x: 36, y: 396, w: 1098, h: 222 });
  });

  it("treats the promotional banner as an image", async () => {
    const image = await fixture();
    expect(uniformity(image, { x: 36, y: 1413, w: 1098, h: 216 }).ratio).toBeLessThan(0.1);
    const tree = detectElementTree(image, { x: 0, y: 1413, w: 1170, h: 216 }, NOW);
    expect(tree.nodes[0]!.kind).toBe("image");
  });

  it("finds three separate coupon cards", async () => {
    const tree = detectElementTree(await fixture(), { x: 0, y: 921, w: 1170, h: 183 }, NOW);
    const roots = tree.nodes.filter(node => node.parentId === null);
    expect(roots).toHaveLength(3);
    expect(roots.map(node => node.box.x)).toEqual([36, 459, 882]);
  });

  // 已知失败面：白底连白底会并块。如实断言，不要假装不存在——
  // 拆开它是阶段二递归切分的事，阶段一由人工框选处理。
  it("merges the product grid with the tab bar, as expected at this stage", async () => {
    const tree = detectElementTree(await fixture(), { x: 0, y: 1937, w: 1170, h: 595 }, NOW);
    expect(tree.nodes).toHaveLength(1);
    expect(tree.nodes[0]!.box.h).toBeGreaterThan(500);
  });
});

describe("region fallback when no container is visible", () => {
  const FIXTURE = join(import.meta.dirname, "..", "test-fixtures", "maicai.png");
  const fixture = async (): Promise<RawImage> => {
    const { data, info } = await sharp(FIXTURE).removeAlpha().raw()
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, channels: info.channels };
  };

  it("reports how much content the boxes miss", async () => {
    const image = await raw(page());
    const region = { x: 0, y: 0, w: 200, h: 300 };
    const bg: [number, number, number] = [245, 245, 245];
    // 两张卡片盖住了全部内容
    expect(uncoveredContentRatio(image, region, bg, connectedBoxes(image, region, bg)))
      .toBeCloseTo(0, 2);
    // 一个框都没有时，内容全部未覆盖
    expect(uncoveredContentRatio(image, region, bg, [])).toBeCloseTo(1, 2);
  });

  // 账户顶部没有卡片，元素直接摆在页面底色上，各自的连通块都小于顶层最小尺寸。
  // 不回退的话整个区域一个节点都出不来。
  it("cuts the account header region that has no card", async () => {
    const region = { x: 0, y: 0, w: 1170, h: 338 };
    const tree = detectElementTree(await fixture(), region, NOW);
    expect(tree.nodes.length).toBeGreaterThan(5);
    expect(tree.nodes.filter(node => node.parentId === null).length).toBeGreaterThan(1);
    expect(tree.nodes.every(node => node.style.borderRadius === undefined)).toBe(true);
    expect(checkElementTreeInvariants(tree, region)).toEqual([]);
  });

  it("cuts the tab bar region that has no card", async () => {
    const region = { x: 0, y: 2283, w: 1170, h: 249 };
    const tree = detectElementTree(await fixture(), region, NOW);
    expect(tree.nodes.length).toBeGreaterThan(3);
    expect(checkElementTreeInvariants(tree, region)).toEqual([]);
  });

  // 反向：横幅那一个框盖住了全部内容，不该触发回退
  it("does not fall back when one box covers the region", async () => {
    const tree = detectElementTree(await fixture(), { x: 0, y: 1413, w: 1170, h: 216 }, NOW);
    expect(tree.nodes).toHaveLength(1);
    expect(tree.nodes[0]!.kind).toBe("image");
  });
});

describe("region background", () => {
  it("records the region's own background colour", async () => {
    const tree = detectElementTree(await raw(page()), { x: 0, y: 0, w: 200, h: 300 }, NOW);
    expect(tree.background).toBe("#f5f5f5");
  });

  // 区域没有可见容器时走回退分支，背景色同样要记下来
  it("records it on the fallback path too", async () => {
    const image = await raw(
      sharp({ create: { width: 300, height: 120, channels: 3, background: "#e8f0ff" } })
        .composite([
          { input: { create: { width: 30, height: 30, channels: 3, background: "#202020" } }, top: 40, left: 20 },
          { input: { create: { width: 30, height: 30, channels: 3, background: "#202020" } }, top: 40, left: 200 },
        ]).png());
    const tree = detectElementTree(image, { x: 0, y: 0, w: 300, h: 120 }, NOW);
    expect(tree.background).toBe("#e8f0ff");
  });
});
