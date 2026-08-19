import type {
  Bounds,
  Point,
  StorageReader,
  StorageWriter,
  Viewport,
  ViewportSize,
} from "./canvas-state.js";

export type DetailNodeId = `detail:${string}`;
export type DetailPositions = Record<string, Point>;

const DETAIL_GAP = 80;

export function detailNodeId(regionId: string): DetailNodeId {
  return `detail:${regionId}`;
}

export function screenPointToWorld(
  point: Point,
  canvas: { left: number; top: number },
  viewport: Viewport,
): Point {
  return {
    x: (point.x - canvas.left - viewport.x) / viewport.zoom,
    y: (point.y - canvas.top - viewport.y) / viewport.zoom,
  };
}

function isPoint(value: unknown): value is Point {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<Point>;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function loadDetailPositions(
  storage: StorageReader | undefined,
  key: string,
  validIds: ReadonlySet<string>,
): DetailPositions {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, Point] =>
        validIds.has(entry[0]) && isPoint(entry[1])),
    );
  } catch {
    return {};
  }
}

export function saveDetailPositions(
  storage: StorageWriter | undefined,
  key: string,
  positions: DetailPositions,
): void {
  try {
    storage?.setItem(key, JSON.stringify(positions));
  } catch {
    // Position persistence is optional.
  }
}

function intersects(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width + DETAIL_GAP
    && a.x + a.width + DETAIL_GAP > b.x
    && a.y < b.y + b.height + DETAIL_GAP
    && a.y + a.height + DETAIL_GAP > b.y;
}

export function nextDetailPosition(
  workspace: Bounds,
  occupied: readonly Bounds[],
  size: ViewportSize,
  columnHeight: number,
): Point {
  const startX = workspace.x + workspace.width + 120;
  const startY = workspace.y;
  let x = startX;
  let y = startY;

  while (occupied.some(bounds => intersects({ x, y, ...size }, bounds))) {
    y += size.height + DETAIL_GAP;
    if (y + size.height > startY + columnHeight) {
      x += size.width + DETAIL_GAP;
      y = startY;
    }
  }
  return { x, y };
}

export function centerNodeViewport(
  node: Bounds,
  viewport: ViewportSize,
  zoom: number,
): Viewport {
  return {
    x: (viewport.width - node.width * zoom) / 2 - node.x * zoom,
    y: (viewport.height - node.height * zoom) / 2 - node.y * zoom,
    zoom,
  };
}
