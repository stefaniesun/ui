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

export type NodeId = "workspace" | "detail" | "page";
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
  page: { x: 1345, y: 720 },
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

const PORT_Y = 21;
const PIPELINE: readonly [NodeId, NodeId][] = [["workspace", "detail"], ["workspace", "page"]];

export function portAnchors(
  positions: NodePositions, widths: Record<NodeId, number>,
): { from: Point; to: Point }[] {
  return PIPELINE.map(([from, to]) => ({
    from: { x: positions[from].x + widths[from], y: positions[from].y + PORT_Y },
    to: { x: positions[to].x, y: positions[to].y + PORT_Y },
  }));
}

const MIN_HANDLE = 60;
export function bezierPath(from: Point, to: Point): string {
  const handle = Math.max(MIN_HANDLE, Math.abs(to.x - from.x) * 0.5);
  return `M ${from.x} ${from.y} C ${from.x + handle} ${from.y}, ${to.x - handle} ${to.y}, ${to.x} ${to.y}`;
}

/** 按下的目标不该触发平移的那些：可交互控件、节点表头、以及显式标注的区域 */
const PAN_BLOCKERS =
  "[data-no-canvas-pan],button,input,select,textarea,a,[data-node-header]";

/**
 * 这一下按下能不能开始平移画布。
 *
 * 纯判据，不碰视口——挂着整个画布去测它会跟挂载后的异步重定位打架。
 *
 * **`.world` 必须认。** 它铺满 10000×6000 且要接收指针事件（节点靠它承事件），
 * 所以点在画布空白处命中的是它而不是 `.pipeline-canvas`；不认它就等于整块画布
 * 都拖不动。只认 `.world` **自己**，不用 `closest`：那样节点内部的空白也会触发平移。
 */
export function canStartPan(target: EventTarget | null, canvas: Element | null): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest(PAN_BLOCKERS)) return false;
  return target === canvas
    || target.classList.contains("world")
    || target.classList.contains("grid")
    || Boolean(target.closest("[data-canvas-pan]"));
}
