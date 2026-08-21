import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { createProject } from "./analyze.js";
import { decideIcons, detectElements, groupForClassification, markTextBoxes } from "./analyze-elements.js";
import { ProjectStore } from "./store.js";
import type { SegmentModel } from "./model.js";
import type { RawImage } from "./panels.js";
import type { ElementNode } from "./element-types.js";

/** 全白的假图：这条测试只关心"哪些节点被检查了"，不关心检查结果 */
function blankImage(width: number, height: number): RawImage {
  return { data: Buffer.from(new Uint8Array(width * height * 3).fill(255)), width, height, channels: 3 };
}

async function seeded() {
  const store = new ProjectStore(mkdtempSync(join(tmpdir(), "rs-el-")));
  const buffer = await sharp({
    create: { width: 400, height: 300, channels: 3, background: "#f5f5f5" },
  }).composite([
    { input: { create: { width: 340, height: 140, channels: 3, background: "#ffffff" } }, top: 30, left: 30 },
  ]).png().toBuffer();
  const { projectId } = await createProject({ store }, { fileName: "s.png", buffer });
  return { store, projectId };
}

const REGION = { x: 0, y: 0, w: 400, h: 300 };

describe("detectElements", () => {
  it("produces and persists a tree", async () => {
    const { store, projectId } = await seeded();
    const tree = await detectElements({ store }, projectId, REGION);
    expect(tree.nodes).toHaveLength(1);
    expect(store.readElementTree(projectId, "0-300")!.nodes).toHaveLength(1);
  });

  it("re-detecting replaces the previous tree", async () => {
    const { store, projectId } = await seeded();
    await detectElements({ store }, projectId, REGION);
    await detectElements({ store }, projectId, REGION);
    expect(store.readElements(projectId).trees).toHaveLength(1);
  });

  it("refuses a region that is too small", async () => {
    const { store, projectId } = await seeded();
    await expect(detectElements({ store }, projectId, { x: 0, y: 0, w: 20, h: 20 }))
      .rejects.toThrow(/too small/);
  });
});

describe("groupForClassification", () => {
  const node = (id: string, parentId: string | null, x: number, y: number,
                layout?: "row" | "column") => ({
    id, parentId, box: { x, y, w: 40, h: 40 }, kind: "component" as const,
    displayName: id, style: {}, uniformity: 1, source: "auto" as const,
    classification: "tool" as const, scrollX: false, scrollY: false,
    positioning: "flow" as const,
    ...(layout ? { layout: { direction: layout, gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 } } } : {}),
  });
  const REGION = { x: 0, y: 0, w: 400, h: 300 };

  // 顺序是这套做法的关键：模型不定位，只按阅读顺序作答
  it("sorts a row group from left to right", () => {
    const nodes = [
      node("n1", null, 0, 0, "row"),
      node("n3", "n1", 200, 0), node("n2", "n1", 100, 0),
    ];
    const group = groupForClassification(nodes, REGION)
      .find(g => g.children.length === 2)!;
    expect(group.direction).toBe("row");
    expect(group.children.map(c => c.id)).toEqual(["n2", "n3"]);
  });

  it("sorts a column group from top to bottom", () => {
    const nodes = [
      node("n1", null, 0, 0, "column"),
      node("n3", "n1", 0, 200), node("n2", "n1", 0, 100),
    ];
    const group = groupForClassification(nodes, REGION)
      .find(g => g.children.length === 2)!;
    expect(group.direction).toBe("column");
    expect(group.children.map(c => c.id)).toEqual(["n2", "n3"]);
  });

  it("uses the region as the crop for top level nodes", () => {
    const nodes = [node("n1", null, 0, 0), node("n2", null, 0, 100)];
    const group = groupForClassification(nodes, REGION)[0]!;
    expect(group.crop).toEqual(REGION);
  });

  it("uses the parent box as the crop for its children", () => {
    const nodes = [node("n1", null, 10, 20, "row"), node("n2", "n1", 10, 20)];
    const group = groupForClassification(nodes, REGION)
      .find(g => g.children[0]!.id === "n2")!;
    expect(group.crop).toEqual({ x: 10, y: 20, w: 40, h: 40 });
  });
});

