import { describe, expect, it } from "vitest";
import {
  checkElementTreeInvariants, elementNodeSchema, elementsDocSchema, regionKey,
  type ElementNode, type ElementTree,
} from "./element-types.js";
import type { Rect } from "./types.js";

const region: Rect = { x: 0, y: 100, w: 400, h: 300 };

function node(over: Partial<ElementNode> & Pick<ElementNode, "id" | "box">): ElementNode {
  return {
    parentId: null, kind: "component", displayName: "节点", style: {},
    uniformity: 1, source: "auto", classification: "tool",
    scrollX: false, scrollY: false, positioning: "flow", ...over,
  };
}

const tree = (nodes: ElementNode[]): ElementTree =>
  ({ regionKey: regionKey(region), detectedAt: "2026-08-13T00:00:00.000Z", nodes });

describe("regionKey", () => {
  it("keys a tree by the region's vertical span", () => {
    expect(regionKey({ x: 0, y: 396, w: 1170, h: 222 })).toBe("396-618");
  });
});

describe("checkElementTreeInvariants", () => {
  it("accepts a well formed tree", () => {
    const root = node({ id: "n1", box: { x: 0, y: 100, w: 400, h: 300 } });
    const child = node({ id: "n2", parentId: "n1", kind: "text", box: { x: 10, y: 110, w: 100, h: 40 } });
    expect(checkElementTreeInvariants(tree([root, child]), region)).toEqual([]);
  });

  it("accepts an empty tree", () => {
    expect(checkElementTreeInvariants(tree([]), region)).toEqual([]);
  });

  it("rejects a root that escapes the region", () => {
    const root = node({ id: "n1", box: { x: 0, y: 100, w: 400, h: 900 } });
    expect(checkElementTreeInvariants(tree([root]), region).map(v => v.code))
      .toContain("root-outside-region");
  });

  it("rejects a child that escapes its parent", () => {
    const root = node({ id: "n1", box: { x: 0, y: 100, w: 200, h: 100 } });
    const child = node({ id: "n2", parentId: "n1", kind: "text", box: { x: 150, y: 110, w: 100, h: 40 } });
    expect(checkElementTreeInvariants(tree([root, child]), region).map(v => v.code))
      .toContain("child-outside-parent");
  });

  it("rejects duplicate ids", () => {
    const a = node({ id: "n1", box: { x: 0, y: 100, w: 100, h: 50 } });
    const b = node({ id: "n1", box: { x: 0, y: 200, w: 100, h: 50 } });
    expect(checkElementTreeInvariants(tree([a, b]), region).map(v => v.code))
      .toContain("duplicate-id");
  });

  it("rejects a missing parent", () => {
    const orphan = node({ id: "n2", parentId: "ghost", box: { x: 0, y: 100, w: 100, h: 50 } });
    expect(checkElementTreeInvariants(tree([orphan]), region).map(v => v.code))
      .toContain("missing-parent");
  });

  it("rejects a parent cycle", () => {
    const a = node({ id: "n1", parentId: "n2", box: { x: 0, y: 100, w: 100, h: 50 } });
    const b = node({ id: "n2", parentId: "n1", box: { x: 0, y: 100, w: 100, h: 50 } });
    expect(checkElementTreeInvariants(tree([a, b]), region).map(v => v.code)).toContain("cycle");
  });

  it("rejects overlapping siblings", () => {
    const root = node({ id: "n1", box: { x: 0, y: 100, w: 400, h: 300 } });
    const a = node({ id: "n2", parentId: "n1", kind: "text", box: { x: 0, y: 100, w: 100, h: 50 } });
    const b = node({ id: "n3", parentId: "n1", kind: "text", box: { x: 50, y: 100, w: 100, h: 50 } });
    expect(checkElementTreeInvariants(tree([root, a, b]), region).map(v => v.code))
      .toContain("sibling-overlap");
  });

  it("rejects children hanging off a leaf", () => {
    const root = node({ id: "n1", kind: "image", box: { x: 0, y: 100, w: 400, h: 300 } });
    const child = node({ id: "n2", parentId: "n1", kind: "text", box: { x: 10, y: 110, w: 50, h: 20 } });
    expect(checkElementTreeInvariants(tree([root, child]), region).map(v => v.code))
      .toContain("leaf-with-children");
  });
});

describe("elementsDocSchema", () => {
  it("defaults an empty tree list", () => {
    expect(elementsDocSchema.parse({ schemaVersion: "1" }).trees).toEqual([]);
  });
});

