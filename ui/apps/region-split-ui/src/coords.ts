import type { CandidateLine, Rect } from "@region-split/core/browser";

export interface Point { x: number; y: number }
export function imageRectToDisplay(rect: Rect, scaleX: number, scaleY: number): Rect {
  return { x: rect.x * scaleX, y: rect.y * scaleY, w: rect.w * scaleX, h: rect.h * scaleY };
}
export function displayRectToImage(rect: Rect, scaleX: number, scaleY: number): Rect {
  return { x: Math.round(rect.x / scaleX), y: Math.round(rect.y / scaleY), w: Math.round(rect.w / scaleX), h: Math.round(rect.h / scaleY) };
}
export function normalizeDragRect(start: Point, end: Point): Rect {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y) };
}

export function toImageY(clientY: number, rectTop: number, displayScale: number): number {
  return Math.round((clientY - rectTop) / displayScale);
}

export function snapToCandidates(
  y: number, lines: CandidateLine[], threshold: number,
): { y: number; snapped: boolean } {
  let best: CandidateLine | null = null;
  for (const line of lines) {
    const distance = Math.abs(line.y - y);
    if (distance > threshold) continue;
    if (
      best === null ||
      line.strength > best.strength ||
      (line.strength === best.strength && distance < Math.abs(best.y - y))
    ) {
      best = line;
    }
  }
  return best ? { y: best.y, snapped: true } : { y, snapped: false };
}
