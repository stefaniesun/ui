export interface Point {
  x: number;
  y: number;
}

export interface Viewport extends Point {
  zoom: number;
}

export interface Bounds extends Point {
  width: number;
  height: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export type NodeId = "workspace" | "detail";
export type NodePositions = Record<NodeId, Point>;

export interface StorageReader {
  getItem(key: string): string | null;
}

export interface StorageWriter {
  setItem(key: string, value: string): void;
}

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 3;
export const NODE_POSITIONS_STORAGE_KEY = "region-split:canvas-node-positions:v2";

export const DEFAULT_NODE_POSITIONS: NodePositions = {
  workspace: { x: 120, y: 80 },
  detail: { x: 1345, y: 80 },
};

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function zoomAtPoint(viewport: Viewport, nextZoom: number, screenPoint: Point): Viewport {
  const zoom = clampZoom(nextZoom);
  const flowX = (screenPoint.x - viewport.x) / viewport.zoom;
  const flowY = (screenPoint.y - viewport.y) / viewport.zoom;
  return {
    x: screenPoint.x - flowX * zoom,
    y: screenPoint.y - flowY * zoom,
    zoom,
  };
}

export function fitBounds(bounds: Bounds, viewport: ViewportSize, padding = 48): Viewport {
  const usableWidth = Math.max(1, viewport.width - padding * 2);
  const usableHeight = Math.max(1, viewport.height - padding * 2);
  const zoom = clampZoom(Math.min(usableWidth / bounds.width, usableHeight / bounds.height));
  return {
    x: (viewport.width - bounds.width * zoom) / 2 - bounds.x * zoom,
    y: (viewport.height - bounds.height * zoom) / 2 - bounds.y * zoom,
    zoom,
  };
}

function clonePositions(positions: NodePositions): NodePositions {
  return Object.fromEntries(
    (Object.keys(positions) as NodeId[]).map(id => [id, { ...positions[id] }]),
  ) as NodePositions;
}

function isPoint(value: unknown): value is Point {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<Point>;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function loadNodePositions(
  storage: StorageReader | undefined,
  key: string,
  fallback: NodePositions,
): NodePositions {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return clonePositions(fallback);
    const parsed = JSON.parse(raw) as Partial<NodePositions>;
    return Object.fromEntries(
      (Object.keys(fallback) as NodeId[]).map(id => [id, isPoint(parsed[id]) ? parsed[id] : fallback[id]]),
    ) as NodePositions;
  } catch {
    return clonePositions(fallback);
  }
}

export function saveNodePositions(
  storage: StorageWriter | undefined,
  key: string,
  positions: NodePositions,
): void {
  try {
    storage?.setItem(key, JSON.stringify(positions));
  } catch {
    // Storage is an optional enhancement; private mode and quota failures are harmless.
  }
}
