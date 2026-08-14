import { describe, expect, it, vi } from "vitest";
import { createElementStore } from "./element-state.js";
import type { StoreApi } from "./api.js";
import type { ElementNode, ElementTree, Rect } from "@region-split/core/browser";

const REGION: Rect = { x: 0, y: 0, w: 400, h: 300 };

function node(over: Partial<ElementNode> & Pick<ElementNode, "id">): ElementNode {
  return {
    parentId: null, box: { x: 0, y: 0, w: 100, h: 100 }, kind: "component",
    displayName: "节点", style: {}, uniformity: 1, source: "auto",
    classification: "tool", scrollX: false, scrollY: false, positioning: "flow", ...over,
  };
}
const tree = (nodes: ElementNode[]): ElementTree =>
  ({ regionKey: "0-300", detectedAt: "2026-08-13T00:00:00.000Z", nodes });

function fakeApi(over: Partial<StoreApi> = {}): StoreApi {
  return {
    upload: vi.fn(), getProject: vi.fn(), putRegions: vi.fn(), analyze: vi.fn(),
    renameAi: vi.fn(), getModelConfig: vi.fn(),
    getElements: vi.fn(async () => ({ tree: null })),
    detectElements: vi.fn(async () => ({ tree: tree([node({ id: "n1" })]) })),
    putElements: vi.fn(async (_id: string, _region: Rect, next: ElementTree) => ({ tree: next })),
    ...over,
  } as unknown as StoreApi;
}
const loaded = (nodes: ElementNode[], over: Partial<StoreApi> = {}) =>
  fakeApi({ getElements: vi.fn(async () => ({ tree: tree(nodes) })), ...over });

describe("createElementStore", () => {
  it("starts empty", () => {
    const store = createElementStore(fakeApi());
    expect(store.tree.value).toBeNull();
    expect(store.busy.value).toBe(false);
    expect(store.selectedNode.value).toBeNull();
  });

  it("loads an existing tree", async () => {
    const store = createElementStore(loaded([node({ id: "n1" })]));
    await store.load("p1", REGION);
    expect(store.tree.value!.nodes).toHaveLength(1);
  });

  it("clears the tree when the region has none", async () => {
    const store = createElementStore(fakeApi());
    await store.load("p1", REGION);
    expect(store.tree.value).toBeNull();
  });

  it("detects a tree", async () => {
    const store = createElementStore(fakeApi());
    await store.detect("p1", REGION);
    expect(store.tree.value!.nodes).toHaveLength(1);
  });

  it("reports a detection failure", async () => {
    const store = createElementStore(fakeApi({
      detectElements: vi.fn(async () => { throw new Error("boom"); }),
    }));
    await store.detect("p1", REGION);
    expect(store.error.value).toBe("boom");
    expect(store.busy.value).toBe(false);
  });

  it("exposes the selected node", async () => {
    const store = createElementStore(loaded([node({ id: "n1", displayName: "卡片" })]));
    await store.load("p1", REGION);
    store.select("n1");
    expect(store.selectedNode.value!.displayName).toBe("卡片");
  });

  it("renames a node", async () => {
    const store = createElementStore(loaded([node({ id: "n1" })]));
    await store.load("p1", REGION);
    await store.rename("p1", REGION, "n1", "购物车");
    expect(store.tree.value!.nodes[0]!.displayName).toBe("购物车");
  });

  it("ignores a blank rename", async () => {
    const store = createElementStore(loaded([node({ id: "n1", displayName: "原名" })]));
    await store.load("p1", REGION);
    await store.rename("p1", REGION, "n1", "   ");
    expect(store.tree.value!.nodes[0]!.displayName).toBe("原名");
  });

  it("changes a kind and marks it human", async () => {
    const store = createElementStore(loaded([node({ id: "n1" })]));
    await store.load("p1", REGION);
    await store.setKind("p1", REGION, "n1", "text");
    expect(store.tree.value!.nodes[0]!.kind).toBe("text");
    expect(store.tree.value!.nodes[0]!.classification).toBe("human");
  });

  // 删除一层是最常见的修正动作：子节点上提到父节点，不能级联删掉
  it("lifts children to the grandparent when a node is removed", async () => {
    const store = createElementStore(loaded([
      node({ id: "n1" }),
      node({ id: "n2", parentId: "n1" }),
      node({ id: "n3", parentId: "n2" }),
    ]));
    await store.load("p1", REGION);
    await store.removeNode("p1", REGION, "n2");
    expect(store.tree.value!.nodes.map(item => item.id)).toEqual(["n1", "n3"]);
    expect(store.tree.value!.nodes.find(item => item.id === "n3")!.parentId).toBe("n1");
  });

  it("clears the selection when the selected node is removed", async () => {
    const store = createElementStore(loaded([node({ id: "n1" })]));
    await store.load("p1", REGION);
    store.select("n1");
    await store.removeNode("p1", REGION, "n1");
    expect(store.selectedNode.value).toBeNull();
  });

  // 新增容器要接管被它完整包含的兄弟——这正是"补一层不可见容器"
  it("adopts fully contained siblings when a container is added", async () => {
    const store = createElementStore(loaded([
      node({ id: "n1", box: { x: 0, y: 0, w: 400, h: 300 } }),
      node({ id: "n2", parentId: "n1", kind: "text", box: { x: 10, y: 10, w: 50, h: 20 } }),
      node({ id: "n3", parentId: "n1", kind: "text", box: { x: 10, y: 40, w: 50, h: 20 } }),
      node({ id: "n4", parentId: "n1", kind: "icon", box: { x: 300, y: 10, w: 50, h: 50 } }),
    ]));
    await store.load("p1", REGION);
    await store.addContainer("p1", REGION, { x: 5, y: 5, w: 70, h: 70 });
    const added = store.tree.value!.nodes.find(item => item.source === "manual")!;
    expect(added.parentId).toBe("n1");
    expect(store.tree.value!.nodes.filter(item => item.parentId === added.id)
      .map(item => item.id).sort()).toEqual(["n2", "n3"]);
  });

  it("adds a root level container when the box covers no existing node", async () => {
    const store = createElementStore(loaded([
      node({ id: "n1", box: { x: 200, y: 200, w: 50, h: 50 } }),
    ]));
    await store.load("p1", REGION);
    await store.addContainer("p1", REGION, { x: 0, y: 0, w: 40, h: 40 });
    const added = store.tree.value!.nodes.find(item => item.source === "manual")!;
    expect(added.parentId).toBeNull();
  });

  it("toggles a scroll flag", async () => {
    const store = createElementStore(loaded([node({ id: "n1" })]));
    await store.load("p1", REGION);
    await store.setScroll("p1", REGION, "n1", "x", true);
    expect(store.tree.value!.nodes[0]!.scrollX).toBe(true);
    expect(store.tree.value!.nodes[0]!.scrollY).toBe(false);
  });

  it("keeps the local edit and reports the error when saving fails", async () => {
    const store = createElementStore(loaded([node({ id: "n1" })], {
      putElements: vi.fn(async () => { throw new Error("422 nope"); }),
    }));
    await store.load("p1", REGION);
    await store.rename("p1", REGION, "n1", "改过");
    expect(store.tree.value!.nodes[0]!.displayName).toBe("改过");
    expect(store.error.value).toContain("422");
  });
});

