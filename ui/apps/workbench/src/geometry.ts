import type { Rect } from "@ui-rebuild/workbench-contracts";
export function screenToLogical(clientX: number, clientY: number, canvas: DOMRect, logicalWidth: number): { x: number; y: number } {
  const scale = logicalWidth / canvas.width;
  return { x: (clientX - canvas.left) * scale, y: (clientY - canvas.top) * scale };
}
export function dragRect(start: { x: number; y: number }, end: { x: number; y: number }): Rect {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y) };
}
