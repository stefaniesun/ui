import { checkElementTreeInvariants, type ElementTree } from "./element-types.js";
import type { ElementSubtree } from "./element-refactor-types.js";
import { extractElementSubtree, replaceElementSubtree } from "./element-subtree-pure.js";
import type { InvariantViolation, Rect } from "./types.js";

export interface RefactorValidationInput {
  tree: ElementTree;
  region: Rect;
  original: ElementSubtree;
  candidate: ElementSubtree;
}

export interface RefactorValidationResult {
  valid: boolean;
  violations: InvariantViolation[];
}

function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w
    && inner.y + inner.h <= outer.y + outer.h;
}

function violation(code: string, message: string): InvariantViolation {
  return { code, message };
}

export function validateRefactorCandidate(
  input: RefactorValidationInput,
): RefactorValidationResult {
  const { tree, region, candidate } = input;
  const violations: InvariantViolation[] = [];
  let original: ElementSubtree;
  try {
    original = extractElementSubtree(tree, input.original.rootId);
  } catch (error) {
    return {
      valid: false,
      violations: [violation("refactor.missing-root", (error as Error).message)],
    };
  }
  const originalRoot = original.nodes.find(node => node.id === original.rootId);
  const candidateRoot = candidate.nodes.find(node => node.id === candidate.rootId);
  if (!originalRoot || !candidateRoot) {
    return {
      valid: false,
      violations: [violation("refactor.missing-root", "original or candidate root is absent")],
    };
  }

  const candidateIds = new Set(candidate.nodes.map(node => node.id));
  const roots = candidate.nodes.filter(node => !candidateIds.has(node.parentId ?? ""));
  if (roots.length !== 1 || roots[0]?.id !== candidate.rootId) {
    violations.push(violation("refactor.single-root", "candidate must contain exactly one declared root"));
  }
  if (candidateRoot.parentId !== originalRoot.parentId) {
    violations.push(violation("refactor.root-parent", "candidate root must inherit the original parent"));
  }

  const originalIds = new Set(original.nodes.map(node => node.id));
  const outsideIds = new Set(tree.nodes.filter(node => !originalIds.has(node.id)).map(node => node.id));
  for (const node of candidate.nodes) {
    if (outsideIds.has(node.id)) {
      violations.push(violation("refactor.external-id", `candidate id ${node.id} belongs outside the scope`));
    }
    if (node.id !== candidate.rootId && node.parentId !== null && !candidateIds.has(node.parentId)) {
      violations.push(violation("refactor.external-id", `${node.id} references parent outside the scope`));
    }
    if (!contains(originalRoot.box, node.box)) {
      violations.push(violation("refactor.outside-scope", `${node.id} escapes the original root bounds`));
    }
  }

  let merged: ElementTree;
  try {
    merged = replaceElementSubtree(tree, original.rootId, candidate);
  } catch (error) {
    violations.push(violation("refactor.invalid-replacement", (error as Error).message));
    return { valid: false, violations };
  }
  const baseline = new Set(checkElementTreeInvariants(tree, region)
    .map(item => `${item.code}:${item.message}`));
  violations.push(...checkElementTreeInvariants(merged, region)
    .filter(item => !baseline.has(`${item.code}:${item.message}`)));
  const unique = [...new Map(violations.map(item => [`${item.code}:${item.message}`, item])).values()];
  return { valid: unique.length === 0, violations: unique };
}
