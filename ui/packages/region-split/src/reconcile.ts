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
    scrollX: false,
    scrollY: false,
  }];
}

const MAX_INITIAL_REGIONS = 10;
const MIN_INITIAL_REGION_RATIO = 0.06;

/**
 * 在模型分析前，使用图像算法发现的水平分隔线生成可编辑的初始区域。
 * 候选线可能很密集，因此优先保留强线，并限制最小区块高度和区域总数。
 */
export function initialRegionsFromCandidateLines(
  image: { width: number; height: number },
  candidateLines: CandidateLine[],
): Region[] {
  const minHeight = Math.max(MIN_REGION_HEIGHT, Math.round(image.height * MIN_INITIAL_REGION_RATIO));
  const eligible = candidateLines
    .filter(line => line.y >= minHeight && line.y <= image.height - minHeight)
    .sort((a, b) => b.strength - a.strength || a.y - b.y);
  const boundaries: CandidateLine[] = [];

  for (const line of eligible) {
    if (boundaries.length >= MAX_INITIAL_REGIONS - 1) break;
    if (boundaries.some(existing => Math.abs(existing.y - line.y) < minHeight)) continue;
    boundaries.push(line);
  }

  if (boundaries.length === 0) return fullPageRegions(image);

  boundaries.sort((a, b) => a.y - b.y);
  const starts = [0, ...boundaries.map(line => Math.round(line.y))];
  return starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1]! : image.height;
    return {
      id: `region-${index + 1}`,
      displayName: `区域 ${index + 1}`,
      type: "other",
      bounds: { x: 0, y: start, w: image.width, h: end - start },
      confidence: index === 0 ? boundaries[0]!.strength : boundaries[index - 1]!.strength,
      // 纯图像分析看不出滚动行为，交给模型判断
      scrollX: false,
      scrollY: false,
    };
  });
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
      scrollX: meta.scrollX,
      scrollY: meta.scrollY,
    };
  });
}
