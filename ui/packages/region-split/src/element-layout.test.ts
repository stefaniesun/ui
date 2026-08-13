import { describe, expect, it } from "vitest";
import { inferDirection, recomputeLayout } from "./element-layout.js";
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
