export type PanelWidths = {
  image: number;
  tree: number;
  property: number;
};

export type PanelBoundary = "image-tree" | "tree-property" | "property-edge";
export type ResettablePanelBoundary = Exclude<PanelBoundary, "property-edge">;

export const SPLITTER_SIZE = 6;
export const TREE_RESTORE_WIDTH = 34;
export const DEFAULT_WORKSPACE_HEIGHT = 760;
export const DEFAULT_PANEL_WIDTHS: PanelWidths = { image: 594, tree: 297, property: 297 };
export const MIN_PANEL_WIDTHS: PanelWidths = { image: 320, tree: 220, property: 220 };

function hasFiniteWidths(widths: PanelWidths) {
  return Object.values(widths).every(width => Number.isFinite(width) && width > 0);
}

function distributePair(total: number, preferredFirst: number, firstMinimum: number, secondMinimum: number) {
  if (!Number.isFinite(total) || total < firstMinimum + secondMinimum) return null;
  const first = Math.min(Math.max(preferredFirst, firstMinimum), total - secondMinimum);
  return [first, total - first] as const;
}

export function resizePanelBoundary(widths: PanelWidths, boundary: PanelBoundary, delta: number): PanelWidths {
  if (!hasFiniteWidths(widths) || !Number.isFinite(delta)) return { ...DEFAULT_PANEL_WIDTHS };

  if (boundary === "property-edge") {
    return {
      image: widths.image,
      tree: widths.tree,
      property: Math.max(MIN_PANEL_WIDTHS.property, widths.property + delta),
    };
  }

  if (boundary === "image-tree") {
    const total = widths.image + widths.tree;
    const pair = distributePair(
      total,
      widths.image + delta,
      MIN_PANEL_WIDTHS.image,
      MIN_PANEL_WIDTHS.tree,
    );
    if (!pair) return { ...DEFAULT_PANEL_WIDTHS };
    return { image: pair[0], tree: pair[1], property: widths.property };
  }

  const total = widths.tree + widths.property;
  const pair = distributePair(
    total,
    widths.tree + delta,
    MIN_PANEL_WIDTHS.tree,
    MIN_PANEL_WIDTHS.property,
  );
  if (!pair) return { ...DEFAULT_PANEL_WIDTHS };
  return { image: widths.image, tree: pair[0], property: pair[1] };
}

export function resetPanelBoundary(widths: PanelWidths, boundary: ResettablePanelBoundary): PanelWidths {
  if (!hasFiniteWidths(widths)) return { ...DEFAULT_PANEL_WIDTHS };

  if (boundary === "image-tree") {
    const total = widths.image + widths.tree;
    const defaultTotal = DEFAULT_PANEL_WIDTHS.image + DEFAULT_PANEL_WIDTHS.tree;
    const preferredImage = total * DEFAULT_PANEL_WIDTHS.image / defaultTotal;
    const pair = distributePair(
      total,
      preferredImage,
      MIN_PANEL_WIDTHS.image,
      MIN_PANEL_WIDTHS.tree,
    );
    if (!pair) return { ...DEFAULT_PANEL_WIDTHS };
    return { image: pair[0], tree: pair[1], property: widths.property };
  }

  const total = widths.tree + widths.property;
  const defaultTotal = DEFAULT_PANEL_WIDTHS.tree + DEFAULT_PANEL_WIDTHS.property;
  const preferredTree = total * DEFAULT_PANEL_WIDTHS.tree / defaultTotal;
  const pair = distributePair(
    total,
    preferredTree,
    MIN_PANEL_WIDTHS.tree,
    MIN_PANEL_WIDTHS.property,
  );
  if (!pair) return { ...DEFAULT_PANEL_WIDTHS };
  return { image: widths.image, tree: pair[0], property: pair[1] };
}

export function expandedWorkspaceWidth(widths: PanelWidths) {
  return widths.image + widths.tree + widths.property + SPLITTER_SIZE * 2;
}

export function collapsedWorkspaceWidth(widths: PanelWidths) {
  return widths.image + TREE_RESTORE_WIDTH + widths.property;
}
