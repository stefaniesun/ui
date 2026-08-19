import { describe, expect, it, vi } from "vitest";
import { createElementStore, supportsBorderRadius } from "./element-state.js";
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
    getElements: vi.fn(async () => ({ tree: null, treeVersion: null })),
    getParsedRegions: vi.fn(async () => ({ regionKeys: [] })),
    getPageCode: vi.fn(async () => ({ html: "", css: "", assets: [] })),
    detectElements: vi.fn(async () => ({ tree: tree([node({ id: "n1" })]), treeVersion: "detected-v1" })),
    putElements: vi.fn(async (_id: string, _region: Rect, next: ElementTree) => ({ tree: next, treeVersion: "saved-v1" })),
    ...over,
  } as unknown as StoreApi;
}
const loaded = (nodes: ElementNode[], over: Partial<StoreApi> = {}) =>
  fakeApi({ getElements: vi.fn(async () => ({ tree: tree(nodes), treeVersion: "loaded-v1" })), ...over });
const listTree = () => loaded([node({
  id: "n1", kind: "grid",
  repeat: { count: 3, templateId: "n2", pitch: 100, slot: { w: 40, h: 40 }, slotBy: "tool" },
})]);
const whole = { x: 0, y: 0, w: 100, h: 100 };

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

  // 改 kind 让 textBox 的判定语境本身作废（一个 icon 从没被判过是不是单行文字）
  it("drops textBox when the kind changes", async () => {
    const store = createElementStore(loaded([
      { ...node({ id: "n1", kind: "text" }), textBox: { ok: false, bands: 0, glyphAspect: 0, reason: "no-ink" } },
    ]));
    await store.load("p1", REGION);
    await store.setKind("p1", REGION, "n1", "icon");
    expect(store.tree.value!.nodes[0]!.textBox).toBeUndefined();
  });

  it("drops the repeat when the kind moves away from grid", async () => {
    const store = createElementStore(listTree());
    await store.load("p1", whole);
    await store.setKind("p1", whole, "n1", "component");
    expect(store.nodes.value[0]!.repeat).toBeUndefined();
  });

  it("keeps the repeat when the kind stays grid", async () => {
    const store = createElementStore(listTree());
    await store.load("p1", whole);
    await store.setKind("p1", whole, "n1", "grid");
    expect(store.nodes.value[0]!.repeat).toBeDefined();
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

  // 放大顶到父边界后继续放大，父节点跟着长
  it("grows the parent when a child outgrows it", async () => {
    const store = createElementStore(loaded([
      boxed("p", null, 0, 0, 200, 200), boxed("a", "p", 10, 10, 50, 50),
    ]));
    await store.load("p1", REGION);
    await store.setBox("p1", REGION, "a", { x: 10, y: 10, w: 300, h: 50 });
    expect(store.tree.value!.nodes.find(n => n.id === "a")!.box.w).toBe(300);
    expect(store.tree.value!.nodes.find(n => n.id === "p")!.box.w).toBe(310);
  });

  // 与放大对称：缩小父框时把伸出去的子节点一起裁进来
  it("trims the children when the parent shrinks", async () => {
    const store = createElementStore(loaded([
      boxed("p", null, 0, 0, 200, 200), boxed("a", "p", 100, 10, 90, 50),
    ]));
    await store.load("p1", REGION);
    await store.setBox("p1", REGION, "p", { x: 0, y: 0, w: 140, h: 200 });
    expect(store.tree.value!.nodes.find(n => n.id === "a")!.box.w).toBe(40);
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

  // textBox 是"这个框校验过"的凭证；框真的改了，凭证就该作废——
  // 不然界面会对着一个刚被人工修正的框继续显示"框存疑"、继续禁用测量按钮。
  it("drops textBox on a node whose box actually changed", async () => {
    const store = createElementStore(loaded([
      boxed("p", null, 0, 0, 200, 200),
      { ...boxed("a", "p", 10, 10, 50, 20), textBox: { ok: false, bands: 2, glyphAspect: 1, reason: "multi-band" } },
    ]));
    await store.load("p1", REGION);
    await store.setBox("p1", REGION, "a", { x: 13, y: 10, w: 50, h: 20 });
    expect(store.tree.value!.nodes.find(n => n.id === "a")!.textBox).toBeUndefined();
  });

  // 反方向同样要顾到：一个节点的框没变，就不该动它的 textBox
  it("keeps textBox on nodes whose box did not change", async () => {
    const store = createElementStore(loaded([
      { ...boxed("p", null, 0, 0, 200, 200), textBox: { ok: true, bands: 1, glyphAspect: 0.5 } },
      boxed("a", "p", 10, 10, 50, 50),
    ]));
    await store.load("p1", REGION);
    // 放大 a 顶开父框 p——p 的框跟着变，但 p 的 textBox 校验对象是 p 自己的内容，
    // 这里只关心"没变的节点保持原值"，用一个不牵连 p 的改动来测
    await store.setBox("p1", REGION, "a", { x: 13, y: 12, w: 50, h: 50 });
    expect(store.tree.value!.nodes.find(n => n.id === "p")!.textBox).toEqual({ ok: true, bands: 1, glyphAspect: 0.5 });
  });

  // applyBox 会连带改动祖先的框，祖先的 textBox 也得跟着作废，不能只清被点的那个
  it("drops textBox on an ancestor whose box grows to fit an outgrowing child", async () => {
    const store = createElementStore(loaded([
      { ...boxed("p", null, 0, 0, 200, 200), textBox: { ok: true, bands: 1, glyphAspect: 0.5 } },
      boxed("a", "p", 10, 10, 50, 50),
    ]));
    await store.load("p1", REGION);
    await store.setBox("p1", REGION, "a", { x: 10, y: 10, w: 300, h: 50 });
    expect(store.tree.value!.nodes.find(n => n.id === "p")!.textBox).toBeUndefined();
  });
});

describe("supportsBorderRadius", () => {
  it("allows only images and components", () => {
    expect(supportsBorderRadius("image")).toBe(true);
    expect(supportsBorderRadius("component")).toBe(true);
    for (const kind of ["grid", "text", "icon", "decoration"] as const) {
      expect(supportsBorderRadius(kind)).toBe(false);
    }
  });

  it("clears a manual radius when changing to an unsupported kind", async () => {
    const api = loaded([node({ id: "n1", kind: "component" })]);
    const store = createElementStore(api);
    await store.load("p1", REGION);
    await store.setRadius("p1", REGION, "n1", 12);
    await store.setKind("p1", REGION, "n1", "text");
    expect(store.tree.value!.nodes[0]!.style.borderRadius).toBeUndefined();
    expect(api.putElements).toHaveBeenLastCalledWith("p1", REGION, expect.objectContaining({
      nodes: [expect.objectContaining({ kind: "text", style: {} })],
    }));
  });

  it("clears every legacy radius while loading without saving automatically", async () => {
    const api = loaded([
      node({ id: "n1", kind: "component", style: { background: "#ffffff", borderRadius: 12 } }),
      node({ id: "n2", kind: "image", style: { borderRadius: 8 } }),
      node({ id: "n3", kind: "text", style: { color: "#111111", borderRadius: 6 } }),
    ]);
    const store = createElementStore(api);

    await store.load("p1", REGION);

    expect(store.tree.value!.nodes.map(item => item.style)).toEqual([
      { background: "#ffffff" },
      {},
      { color: "#111111" },
    ]);
    const sourceTree = await api.getElements("p1", REGION.y, REGION.h);
    expect(sourceTree.tree!.nodes.map(item => item.style.borderRadius)).toEqual([12, 8, 6]);
    expect(api.putElements).not.toHaveBeenCalled();
  });

  it("persists cleared legacy radii on the next normal save", async () => {
    const api = loaded([
      node({ id: "n1", kind: "component", style: { borderRadius: 12 } }),
    ]);
    const store = createElementStore(api);
    await store.load("p1", REGION);

    await store.rename("p1", REGION, "n1", "卡片");

    expect(api.putElements).toHaveBeenCalledWith("p1", REGION, expect.objectContaining({
      nodes: [expect.objectContaining({ displayName: "卡片", style: {} })],
    }));
  });
});

describe("setRadius", () => {
  const card = (id: string, w: number, h: number, radius?: number) =>
    node({ id, box: { x: 0, y: 0, w, h }, style: radius ? { borderRadius: radius } : {} });

  it("stores a new radius", async () => {
    const store = createElementStore(loaded([card("n1", 200, 120, 34)]));
    await store.load("p1", REGION);
    await store.setRadius("p1", REGION, "n1", 20);
    expect(store.tree.value!.nodes[0]!.style.borderRadius).toBe(20);
  });

  it("stores the eight pixel default even on a small element", async () => {
    const store = createElementStore(loaded([card("n1", 10, 10)]));
    await store.load("p1", REGION);
    await store.setRadius("p1", REGION, "n1", 8);
    expect(store.tree.value!.nodes[0]!.style.borderRadius).toBe(8);
  });

  // 0 表示直角，这时删字段而不是存 0，保持文档干净
  it("drops the field when set to zero", async () => {
    const store = createElementStore(loaded([card("n1", 200, 120, 34)]));
    await store.load("p1", REGION);
    await store.setRadius("p1", REGION, "n1", 0);
    expect("borderRadius" in store.tree.value!.nodes[0]!.style).toBe(false);
  });

  it("does nothing when the manual value is unchanged", async () => {
    const api = loaded([card("n1", 200, 120)]);
    const store = createElementStore(api);
    await store.load("p1", REGION);
    await store.setRadius("p1", REGION, "n1", 34);
    vi.mocked(api.putElements).mockClear();

    await store.setRadius("p1", REGION, "n1", 34);

    expect(api.putElements).not.toHaveBeenCalled();
  });
});

describe("setSlot", () => {
  it("sets the slot and marks it human", async () => {
    const store = createElementStore(listTree());
    await store.load("p1", whole);
    await store.setSlot("p1", whole, "n1", 60, 60);
    expect(store.nodes.value[0]!.repeat?.slot).toEqual({ w: 60, h: 60 });
    expect(store.nodes.value[0]!.repeat?.slotBy).toBe("human");
  });

  // 没有 repeat 的节点谈不上槽位，静默不动而不是造一个出来
  it("ignores a slot edit on a node with no repeat", async () => {
    const store = createElementStore(loaded([node({ id: "n1" })]));
    await store.load("p1", whole);
    await store.setSlot("p1", whole, "n1", 60, 60);
    expect(store.nodes.value[0]!.repeat).toBeUndefined();
  });

  // 0 会让生成的 `> *` 出 height: 0，整行列表项塌成 0 高
  it("never lets a slot fall below one pixel", async () => {
    const store = createElementStore(listTree());
    await store.load("p1", whole);
    await store.setSlot("p1", whole, "n1", 0, 0);
    expect(store.nodes.value[0]!.repeat?.slot).toEqual({ w: 1, h: 1 });
  });
});

describe("setBox rejection feedback", () => {
  const boxed2 = (id: string, parentId: string | null, x: number, w: number) =>
    node({ id, parentId, box: { x, y: 0, w, h: 50 } });

  // 静默无动作看起来像失灵，必须说清楚为什么
  it("explains why a change was refused", async () => {
    const store = createElementStore(loaded([
      boxed2("p", null, 0, 400), boxed2("a", "p", 0, 100), boxed2("b", "p", 200, 100),
    ]));
    await store.load("p1", REGION);
    await store.setBox("p1", REGION, "a", { x: 0, y: 0, w: 250, h: 50 });
    expect(store.error.value).toContain("同级元素");
  });

  it("clears the error once a change succeeds", async () => {
    const store = createElementStore(loaded([
      boxed2("p", null, 0, 400), boxed2("a", "p", 0, 100), boxed2("b", "p", 200, 100),
    ]));
    await store.load("p1", REGION);
    await store.setBox("p1", REGION, "a", { x: 0, y: 0, w: 250, h: 50 });
    expect(store.error.value).not.toBe("");
    await store.setBox("p1", REGION, "a", { x: 0, y: 0, w: 120, h: 50 });
    expect(store.error.value).toBe("");
  });
});

describe("setColor", () => {
  const leaf = (color?: string) =>
    node({ id: "n1", kind: "text", style: color ? { color } : {} });

  it("stores a new colour", async () => {
    const store = createElementStore(loaded([leaf("#191919")]));
    await store.load("p1", REGION);
    await store.setColor("p1", REGION, "n1", "#0fb12c");
    expect(store.tree.value!.nodes[0]!.style.color).toBe("#0fb12c");
  });

  it("normalises case", async () => {
    const store = createElementStore(loaded([leaf()]));
    await store.load("p1", REGION);
    await store.setColor("p1", REGION, "n1", "#0FB12C");
    expect(store.tree.value!.nodes[0]!.style.color).toBe("#0fb12c");
  });

  it("rejects a malformed colour", async () => {
    const api = loaded([leaf("#191919")]);
    const store = createElementStore(api);
    await store.load("p1", REGION);
    await store.setColor("p1", REGION, "n1", "red");
    expect(store.tree.value!.nodes[0]!.style.color).toBe("#191919");
    expect(api.putElements).not.toHaveBeenCalled();
  });
});

describe("setRegionBackground", () => {
  it("stores a new region background", async () => {
    const store = createElementStore(loaded([node({ id: "n1" })]));
    await store.load("p1", REGION);
    await store.setRegionBackground("p1", REGION, "#f5f5f5");
    expect(store.tree.value!.background).toBe("#f5f5f5");
  });

  it("normalises case", async () => {
    const store = createElementStore(loaded([node({ id: "n1" })]));
    await store.load("p1", REGION);
    await store.setRegionBackground("p1", REGION, "#F5F5F5");
    expect(store.tree.value!.background).toBe("#f5f5f5");
  });

  it("cleans unsupported legacy radius while saving the background", async () => {
    const store = createElementStore(loaded([
      node({ id: "n1", kind: "text", style: { borderRadius: 12 } }),
    ]));
    await store.load("p1", REGION);
    await store.setRegionBackground("p1", REGION, "#f5f5f5");
    expect(store.tree.value!.nodes[0]!.style.borderRadius).toBeUndefined();
  });

  it("rejects a malformed colour", async () => {
    const api = loaded([node({ id: "n1" })]);
    const store = createElementStore(api);
    await store.load("p1", REGION);
    await store.setRegionBackground("p1", REGION, "灰色");
    expect(api.putElements).not.toHaveBeenCalled();
  });

  it("does nothing without a tree", async () => {
    const api = fakeApi();
    const store = createElementStore(api);
    await store.setRegionBackground("p1", REGION, "#ffffff");
    expect(api.putElements).not.toHaveBeenCalled();
  });
});

describe("setFont", () => {
  const leaf = () => node({ id: "n1", kind: "text" });

  it("stores multiple automatic font measurements in one save", async () => {
    const api = loaded([leaf(), node({ id: "n2", kind: "text" })]);
    const store = createElementStore(api);
    await store.load("p1", REGION);
    await store.setFonts("p1", REGION, {
      n1: { fontSize: 28, fontWeight: 500 },
      n2: { fontSize: 16, fontWeight: 400 },
    });
    expect(store.tree.value!.nodes.map(item => item.style.fontSize)).toEqual([28, 16]);
    expect(api.putElements).toHaveBeenCalledTimes(1);
  });

  it("stores size and weight together", async () => {
    const store = createElementStore(loaded([leaf()]));
    await store.load("p1", REGION);
    await store.setFont("p1", REGION, "n1", { fontSize: 29.8, fontWeight: 500 });
    expect(store.tree.value!.nodes[0]!.style.fontSize).toBe(29.8);
    expect(store.tree.value!.nodes[0]!.style.fontWeight).toBe(500);
  });

  it("rounds the size to one decimal", async () => {
    const store = createElementStore(loaded([leaf()]));
    await store.load("p1", REGION);
    await store.setFont("p1", REGION, "n1", { fontSize: 29.7777 });
    expect(store.tree.value!.nodes[0]!.style.fontSize).toBe(29.8);
  });

  it("rejects a non positive size", async () => {
    const api = loaded([leaf()]);
    const store = createElementStore(api);
    await store.load("p1", REGION);
    await store.setFont("p1", REGION, "n1", { fontSize: 0 });
    expect(api.putElements).not.toHaveBeenCalled();
  });

  it("changes only what was given", async () => {
    const store = createElementStore(loaded([
      node({ id: "n1", kind: "text", style: { fontSize: 30, fontWeight: 400 } }),
    ]));
    await store.load("p1", REGION);
    await store.setFont("p1", REGION, "n1", { fontWeight: 700 });
    expect(store.tree.value!.nodes[0]!.style.fontSize).toBe(30);
    expect(store.tree.value!.nodes[0]!.style.fontWeight).toBe(700);
  });
});
