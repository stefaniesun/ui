import type { ElementNode, ElementTree } from "./element-types.js";
import {
  refactorDiffKinds,
  type ElementSubtree,
  type RefactorDiffItem,
  type RefactorDiffKind,
} from "./element-refactor-types.js";

function descendantIds(nodes: ElementNode[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node.parentId !== null && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id);
        changed = true;
      }
    }
  }
  return ids;
}

export function extractElementSubtree(tree: ElementTree, rootId: string): ElementSubtree {
  if (!tree.nodes.some(node => node.id === rootId)) {
    throw new Error(`unknown element root ${rootId}`);
  }
  const ids = descendantIds(tree.nodes, rootId);
  return { rootId, nodes: tree.nodes.filter(node => ids.has(node.id)) };
}

export function replaceElementSubtree(
  tree: ElementTree,
  rootId: string,
  candidate: ElementSubtree,
): ElementTree {
  const rootIndex = tree.nodes.findIndex(node => node.id === rootId);
  if (rootIndex < 0) throw new Error(`unknown element root ${rootId}`);
  if (!candidate.nodes.some(node => node.id === candidate.rootId)) {
    throw new Error(`candidate root ${candidate.rootId} is absent`);
  }
  const removed = descendantIds(tree.nodes, rootId);
  const nodes = tree.nodes.filter(node => !removed.has(node.id));
  const insertAt = tree.nodes.slice(0, rootIndex).filter(node => !removed.has(node.id)).length;
  nodes.splice(insertAt, 0, ...candidate.nodes);
  return { ...tree, nodes };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function push(
  output: RefactorDiffItem[], kind: RefactorDiffKind, nodeId: string,
  before?: ElementNode, after?: ElementNode,
): void {
  output.push({ nodeId, kind, ...(before ? { before } : {}), ...(after ? { after } : {}) });
}

export function diffElementSubtrees(
  original: ElementSubtree,
  candidate: ElementSubtree,
): RefactorDiffItem[] {
  const output: RefactorDiffItem[] = [];
  const before = new Map(original.nodes.map(node => [node.id, node]));
  const after = new Map(candidate.nodes.map(node => [node.id, node]));
  const rootReplaced = original.rootId !== candidate.rootId;
  if (rootReplaced) {
    push(output, "root-replaced", candidate.rootId, before.get(original.rootId), after.get(candidate.rootId));
  }
  for (const node of candidate.nodes) {
    if (!before.has(node.id) && (!rootReplaced || node.id !== candidate.rootId)) {
      push(output, "added", node.id, undefined, node);
    }
  }
  for (const node of original.nodes) {
    if (!after.has(node.id) && (!rootReplaced || node.id !== original.rootId)) {
      push(output, "removed", node.id, node);
    }
  }
  for (const node of candidate.nodes) {
    const previous = before.get(node.id);
    if (!previous) continue;
    if (previous.parentId !== node.parentId) push(output, "moved", node.id, previous, node);
    if (previous.kind !== node.kind) push(output, "kind-changed", node.id, previous, node);
    if (previous.displayName !== node.displayName) push(output, "name-changed", node.id, previous, node);
    if (!equal(previous.box, node.box)) push(output, "box-changed", node.id, previous, node);
    if (!equal(previous.layout, node.layout)) push(output, "layout-changed", node.id, previous, node);
    if (!equal(previous.style, node.style)) push(output, "style-changed", node.id, previous, node);
  }
  const typeOrder = new Map(refactorDiffKinds.map((kind, index) => [kind, index]));
  const nodeOrder = new Map(candidate.nodes.map((node, index) => [node.id, index] as const));
  for (const [index, node] of original.nodes.entries()) {
    if (!nodeOrder.has(node.id)) nodeOrder.set(node.id, candidate.nodes.length + index);
  }
  return output.sort((a, b) =>
    ((nodeOrder.get(a.nodeId) ?? 0) - (nodeOrder.get(b.nodeId) ?? 0))
    || (typeOrder.get(a.kind)! - typeOrder.get(b.kind)!));
}
