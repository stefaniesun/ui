import { describe, expect, it } from "vitest";
import { applyBox, inferDirection, recomputeLayout } from "./element-layout.js";
import type { ElementNode } from "./element-types.js";
import type { Rect } from "./types.js";

function node(over: Partial<ElementNode> & Pick<ElementNode, "id" | "box">): ElementNode {
  return {
    parentId: null, kind: "component", displayName: "节点", style: {},
    uniformity: 1, source: "auto", classification: "tool",
    scrollX: false, scrollY: false, positioning: "flow", ...over,
  };
}
const box = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

describe("inferDirection", () => {
  // 人工框选的容器没有经过切分，方向只能从子块的散布反推
  it("reads a row from horizontally spread children", () => {
    expect(inferDirection([box(0, 0, 40, 100), box(100, 0, 40, 100)])).toBe("row");
  });

  it("reads a column from vertically stacked children", () => {
    expect(inferDirection([box(0, 0, 100, 40), box(0, 100, 100, 40)])).toBe("column");
  });

  it("defaults to row with fewer than two children", () => {
    expect(inferDirection([box(0, 0, 10, 10)])).toBe("row");
    expect(inferDirection([])).toBe("row");
  });
});

describe("recomputeLayout", () => {
  it("measures a manually added container from its children", () => {
    const nodes = [
      node({ id: "n1", box: box(0, 0, 300, 100) }),
      node({ id: "n2", parentId: "n1", box: box(30, 0, 40, 100) }),
      node({ id: "n3", parentId: "n1", box: box(130, 0, 40, 100) }),
      node({ id: "n4", parentId: "n1", box: box(230, 0, 40, 100) }),
    ];
    const parent = recomputeLayout(nodes).find(item => item.id === "n1")!;
    expect(parent.layout).toEqual({
      direction: "row", gap: 60, padding: { top: 0, right: 30, bottom: 0, left: 30 },
    });
  });

  it("marks an evenly pitched container as a repeat", () => {
    const nodes = [
      node({ id: "n1", box: box(0, 0, 660, 100) }),
      node({ id: "n2", parentId: "n1", box: box(0, 0, 100, 100) }),
      node({ id: "n3", parentId: "n1", box: box(220, 0, 100, 100) }),
      node({ id: "n4", parentId: "n1", box: box(440, 0, 100, 100) }),
    ];
    const parent = recomputeLayout(nodes).find(item => item.id === "n1")!;
    expect(parent.repeat).toEqual({
      count: 3, templateId: "n2", pitch: 220,
      slot: { w: 100, h: 100 }, slotBy: "tool",
    });
  });

  // 分类胶囊行：人工把 5 个胶囊圈进一个容器后，滚动就有地方安放了
  it("infers horizontal scroll once the clipped row has a container", () => {
    const nodes = [
      node({ id: "n1", box: box(0, 0, 1170, 90), source: "manual" }),
      node({ id: "n2", parentId: "n1", box: box(36, 0, 216, 90) }),
      node({ id: "n3", parentId: "n1", box: box(276, 0, 216, 90) }),
      node({ id: "n4", parentId: "n1", box: box(516, 0, 252, 90) }),
      node({ id: "n5", parentId: "n1", box: box(792, 0, 180, 90) }),
      node({ id: "n6", parentId: "n1", box: box(996, 0, 138, 90) }),
    ];
    const parent = recomputeLayout(nodes).find(item => item.id === "n1")!;
    expect(parent.scrollX).toBe(true);
    expect(parent.scrollY).toBe(false);
  });

  it("does not claim scroll on an evenly filled row", () => {
    const nodes = [
      node({ id: "n1", box: box(36, 0, 1098, 100) }),
      node({ id: "n2", parentId: "n1", box: box(74, 0, 142, 100) }),
      node({ id: "n3", parentId: "n1", box: box(293, 0, 141, 100) }),
      node({ id: "n4", parentId: "n1", box: box(532, 0, 103, 100) }),
    ];
    expect(recomputeLayout(nodes).find(item => item.id === "n1")!.scrollX).toBe(false);
  });

  // 滚动允许人工覆盖，重算不能把它抹掉
  it("keeps a human scroll override", () => {
    const nodes = [
      node({ id: "n1", box: box(36, 0, 1098, 100), scrollX: true }),
      node({ id: "n2", parentId: "n1", box: box(74, 0, 142, 100) }),
      node({ id: "n3", parentId: "n1", box: box(293, 0, 141, 100) }),
      node({ id: "n4", parentId: "n1", box: box(532, 0, 103, 100) }),
    ];
    const parent = recomputeLayout(nodes, new Set(["n1"])).find(item => item.id === "n1")!;
    expect(parent.scrollX).toBe(true);
    expect(parent.layout).toBeDefined();      // 布局量仍然照常重算
  });

  // 删掉一层之后原来的父节点只剩一个子节点，旧的 gap 已经不成立了
  it("clears stale layout when a container drops below two children", () => {
    const nodes = [
      node({
        id: "n1", box: box(0, 0, 300, 100), scrollX: true,
        layout: { direction: "row", gap: 60, padding: { top: 0, right: 0, bottom: 0, left: 0 } },
        repeat: { count: 3, templateId: "n2", pitch: 100, slotBy: "tool" },
      }),
      node({ id: "n2", parentId: "n1", box: box(30, 0, 40, 100) }),
    ];
    const parent = recomputeLayout(nodes).find(item => item.id === "n1")!;
    expect(parent.layout).toBeUndefined();
    expect(parent.repeat).toBeUndefined();
    expect(parent.scrollX).toBe(false);
  });

  it("leaves leaves untouched", () => {
    const nodes = [node({ id: "n1", box: box(0, 0, 100, 100), kind: "text" })];
    expect(recomputeLayout(nodes)[0]!.layout).toBeUndefined();
  });
});

