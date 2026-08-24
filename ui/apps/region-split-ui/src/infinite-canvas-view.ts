export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

export interface CanvasRect extends CanvasPoint, CanvasSize {}

export interface CanvasView extends CanvasPoint {
  scale: number;
}

export const MIN_CANVAS_SCALE = 0.2;
export const MAX_CANVAS_SCALE = 4;
export const DEFAULT_VIEW: Readonly<CanvasView> = Object.freeze({ scale: 1, x: 0, y: 0 });

function isFiniteNumber(value: number) {
  return Number.isFinite(value);
}

function isValidSize(size: CanvasSize) {
  return isFiniteNumber(size.width)
    && isFiniteNumber(size.height)
    && size.width > 0
    && size.height > 0;
}

function isValidView(view: CanvasView) {
  return isFiniteNumber(view.scale)
    && view.scale > 0
    && isFiniteNumber(view.x)
    && isFiniteNumber(view.y);
}

export function clampScale(scale: number) {
  if (!isFiniteNumber(scale)) return DEFAULT_VIEW.scale;
  return Math.min(MAX_CANVAS_SCALE, Math.max(MIN_CANVAS_SCALE, scale));
}

export function fitView(viewport: CanvasSize, stage: CanvasSize, padding: number): CanvasView {
  if (!isValidSize(viewport) || !isValidSize(stage) || !isFiniteNumber(padding)) {
    return { ...DEFAULT_VIEW };
  }

  const safePadding = Math.max(0, padding);
  const availableWidth = Math.max(1, viewport.width - safePadding * 2);
  const availableHeight = Math.max(1, viewport.height - safePadding * 2);
  const scale = clampScale(Math.min(availableWidth / stage.width, availableHeight / stage.height));

  return {
    scale,
    x: (viewport.width - stage.width * scale) / 2,
    y: (viewport.height - stage.height * scale) / 2,
  };
}

export function zoomAt(view: CanvasView, requestedScale: number, anchor: CanvasPoint): CanvasView {
  if (!isValidView(view)
    || !isFiniteNumber(requestedScale)
    || !isFiniteNumber(anchor.x)
    || !isFiniteNumber(anchor.y)) {
    return { ...DEFAULT_VIEW };
  }

  const scale = clampScale(requestedScale);
  const stageX = (anchor.x - view.x) / view.scale;
  const stageY = (anchor.y - view.y) / view.scale;

  return {
    scale,
    x: anchor.x - stageX * scale,
    y: anchor.y - stageY * scale,
  };
}

export function keepViewportCenter(
  view: CanvasView,
  previousViewport: CanvasSize,
  nextViewport: CanvasSize,
): CanvasView {
  if (!isValidView(view) || !isValidSize(previousViewport) || !isValidSize(nextViewport)) {
    return { ...DEFAULT_VIEW };
  }

  const stageX = (previousViewport.width / 2 - view.x) / view.scale;
  const stageY = (previousViewport.height / 2 - view.y) / view.scale;

  return {
    ...view,
    x: nextViewport.width / 2 - stageX * view.scale,
    y: nextViewport.height / 2 - stageY * view.scale,
  };
}

export function revealRect(
  view: CanvasView,
  viewport: CanvasSize,
  target: CanvasRect,
  padding: number,
): CanvasView {
  if (!isValidView(view)) return { ...DEFAULT_VIEW };
  if (!isValidSize(viewport)
    || !isValidSize(target)
    || !isFiniteNumber(target.x)
    || !isFiniteNumber(target.y)
    || !isFiniteNumber(padding)) {
    return view;
  }

  const safePadding = Math.max(0, padding);
  const left = view.x + target.x * view.scale;
  const top = view.y + target.y * view.scale;
  const width = target.width * view.scale;
  const height = target.height * view.scale;
  const right = left + width;
  const bottom = top + height;
  const availableWidth = viewport.width - safePadding * 2;
  const availableHeight = viewport.height - safePadding * 2;
  let x = view.x;
  let y = view.y;

  if (width > availableWidth) x += viewport.width / 2 - (left + width / 2);
  else if (left < safePadding) x += safePadding - left;
  else if (right > viewport.width - safePadding) x -= right - (viewport.width - safePadding);
  if (height > availableHeight) y += viewport.height / 2 - (top + height / 2);
  else if (top < safePadding) y += safePadding - top;
  else if (bottom > viewport.height - safePadding) y -= bottom - (viewport.height - safePadding);

  const result = { ...view, x, y };
  return isValidView(result) ? result : { ...DEFAULT_VIEW };
}
