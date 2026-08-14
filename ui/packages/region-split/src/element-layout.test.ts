import { describe, expect, it } from "vitest";
import { clampBox, inferDirection, recomputeLayout } from "./element-layout.js";
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
    expect(parent.repeat).toEqual({ count: 3, templateId: "n2", pitch: 220 });
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
        repeat: { count: 3, templateId: "n2", pitch: 100 },
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

describe("clampBox", () => {
  const region: Rect = { x: 0, y: 0, w: 400, h: 300 };
  const tree = [
    node({ id: "p", box: box(50, 50, 200, 200) }),
    node({ id: "a", parentId: "p", box: box(60, 60, 50, 50) }),
    node({ id: "b", parentId: "p", box: box(150, 60, 50, 50) }),
  ];

  it("accepts a small nudge", () => {
    expect(clampBox(tree, region, "a", box(63, 62, 50, 50)))
      .toEqual({ x: 63, y: 62, w: 50, h: 50 });
  });

  it("rounds fractional input", () => {
    expect(clampBox(tree, region, "a", box(60.6, 60.4, 50.5, 50)))
      .toEqual({ x: 61, y: 60, w: 51, h: 50 });
  });

  // 越出父节点时收回来，而不是整个拒绝——挪出界是最常见的手滑
  it("pulls a child back inside its parent", () => {
    expect(clampBox(tree, region, "a", box(0, 0, 50, 50)))
      .toEqual({ x: 50, y: 50, w: 50, h: 50 });
    expect(clampBox(tree, region, "a", box(900, 900, 50, 50)))
      .toEqual({ x: 200, y: 200, w: 50, h: 50 });
  });

  it("caps a child at its parent size", () => {
    // 有兄弟时撑满父节点必然压到兄弟，所以这条要在独生子上验
    const lone = [
      node({ id: "p", box: box(50, 50, 200, 200) }),
      node({ id: "a", parentId: "p", box: box(60, 60, 50, 50) }),
    ];
    const clamped = clampBox(lone, region, "a", box(60, 60, 9999, 9999))!;
    expect(clamped).toEqual({ x: 50, y: 50, w: 200, h: 200 });
  });

  it("keeps a root inside the region", () => {
    expect(clampBox(tree, region, "p", box(-40, -40, 200, 200)))
      .toEqual({ x: 0, y: 0, w: 200, h: 200 });
  });

  it("refuses to overlap a flow sibling", () => {
    expect(clampBox(tree, region, "a", box(140, 60, 50, 50))).toBeNull();
  });

  // absolute 的节点本来就允许压层（角标压在图标上那种形态）
  it("allows an absolute node to overlap", () => {
    const withBadge = tree.map(item =>
      item.id === "a" ? { ...item, positioning: "absolute" as const } : item);
    expect(clampBox(withBadge, region, "a", box(140, 60, 50, 50)))
      .toEqual({ x: 140, y: 60, w: 50, h: 50 });
  });

  it("refuses to shrink below its own children", () => {
    expect(clampBox(tree, region, "p", box(50, 50, 60, 60))).toBeNull();
  });

  it("enforces a minimum size", () => {
    const clamped = clampBox(tree, region, "a", box(60, 60, 0, 0))!;
    expect(clamped.w).toBeGreaterThanOrEqual(4);
    expect(clamped.h).toBeGreaterThanOrEqual(4);
  });

  it("returns null for an unknown id", () => {
    expect(clampBox(tree, region, "ghost", box(0, 0, 10, 10))).toBeNull();
  });
});