describe("detectElements with a model", () => {
  const REGION2 = { x: 0, y: 0, w: 400, h: 300 };
  const fake = (over: Partial<SegmentModel> = {}): SegmentModel => ({
    segment: async () => { throw new Error("unused"); },
    nameRegion: async () => { throw new Error("unused"); },
    decideIcon: async () => ({ kind: "crop", assetRef: "", reason: "test fallback" }),
    classifyChildren: async ({ count }) => ({
      whole: null,
      children: Array.from({ length: count }, (_, i) => ({
        kind: "text" as const, displayName: `叫${i + 1}`,
      })),
    }),
    ...over,
  });

  it("marks leaves uncertain when no model is configured", async () => {
    const { store, projectId } = await seeded();
    const tree = await detectElements({ store }, projectId, REGION2);
    const parents = new Set(tree.nodes.map(n => n.parentId).filter(Boolean));
    const leaves = tree.nodes.filter(n => !parents.has(n.id) && n.kind !== "image");
    expect(leaves.length).toBeGreaterThan(0);
    expect(leaves.every(leaf => leaf.classification === "uncertain")).toBe(true);
    expect(tree.namedAt).toBeUndefined();
  });

  it("applies the model kind and name to leaves", async () => {
    const { store, projectId } = await seeded();
    const tree = await detectElements({ store, model: fake() }, projectId, REGION2);
    const parents = new Set(tree.nodes.map(n => n.parentId).filter(Boolean));
    const leaves = tree.nodes.filter(n => !parents.has(n.id));
    expect(leaves.every(leaf => leaf.kind === "text")).toBe(true);
    expect(leaves.every(leaf => leaf.classification === "model")).toBe(true);
    // 文字框校验接在模型分类之后跑：这里的叶子都是模型判成 text 的，落盘前都得带上 textBox
    expect(leaves.every(leaf => leaf.textBox !== undefined)).toBe(true);
    expect(tree.namedAt).toBeDefined();
  });

  // 容器的 kind 由几何决定，模型不得改写
  it("never lets the model overwrite a container kind", async () => {
    const { store, projectId } = await seeded();
    const model = fake({
      classifyChildren: async ({ count }) => ({
        whole: null,
        children: Array.from({ length: count }, () => ({
          kind: "icon" as const, displayName: "模型说是图标",
        })),
      }),
    });
    const tree = await detectElements({ store, model }, projectId, REGION2);
    const parents = new Set(tree.nodes.map(n => n.parentId).filter(Boolean));
    for (const node of tree.nodes.filter(n => parents.has(n.id))) {
      expect(["component", "grid"]).toContain(node.kind);
      expect(node.displayName).toBe("模型说是图标");   // 名字仍然采纳
    }
  });

  // 模型失败不能让整次检测失败——层级是纯本地算出来的
  it("still returns a usable tree when the model throws", async () => {
    const { store, projectId } = await seeded();
    const model = fake({
      classifyChildren: async () => { throw new Error("boom"); },
    });
    const tree = await detectElements({ store, model }, projectId, REGION2);
    expect(tree.nodes.length).toBeGreaterThan(0);
    const parents = new Set(tree.nodes.map(n => n.parentId).filter(Boolean));
    const leaves = tree.nodes.filter(n => !parents.has(n.id) && n.kind !== "image");
    expect(leaves.every(leaf => leaf.classification === "uncertain")).toBe(true);
  });
});

describe("图标关键词兜底", () => {
  const sourceImage = async () => {
    const path = join(mkdtempSync(join(tmpdir(), "rs-icon-")), "source.png");
    await sharp({ create: { width: 64, height: 64, channels: 4, background: "#ffffff" } }).png().toFile(path);
    return path;
  };
  const iconNode = (over: Partial<ElementNode> = {}): ElementNode => ({
    id: "icon", parentId: null, box: { x: 0, y: 0, w: 24, h: 24 },
    kind: "icon", displayName: "用户头像", style: {}, uniformity: 1,
    source: "auto", classification: "model", scrollX: false, scrollY: false,
    positioning: "flow", ...over,
  });
  const iconModelStub = (decision: Awaited<ReturnType<SegmentModel["decideIcon"]>> = {
    kind: "crop", assetRef: "", reason: "都不像",
  }) => {
    const decideIcon = vi.fn(async () => decision);
    const model: SegmentModel = {
      segment: async () => { throw new Error("unused"); },
      nameRegion: async () => { throw new Error("unused"); },
      classifyChildren: async () => { throw new Error("unused"); },
      decideIcon,
    };
    return { model, decideIcon };
  };

  it("marks an icon ambiguous when no usable keyword exists", async () => {
    const { model, decideIcon } = iconModelStub();
    const [node] = await decideIcons(model, await sourceImage(), [iconNode()]);
    expect(node!.iconDecision?.kind).toBe("ambiguous");
    if (node!.iconDecision?.kind !== "ambiguous") throw new Error("expected ambiguous decision");
    expect(node!.iconDecision.candidates).toEqual([]);
    expect(decideIcon).not.toHaveBeenCalled();
  });

  it("still uses english keywords when the model gave them", async () => {
    const { model, decideIcon } = iconModelStub({
      kind: "library", iconId: "mdi:gear", query: "gear", candidates: ["mdi:gear"],
    });
    const [node] = await decideIcons(model, await sourceImage(), [
      iconNode({ displayName: "设置", iconKeywords: ["settings", "gear"] }),
    ]);
    expect(node!.iconDecision?.kind).toBe("library");
    expect(decideIcon).toHaveBeenCalled();
  });

  it("keeps only the keywords that can match", async () => {
    const { model, decideIcon } = iconModelStub();
    const [node] = await decideIcons(model, await sourceImage(), [
      iconNode({ displayName: "消息", iconKeywords: ["消息", "chat"] }),
    ]);
    expect(decideIcon).toHaveBeenCalled();
    expect(node!.iconDecision?.keywords).toEqual(["chat"]);
  });

  it("does not ask the model when english keywords have no candidates", async () => {
    const { model, decideIcon } = iconModelStub();
    const [node] = await decideIcons(model, await sourceImage(), [
      iconNode({ iconKeywords: ["this-icon-does-not-exist-xyz"] }),
    ]);
    expect(node!.iconDecision?.kind).toBe("ambiguous");
    expect(decideIcon).not.toHaveBeenCalled();
  });
});

