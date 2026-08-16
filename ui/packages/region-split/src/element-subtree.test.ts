import { describe, expect, it } from "vitest";
import type { ElementNode, ElementTree } from "./element-types.js";
import {
  diffElementSubtrees,
  extractElementSubtree,
  hashElementTree,
  replaceElementSubtree,
} from "./element-subtree.js";
import type { ElementSubtree, RefactorDiffKind } from "./element-refactor-types.js";

function node(input: Partial<ElementNode> & Pick<ElementNode, "id">): ElementNode {
  return {
    id: input.id,
    parentId: input.parentId ?? null,
    box: input.box ?? { x: 0, y: 0, w: 100, h: 100 },
    kind: input.kind ?? "component",
    displayName: input.displayName ?? input.id,
    style: input.style ?? {},
    uniformity: input.uniformity ?? 1,
    source: input.source ?? "auto",
    classification: input.classification ?? "tool",
    scrollX: input.scrollX ?? false,
    scrollY: input.scrollY ?? false,
    positioning: input.positioning ?? "flow",
    ...(input.layout ? { layout: input.layout } : {}),
  };
}

function tree(nodes: ElementNode[]): ElementTree {
  return { regionKey: "0-200", detectedAt: "2026-08-16T00:00:00.000Z", nodes };
}

describe("element subtree primitives", () => {
  it("extracts a root and all descendants in source order", () => {
    const sibling = node({ id: "sibling", box: { x: 110, y: 0, w: 90, h: 100 } });
    const root = node({ id: "root" });
    const child = node({ id: "child", parentId: "root", box: { x: 10, y: 10, w: 80, h: 80 } });
    const grandchild = node({ id: "grandchild", parentId: "child", kind: "text", box: { x: 20, y: 20, w: 40, h: 20 } });

    expect(extractElementSubtree(tree([sibling, root, grandchild, child]), "root"))
      .toEqual({ rootId: "root", nodes: [root, grandchild, child] });
  });

  it("rejects an unknown extraction root", () => {
    expect(() => extractElementSubtree(tree([]), "missing"))
      .toThrow("unknown element root missing");
  });

  it("replaces only the original fragment at the root position without mutation", () => {
    const before = node({ id: "before", box: { x: 0, y: 0, w: 20, h: 20 } });
    const root = node({ id: "root", box: { x: 20, y: 0, w: 100, h: 100 } });
    const child = node({ id: "child", parentId: "root", box: { x: 30, y: 10, w: 20, h: 20 } });
    const after = node({ id: "after", box: { x: 130, y: 0, w: 20, h: 20 } });
    const original = tree([before, root, child, after]);
    const snapshot = structuredClone(original);
    const newRoot = node({ id: "new-root", box: root.box });
    const newChild = node({ id: "new-child", parentId: "new-root", kind: "text", box: child.box });

    const replaced = replaceElementSubtree(original, "root", {
      rootId: "new-root", nodes: [newRoot, newChild],
    });

    expect(replaced.nodes).toEqual([before, newRoot, newChild, after]);
    expect(original).toEqual(snapshot);
  });

  it("rejects a candidate whose declared root is absent", () => {
    expect(() => replaceElementSubtree(tree([node({ id: "root" })]), "root", {
      rootId: "missing", nodes: [node({ id: "candidate" })],
    })).toThrow("candidate root missing is absent");
  });

  it("produces a stable tree hash without mutation", () => {
    const original = tree([node({ id: "root" })]);
    const copy = structuredClone(original);
    expect(hashElementTree(copy)).toBe(hashElementTree(original));
    expect(original).toEqual(copy);
  });

  it("reports all deterministic structural and property differences", () => {
    const original: ElementSubtree = {
      rootId: "old-root",
      nodes: [
        node({ id: "old-root", displayName: "旧根" }),
        node({ id: "removed", parentId: "old-root", kind: "text", box: { x: 5, y: 5, w: 20, h: 10 } }),
        node({ id: "changed", parentId: "old-root", kind: "component", displayName: "旧名称", box: { x: 30, y: 5, w: 40, h: 40 }, style: { background: "#fff" }, layout: { direction: "row", gap: 4, padding: { top: 0, right: 0, bottom: 0, left: 0 } } }),
      ],
    };
    const candidate: ElementSubtree = {
      rootId: "new-root",
      nodes: [
        node({ id: "new-root", displayName: "新根" }),
        node({ id: "changed", parentId: "new-root", kind: "grid", displayName: "新名称", box: { x: 32, y: 6, w: 42, h: 42 }, style: { background: "#000" }, layout: { direction: "column", gap: 8, padding: { top: 1, right: 1, bottom: 1, left: 1 } } }),
        node({ id: "added", parentId: "new-root", kind: "text", box: { x: 80, y: 5, w: 15, h: 10 } }),
      ],
    };

    const kinds = diffElementSubtrees(original, candidate).map(item => item.kind);
    const expected: RefactorDiffKind[] = [
      "root-replaced", "added", "removed", "moved", "kind-changed",
      "name-changed", "box-changed", "layout-changed", "style-changed",
    ];
    for (const kind of expected) expect(kinds).toContain(kind);
    expect(diffElementSubtrees(original, candidate)).toEqual(diffElementSubtrees(original, candidate));
  });
});