describe("applyBox", () => {
  const region: Rect = { x: 0, y: 0, w: 400, h: 300 };
  const tree = [
    node({ id: "p", box: box(50, 50, 200, 200) }),
    node({ id: "a", parentId: "p", box: box(60, 60, 50, 50) }),
    node({ id: "b", parentId: "p", box: box(150, 60, 50, 50) }),
  ];
  const boxOf = (result: ReturnType<typeof applyBox>, id: string) =>
    result.ok ? result.nodes.find(item => item.id === id)?.box : undefined;

  it("accepts a small nudge", () => {
    expect(boxOf(applyBox(tree, region, "a", box(63, 62, 50, 50)), "a"))
      .toEqual({ x: 63, y: 62, w: 50, h: 50 });
  });

  it("rounds fractional input", () => {
    expect(boxOf(applyBox(tree, region, "a", box(60.6, 60.4, 50.5, 50)), "a"))
      .toEqual({ x: 61, y: 60, w: 51, h: 50 });
  });

  // 纯移动挪出界基本是手滑，收回来而不是把父框拖大
  it("pulls a moved child back inside its parent", () => {
    expect(boxOf(applyBox(tree, region, "a", box(0, 0, 50, 50)), "a"))
      .toEqual({ x: 50, y: 50, w: 50, h: 50 });
    expect(boxOf(applyBox(tree, region, "a", box(900, 900, 50, 50)), "a"))
      .toEqual({ x: 200, y: 200, w: 50, h: 50 });
  });

  // 放大顶到父边界后继续放大：父节点跟着长
  it("grows the parent when a child outgrows it", () => {
    const lone = [
      node({ id: "p", box: box(50, 50, 200, 200) }),
      node({ id: "a", parentId: "p", box: box(60, 60, 50, 50) }),
    ];
    const next = applyBox(lone, region, "a", box(60, 60, 300, 50));
    expect(boxOf(next, "a")).toEqual({ x: 60, y: 60, w: 300, h: 50 });
    expect(boxOf(next, "p")).toEqual({ x: 50, y: 50, w: 310, h: 200 });
  });

  // 顶开要一路往上传，不是只顶一层
  it("grows every ancestor that no longer fits", () => {
    const deep = [
      node({ id: "p", box: box(50, 50, 200, 200) }),
      node({ id: "m", parentId: "p", box: box(60, 60, 100, 100) }),
      node({ id: "a", parentId: "m", box: box(70, 70, 50, 50) }),
    ];
    const next = applyBox(deep, region, "a", box(70, 70, 250, 50));
    expect(boxOf(next, "a")!.w).toBe(250);
    expect(boxOf(next, "m")).toEqual({ x: 60, y: 60, w: 260, h: 100 });
    expect(boxOf(next, "p")).toEqual({ x: 50, y: 50, w: 270, h: 200 });
  });

  // 区域是硬顶，顶不出去
  it("refuses to grow past the region", () => {
    const lone = [
      node({ id: "p", box: box(50, 50, 200, 200) }),
      node({ id: "a", parentId: "p", box: box(60, 60, 50, 50) }),
    ];
    const next = applyBox(lone, region, "a", box(60, 60, 9999, 50));
    expect(boxOf(next, "a")!.x + boxOf(next, "a")!.w).toBeLessThanOrEqual(region.w);
    expect(boxOf(next, "p")!.x + boxOf(next, "p")!.w).toBeLessThanOrEqual(region.w);
  });

  it("keeps a root inside the region", () => {
    expect(boxOf(applyBox(tree, region, "p", box(-40, -40, 200, 200)), "p"))
      .toEqual({ x: 0, y: 0, w: 200, h: 200 });
  });

  it("refuses to overlap a flow sibling", () => {
    expect(applyBox(tree, region, "a", box(140, 60, 50, 50)).ok).toBe(false);
  });

  // absolute 的节点本来就允许压层（角标压在图标上那种形态）
  it("allows an absolute node to overlap", () => {
    const withBadge = tree.map(item =>
      item.id === "a" ? { ...item, positioning: "absolute" as const } : item);
    expect(boxOf(applyBox(withBadge, region, "a", box(140, 60, 50, 50)), "a"))
      .toEqual({ x: 140, y: 60, w: 50, h: 50 });
  });

  // 与向上取并集对称：向下取交集。只裁掉伸出去的那部分，装得下的原样不动。
  it("trims the children when the parent shrinks below them", () => {
    const next = applyBox(tree, region, "p", box(50, 50, 120, 200));
    expect(boxOf(next, "p")).toEqual({ x: 50, y: 50, w: 120, h: 200 });
    expect(boxOf(next, "a")).toEqual({ x: 60, y: 60, w: 50, h: 50 });   // 装得下，不动
    expect(boxOf(next, "b")).toEqual({ x: 150, y: 60, w: 20, h: 50 });  // 伸出去，裁掉
  });

  // 裁剪要一路往下传，不是只裁一层
  it("trims every descendant that no longer fits", () => {
    const deep = [
      node({ id: "p", box: box(0, 0, 300, 100) }),
      node({ id: "m", parentId: "p", box: box(0, 0, 300, 100) }),
      node({ id: "a", parentId: "m", box: box(200, 0, 100, 100) }),
    ];
    const next = applyBox(deep, region, "p", box(0, 0, 240, 100));
    expect(boxOf(next, "m")!.w).toBe(240);
    expect(boxOf(next, "a")).toEqual({ x: 200, y: 0, w: 40, h: 100 });
  });

  // 裁到看不见就整体拒绝，不留下碎块
  it("refuses when trimming would leave a child below the minimum", () => {
    expect(applyBox(tree, region, "p", box(50, 50, 12, 200)).ok).toBe(false);
  });

  it("enforces a minimum size", () => {
    const shrunk = boxOf(applyBox(tree, region, "a", box(60, 60, 0, 0)), "a")!;
    expect(shrunk.w).toBeGreaterThanOrEqual(4);
    expect(shrunk.h).toBeGreaterThanOrEqual(4);
  });

  it("returns null for an unknown id", () => {
    expect(applyBox(tree, region, "ghost", box(0, 0, 10, 10)).ok).toBe(false);
  });

  it("leaves untouched nodes alone", () => {
    const next = applyBox(tree, region, "a", box(63, 62, 50, 50))!;
    expect(boxOf(next, "b")).toEqual({ x: 150, y: 60, w: 50, h: 50 });
  });
});