describe("structural review: flattening an over cut group", () => {
  const REGION3 = { x: 0, y: 0, w: 400, h: 300 };
  const node = (id: string, parentId: string | null, y: number, h: number) => ({
    id, parentId, box: { x: 0, y, w: 52, h }, kind: "component" as const,
    displayName: id, style: {}, uniformity: 1, source: "auto" as const,
    classification: "tool" as const, scrollX: false, scrollY: false,
    positioning: "flow" as const,
  });

  // 实测扫码图标被纵切成两半：间隙 2、子块 25，比值 0.08
  it("flags a group whose gaps are tiny relative to the children", () => {
    const parent = {
      ...node("p", null, 0, 60),
      layout: { direction: "column" as const, gap: 2,
        padding: { top: 0, right: 0, bottom: 0, left: 0 } },
    };
    const groups = groupForClassification(
      [parent, node("a", "p", 0, 25), node("b", "p", 27, 25)], REGION3);
    expect(groups.find(g => g.parentId === "p")!.mayBeWhole).toBe(true);
  });

  // 常用服务格子 [图标, 文字]：间隙 29、子块 54，比值 0.54，是真实结构
  it("does not flag a normal icon and label pair", () => {
    const parent = {
      ...node("p", null, 0, 200),
      layout: { direction: "column" as const, gap: 29,
        padding: { top: 0, right: 0, bottom: 0, left: 0 } },
    };
    const groups = groupForClassification(
      [parent, node("a", "p", 0, 74), node("b", "p", 103, 34)], REGION3);
    expect(groups.find(g => g.parentId === "p")!.mayBeWhole).toBe(false);
  });

  // 顶层组的"父"是区域本身，拍平就等于把整个区域当一个元素
  it("never lets the top level group be flattened", () => {
    const groups = groupForClassification(
      [node("a", null, 0, 25), node("b", null, 27, 25)], REGION3);
    expect(groups[0]!.mayBeWhole).toBe(false);
  });

  it("drops the children when the model says they are one element", async () => {
    const { store, projectId } = await seeded();
    const model: SegmentModel = {
      segment: async () => { throw new Error("unused"); },
      nameRegion: async () => { throw new Error("unused"); },
      decideIcon: async () => ({ kind: "crop", assetRef: "", reason: "test fallback" }),
      classifyChildren: async ({ count, mayBeWhole }) => ({
        whole: mayBeWhole ? { kind: "icon" as const, displayName: "扫码图标" } : null,
        children: Array.from({ length: count }, () => ({
          kind: "text" as const, displayName: "碎片",
        })),
      }),
    };
    const before = await detectElements({ store }, projectId, REGION3);
    const after = await detectElements({ store, model }, projectId, REGION3);
    // 没有可疑组时两者节点数一致；有可疑组时后者更少
    expect(after.nodes.length).toBeLessThanOrEqual(before.nodes.length);
    expect(after.nodes.every(n => n.kind !== "text" || n.displayName === "碎片")).toBe(true);
  });
});

describe("文字框校验接进检测", () => {
  it("checks every text node and leaves the others alone", async () => {
    const nodes = [
      { id: "n1", kind: "text" as const },
      { id: "n2", kind: "icon" as const },
    ];
    const checked = markTextBoxes(
      blankImage(200, 100),
      nodes.map(n => ({
        parentId: null, box: { x: 0, y: 0, w: 40, h: 20 }, displayName: "x",
        style: {}, uniformity: 1, source: "auto" as const,
        classification: "model" as const, scrollX: false, scrollY: false,
        positioning: "flow" as const, ...n,
      })),
    );
    expect(checked[0]!.textBox).toBeDefined();
    expect(checked[1]!.textBox).toBeUndefined();
  });
});
