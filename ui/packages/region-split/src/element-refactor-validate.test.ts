import { describe, expect, it } from "vitest";
import type { ElementNode, ElementTree } from "./element-types.js";
import type { ElementSubtree } from "./element-refactor-types.js";
import { extractElementSubtree } from "./element-subtree.js";
import { validateRefactorCandidate } from "./element-refactor-validate.js";

const region = { x: 0, y: 0, w: 300, h: 200 };

function node(input: Partial<ElementNode> & Pick<ElementNode, "id">): ElementNode {
  return {
    id: input.id,
    parentId: input.parentId ?? null,
    box: input.box ?? { x: 20, y: 20, w: 100, h: 100 },
    kind: input.kind ?? "component",
    displayName: input.displayName ?? input.id,
    style: input.style ?? {},
    uniformity: 1,
    source: "auto",
    classification: "tool",
    scrollX: false,
    scrollY: false,
    positioning: "flow",
  };
}

function fixture(): { tree: ElementTree; original: ElementSubtree } {
  const nodes = [
    node({ id: "outside", box: { x: 160, y: 20, w: 100, h: 100 } }),
    node({ id: "root" }),
    node({ id: "child", parentId: "root", kind: "text", box: { x: 30, y: 30, w: 30, h: 20 } }),
  ];
  const tree: ElementTree = { regionKey: "0-200", detectedAt: "now", nodes };
  return { tree, original: extractElementSubtree(tree, "root") };
}

function validCandidate(): ElementSubtree {
  return {
    rootId: "new-root",
    nodes: [
      node({ id: "new-root" }),
      node({ id: "new-child", parentId: "new-root", kind: "text", box: { x: 30, y: 30, w: 30, h: 20 } }),
    ],
  };
}

function codes(candidate: ElementSubtree): string[] {
  const { tree, original } = fixture();
  return validateRefactorCandidate({ tree, region, original, candidate })
    .violations.map(item => item.code);
}

describe("validateRefactorCandidate", () => {
  it("accepts a valid single-root replacement without mutating the tree", () => {
    const { tree, original } = fixture();
    const snapshot = structuredClone(tree);
    expect(validateRefactorCandidate({ tree, region, original, candidate: validCandidate() }))
      .toEqual({ valid: true, violations: [] });
    expect(tree).toEqual(snapshot);
  });

  it.each([
    ["multiple roots", { ...validCandidate(), nodes: [...validCandidate().nodes, node({ id: "second-root" })] }, "refactor.single-root"],
    ["wrong root parent", { ...validCandidate(), nodes: [node({ id: "new-root", parentId: "outside" }), validCandidate().nodes[1]!] }, "refactor.root-parent"],
    ["duplicate ids", { rootId: "new-root", nodes: [node({ id: "new-root" }), node({ id: "new-root" })] }, "duplicate-id"],
    ["orphan", { ...validCandidate(), nodes: [validCandidate().nodes[0]!, node({ id: "orphan", parentId: "missing", kind: "text" })] }, "missing-parent"],
    ["cycle", { rootId: "a", nodes: [node({ id: "a", parentId: "b" }), node({ id: "b", parentId: "a" })] }, "cycle"],
    ["external parent", { ...validCandidate(), nodes: [validCandidate().nodes[0]!, node({ id: "external-child", parentId: "outside", kind: "text" })] }, "refactor.external-id"],
    ["outside id reuse", { rootId: "outside", nodes: [node({ id: "outside" })] }, "refactor.external-id"],
    ["new id collision", { ...validCandidate(), nodes: [...validCandidate().nodes, node({ id: "outside", parentId: "new-root", kind: "text" })] }, "refactor.external-id"],
    ["outside bounds", { rootId: "new-root", nodes: [node({ id: "new-root", box: { x: 10, y: 20, w: 110, h: 100 } })] }, "refactor.outside-scope"],
  ])("rejects %s", (_name, candidate, code) => {
    expect(codes(candidate as ElementSubtree)).toContain(code);
  });
});