describe("layout is recomputed after structural edits", () => {
  const boxed = (id: string, parentId: string | null, x: number, w: number) =>
    node({ id, parentId, box: { x, y: 0, w, h: 90 } });

  // 分类胶囊行：5 个胶囊本来是顶层兄弟，人工圈进一个容器后滚动才有地方安放
  it("gives a manually added container its layout and scroll", async () => {
    const store = createElementStore(loaded([
      boxed("n1", null, 36, 216), boxed("n2", null, 276, 216), boxed("n3", null, 516, 252),
      boxed("n4", null, 792, 180), boxed("n5", null, 996, 138),
    ]));
    await store.load("p1", REGION);
    await store.addContainer("p1", REGION, { x: 0, y: 0, w: 1170, h: 90 });
    const added = store.tree.value!.nodes.find(item => item.source === "manual")!;
    expect(added.layout?.direction).toBe("row");
    expect(added.scrollX).toBe(true);
  });

  it("clears stale layout when a container drops below two children", async () => {
    const store = createElementStore(loaded([
      node({
        id: "n1", box: { x: 0, y: 0, w: 300, h: 90 },
        layout: { direction: "row", gap: 60, padding: { top: 0, right: 0, bottom: 0, left: 0 } },
      }),
      boxed("n2", "n1", 30, 40),
      boxed("n3", "n1", 130, 40),
    ]));
    await store.load("p1", REGION);
    await store.removeNode("p1", REGION, "n3");
    expect(store.tree.value!.nodes.find(item => item.id === "n1")!.layout).toBeUndefined();
  });

  // 人工切过滚动之后，后续的结构编辑不能把它抹掉
  it("keeps a human scroll override across later edits", async () => {
    const store = createElementStore(loaded([
      node({ id: "n1", box: { x: 0, y: 0, w: 660, h: 90 } }),
      boxed("n2", "n1", 0, 200), boxed("n3", "n1", 220, 200), boxed("n4", "n1", 440, 200),
    ]));
    await store.load("p1", REGION);
    await store.setScroll("p1", REGION, "n1", "x", true);
    await store.removeNode("p1", REGION, "n4");
    expect(store.tree.value!.nodes.find(item => item.id === "n1")!.scrollX).toBe(true);
  });
});

describe("setBox", () => {
  const boxed = (id: string, parentId: string | null, x: number, y: number, w: number, h: number) =>
    node({ id, parentId, box: { x, y, w, h } });

  it("applies a nudge and persists it", async () => {
    const store = createElementStore(loaded([
      boxed("p", null, 0, 0, 200, 200), boxed("a", "p", 10, 10, 50, 50),
    ]));
    await store.load("p1", REGION);
    await store.setBox("p1", REGION, "a", { x: 13, y: 12, w: 50, h: 50 });
    expect(store.tree.value!.nodes.find(n => n.id === "a")!.box)
      .toEqual({ x: 13, y: 12, w: 50, h: 50 });
  });

  // 改不动就什么都不做，而不是发一个注定 422 的请求
  it("does nothing when the change is impossible", async () => {
    const api = loaded([
      boxed("p", null, 0, 0, 200, 200),
      boxed("a", "p", 10, 10, 50, 50), boxed("b", "p", 100, 10, 50, 50),
    ]);
    const store = createElementStore(api);
    await store.load("p1", REGION);
    await store.setBox("p1", REGION, "a", { x: 95, y: 10, w: 50, h: 50 });
    expect(store.tree.value!.nodes.find(n => n.id === "a")!.box)
      .toEqual({ x: 10, y: 10, w: 50, h: 50 });
    expect(api.putElements).not.toHaveBeenCalled();
  });

  it("recomputes the parent layout after a nudge", async () => {
    const store = createElementStore(loaded([
      boxed("p", null, 0, 0, 300, 100),
      boxed("a", "p", 0, 0, 50, 100), boxed("b", "p", 100, 0, 50, 100),
    ]));
    await store.load("p1", REGION);
    await store.setBox("p1", REGION, "b", { x: 150, y: 0, w: 50, h: 100 });
    expect(store.tree.value!.nodes.find(n => n.id === "p")!.layout!.gap).toBe(100);
  });
});