describe("grid 与 repeat 的同步", () => {
  const container = (over: Partial<ElementNode> = {}): ElementNode => ({
    id: "g", parentId: null, box: { x: 0, y: 0, w: 300, h: 100 }, kind: "grid",
    displayName: "列表", style: {}, uniformity: 1, source: "auto",
    classification: "tool", scrollX: false, scrollY: false, positioning: "flow",
    repeat: { count: 3, templateId: "a", pitch: 100, slot: { w: 40, h: 40 }, slotBy: "tool" },
    ...over,
  });
  const child = (id: string, x: number): ElementNode => ({
    id, parentId: "g", box: { x, y: 30, w: 40, h: 40 }, kind: "component",
    displayName: id, style: {}, uniformity: 1, source: "auto",
    classification: "tool", scrollX: false, scrollY: false, positioning: "flow",
  });

  it("keeps the grid kind while the repeat still holds", () => {
    const out = recomputeLayout([container(), child("a", 10), child("b", 110), child("c", 210)]);
    expect(out[0]!.kind).toBe("grid");
    expect(out[0]!.repeat).toBeDefined();
  });

  // 人工挪乱了间距，repeat 被删——kind 不能还叫"网格"
  it("demotes the kind when the repeat no longer holds", () => {
    const out = recomputeLayout([container(), child("a", 10), child("b", 60), child("c", 210)]);
    expect(out[0]!.repeat).toBeUndefined();
    expect(out[0]!.kind).toBe("component");
  });

  // 人工定的类型不许被几何推翻
  it("leaves a human-set kind alone", () => {
    const out = recomputeLayout([
      container({ classification: "human" }),
      child("a", 10), child("b", 60), child("c", 210),
    ]);
    expect(out[0]!.repeat).toBeUndefined();
    expect(out[0]!.kind).toBe("grid");
  });

  it("keeps a human slot through a recompute", () => {
    const out = recomputeLayout([
      container({
        repeat: { count: 3, templateId: "a", pitch: 100, slot: { w: 60, h: 60 }, slotBy: "human" },
      }),
      child("a", 10), child("b", 110), child("c", 210),
    ]);
    expect(out[0]!.repeat?.slot).toEqual({ w: 60, h: 60 });
    expect(out[0]!.repeat?.slotBy).toBe("human");
  });

  // 删兄弟节点删到只剩一个，也是一条删掉 repeat 的路径——kind 同样不能留在 grid
  it("demotes the kind when there are too few children left", () => {
    const out = recomputeLayout([container(), child("a", 10)]);
    expect(out[0]!.repeat).toBeUndefined();
    expect(out[0]!.kind).toBe("component");
  });

  it("leaves a human-set kind alone when children run out", () => {
    const out = recomputeLayout([container({ classification: "human" }), child("a", 10)]);
    expect(out[0]!.kind).toBe("grid");
  });
});
