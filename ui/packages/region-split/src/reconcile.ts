import { MIN_REGION_HEIGHT, type CandidateLine, type RawSegment, type Region } from "./types.js";

const DEFAULT_SNAP_THRESHOLD = 12;

export interface ReconcileOptions {
  width: number;
  height: number;
  analyzedScale: number;
  candidateLines?: CandidateLine[];
  snapThreshold?: number;
}

export function fullPageRegions(image: { width: number; height: number }): Region[] {
  return [{
    id: "region-1",
    displayName: "整页",
    type: "other",
    bounds: { x: 0, y: 0, w: image.width, h: image.height },
    confidence: 0,
  }];
}

function snap(y: number, lines: CandidateLine[], threshold: number): number {
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
  return best ? best.y : y;
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function reconcile(segments: RawSegment[], opts: ReconcileOptions): Region[] {
  const image = { width: opts.width, height: opts.height };
  if (segments.length === 0) return fullPageRegions(image);

  const sorted = segments.slice().sort((a, b) => a.yStart - b.yStart);
  const lines = opts.candidateLines ?? [];
  const threshold = opts.snapThreshold ?? DEFAULT_SNAP_THRESHOLD;

  // 保留的边界，以及该边界之后那一段对应的原始 segment 下标
  const kept: { y: number; segmentIndex: number }[] = [];
  let previous = 0;
  for (let i = 1; i < sorted.length; i++) {
    const scaled = Math.round(sorted[i]!.yStart / opts.analyzedScale);
    const snapped = snap(scaled, lines, threshold);
    if (snapped < previous + MIN_REGION_HEIGHT) continue;
    if (snapped > image.height - MIN_REGION_HEIGHT) continue;
    kept.push({ y: snapped, segmentIndex: i });
    previous = snapped;
  }

  const starts = [0, ...kept.map(item => item.y)];
  const metaIndexes = [0, ...kept.map(item => item.segmentIndex)];
  const taken = new Set<string>();

  return starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1]! : image.height;
    const meta = sorted[metaIndexes[i]!]!;
    const id = uniqueId(meta.id, taken);
    taken.add(id);
    return {
      id,
      displayName: meta.displayName,
      type: meta.type,
      bounds: { x: 0, y: start, w: image.width, h: end - start },
      confidence: meta.confidence,
    };
  });
}
