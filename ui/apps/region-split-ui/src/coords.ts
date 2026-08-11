import type { CandidateLine } from "@region-split/core/browser";

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