describe("elementNodeSchema", () => {
  // 阶段二、三的字段现在就定义好，避免以后改 schema 破坏已存的文件
  it("defaults the stage two and three fields", () => {
    const parsed = elementNodeSchema.parse({
      id: "n1", parentId: null, box: { x: 0, y: 0, w: 10, h: 10 },
      kind: "component", displayName: "x", uniformity: 1,
    });
    expect(parsed.style).toEqual({});
    expect(parsed.source).toBe("auto");
    expect(parsed.classification).toBe("tool");
    expect(parsed.scrollX).toBe(false);
    expect(parsed.scrollY).toBe(false);
    expect(parsed.positioning).toBe("flow");
    expect(parsed.layout).toBeUndefined();
    expect(parsed.repeat).toBeUndefined();
    expect(parsed.asset).toBeUndefined();
  });

  it("round-trips a structured library icon decision", () => {
    const parsed = elementNodeSchema.parse({
      id: "icon", parentId: null, box: { x: 0, y: 0, w: 24, h: 24 },
      kind: "icon", displayName: "搜索", uniformity: 1,
      iconDecision: {
        kind: "library", iconId: "mdi:magnify", query: "search",
        candidates: ["mdi:magnify", "mdi:search-web"],
      },
    });
    expect(parsed.iconDecision).toEqual({
      kind: "library", iconId: "mdi:magnify", query: "search",
      candidates: ["mdi:magnify", "mdi:search-web"],
    });
  });

  it("rejects a library icon decision without candidates", () => {
    expect(() => elementNodeSchema.parse({
      id: "icon", parentId: null, box: { x: 0, y: 0, w: 24, h: 24 },
      kind: "icon", displayName: "搜索", uniformity: 1,
      iconDecision: { kind: "library", iconId: "mdi:magnify", query: "search" },
    })).toThrow();
  });

  it("round-trips an image asset while keeping legacy nodes valid", () => {
    const parsed = elementNodeSchema.parse({
      id: "image", parentId: null, box: { x: 2, y: 3, w: 10, h: 12 },
      kind: "image", displayName: "图片", uniformity: 1,
      asset: { ref: "crop.png", cutFrom: { x: 2, y: 3, w: 10, h: 12 } },
    });
    expect(parsed.asset).toEqual({ ref: "crop.png", cutFrom: { x: 2, y: 3, w: 10, h: 12 } });
  });

  it("rejects an invalid asset crop", () => {
    expect(() => elementNodeSchema.parse({
      id: "image", parentId: null, box: { x: 0, y: 0, w: 10, h: 10 },
      kind: "image", displayName: "图片", uniformity: 1,
      asset: { ref: "crop.png", cutFrom: { x: 0, y: 0, w: 0, h: 10 } },
    })).toThrow();
  });

  it("accepts a fully populated stage two node", () => {
    const parsed = elementNodeSchema.parse({
      id: "n1", parentId: null, box: { x: 0, y: 0, w: 10, h: 10 },
      kind: "grid", displayName: "x", uniformity: 0.9,
      layout: { direction: "row", gap: 24, padding: { top: 1, right: 2, bottom: 3, left: 4 } },
      repeat: { count: 5, templateId: "n2", pitch: 220 },
      scrollX: true, positioning: "absolute",
    });
    expect(parsed.layout?.direction).toBe("row");
    expect(parsed.repeat?.count).toBe(5);
    expect(parsed.scrollX).toBe(true);
    expect(parsed.positioning).toBe("absolute");
  });
});

describe("repeat 的槽位", () => {
  const listNode = (over: Record<string, unknown>) => elementNodeSchema.parse({
    id: "n1", parentId: null, box: { x: 0, y: 0, w: 10, h: 10 },
    kind: "grid", displayName: "列表", uniformity: 1, ...over,
  });

  it("keeps the slot and who set it", () => {
    const parsed = listNode({
      repeat: {
        count: 5, templateId: "c1", pitch: 219.75,
        slot: { w: 141, h: 134 }, slotBy: "human",
      },
    });
    expect(parsed.repeat?.slot).toEqual({ w: 141, h: 134 });
    expect(parsed.repeat?.slotBy).toBe("human");
  });

  // 老文件里的 repeat 没有这两个字段，读出来不能炸
  it("reads a legacy repeat without a slot", () => {
    const parsed = listNode({ repeat: { count: 5, templateId: "c1", pitch: 219.75 } });
    expect(parsed.repeat?.slot).toBeUndefined();
    expect(parsed.repeat?.slotBy).toBe("tool");
  });
});

describe("textBox 字段", () => {
  const node = (over: Record<string, unknown>) => elementNodeSchema.parse({
    id: "n1", parentId: null, box: { x: 0, y: 0, w: 10, h: 10 },
    kind: "text", displayName: "文字", uniformity: 1, ...over,
  });

  it("keeps a failed check with its reason", () => {
    const parsed = node({
      textBox: { ok: false, bands: 2, glyphAspect: 0.9, reason: "multi-band" },
    });
    expect(parsed.textBox).toEqual({
      ok: false, bands: 2, glyphAspect: 0.9, reason: "multi-band",
    });
  });

  it("keeps a passing check without a reason", () => {
    expect(node({ textBox: { ok: true, bands: 1, glyphAspect: 0.94 } }).textBox?.ok).toBe(true);
  });

  // 没检查过和检查通过是两回事，不能给默认值
  it("stays undefined when the box was never checked", () => {
    expect(node({}).textBox).toBeUndefined();
  });

  it("keeps the empty-box reason distinct from multi-band", () => {
    const parsed = node({ textBox: { ok: false, bands: 0, glyphAspect: 0, reason: "no-ink" } });
    expect(parsed.textBox?.reason).toBe("no-ink");
  });

  it("rejects an unknown reason", () => {
    expect(() => node({ textBox: { ok: false, bands: 1, glyphAspect: 2, reason: "什么" } }))
      .toThrow();
  });
});
