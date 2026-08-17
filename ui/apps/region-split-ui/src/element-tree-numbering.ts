import type { ElementNode } from "@region-split/core/browser";

export interface NumberedElementNode {
  node: ElementNode;
  depth: number;
  number: string;
}

interface PendingNode extends NumberedElementNode {}

export function numberElementTree(nodes: readonly ElementNode[]): NumberedElementNode[] {
  const childrenOf = new Map<string | null, ElementNode[]>();
  for (const node of nodes) {
    const list = childrenOf.get(node.parentId) ?? [];
    list.push(node);
    childrenOf.set(node.parentId, list);
  }

  const rows: NumberedElementNode[] = [];
  const visited = new Set<ElementNode>();
  const knownIds = new Set(nodes.map((node) => node.id));
  let rootNumber = 0;

  const appendBranch = (root: ElementNode, number: string) => {
    const scheduled = new Set<ElementNode>([root]);
    const stack: PendingNode[] = [{ node: root, depth: 0, number }];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current.node)) continue;
      visited.add(current.node);
      rows.push(current);

      const children = (childrenOf.get(current.node.id) ?? [])
        .filter((child) => !visited.has(child) && !scheduled.has(child));
      children.forEach((child) => scheduled.add(child));
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push({
          node: children[index]!,
          depth: current.depth + 1,
          number: `${current.number}.${index + 1}`,
        });
      }
    }
  };

  const appendRoot = (root: ElementNode) => {
    if (visited.has(root)) return;
    rootNumber += 1;
    appendBranch(root, `${rootNumber}`);
  };
  (childrenOf.get(null) ?? []).forEach(appendRoot);
  nodes.filter((node) => node.parentId !== null && !knownIds.has(node.parentId)).forEach(appendRoot);
  nodes.forEach(appendRoot);
  return rows;
}

export function elementNumberMap(nodes: readonly ElementNode[]): Map<string, string> {
  return new Map(numberElementTree(nodes).map(({ node, number }) => [node.id, number]));
}
