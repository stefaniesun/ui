/** 半开区间 [start, end) */
export interface Run { start: number; end: number }

export function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function runsFromOccupancy(occupied: boolean[], minLength = 1): Run[] {
  const runs: Run[] = [];
  let start = -1;
  for (let i = 0; i <= occupied.length; i++) {
    const on = i < occupied.length && occupied[i] === true;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      if (i - start >= minLength) runs.push({ start, end: i });
      start = -1;
    }
  }
  return runs;
}

/**
 * 按间隙自适应合并游程。
 *
 * 阈值不能写死：同一页面里字与字的间隙是 1–5px，格子与格子之间是 77–116px，
 * 换一张图这两个数都会变。实测间隙分布是**双峰**的，所以取"本层最大间隙的
 * 一半"作阈值——它天然落在两个峰之间，且随图片尺寸自动缩放。
 */
export function mergeByGap(runs: Run[]): Run[] {
  if (runs.length < 2) return runs.map(run => ({ ...run }));
  const gaps = runs.slice(1).map((run, i) => run.start - runs[i]!.end);
  const threshold = Math.max(...gaps) * 0.5;
  const merged: Run[] = [{ ...runs[0]! }];
  for (let i = 1; i < runs.length; i++) {
    if (gaps[i - 1]! < threshold) merged[merged.length - 1]!.end = runs[i]!.end;
    else merged.push({ ...runs[i]! });
  }
  return merged;
}

/** 单元间距的一致性容差。实测同一网格内在 218.0–220.0 之间摆动。 */
export const PITCH_TOLERANCE = 4;

/**
 * 修复漏合并：单元之间的间隙偏小时，自适应阈值会把相邻两项并成一段。
 * 实测订单状态卡片切出 4 段而非 5，间距序列 219.0 / 220.0 / 324.5——
 * 那个异常值本身就是信号。
 *
 * 关键在于**怎么定新边界**：不从间距反推位置（那是猜，实测会偏十几个像素），
 * 而是回到合并前的原始游程，在过宽那一段内部**最大的间隙**处切开——
 * 那里本来就是两个单元之间的真实空白，是测量不是猜测。
 *
 * 只处理"恰好一段过宽"的情形；更复杂的错切返回 null 交人工。
 */
export function repairMissedMerge(merged: Run[], original: Run[]): Run[] | null {
  if (merged.length < 3) return null;
  const centers = merged.map(run => (run.start + run.end) / 2);
  const pitches = centers.slice(1).map((center, i) => center - centers[i]!);
  const pitch = medianOf(pitches);
  if (pitch <= 0) return null;
  if (pitches.every(value => Math.abs(value - pitch) <= PITCH_TOLERANCE)) return null;

  const sizes = merged.map(run => run.end - run.start);
  const typical = medianOf(sizes);
  const oversized = sizes
    .map((size, index) => ({ size, index }))
    .filter(item => item.size > typical + pitch * 0.5);
  if (oversized.length !== 1) return null;

  const index = oversized[0]!.index;
  const target = merged[index]!;
  const inside = original.filter(run => run.start >= target.start && run.end <= target.end);
  if (inside.length < 2) return null;

  let widestAt = 0;
  let widestGap = -1;
  for (let i = 0; i < inside.length - 1; i++) {
    const gap = inside[i + 1]!.start - inside[i]!.end;
    if (gap > widestGap) { widestGap = gap; widestAt = i; }
  }
  if (widestGap <= 0) return null;

  const out = [...merged];
  out.splice(index, 1,
    { start: target.start, end: inside[widestAt]!.end },
    { start: inside[widestAt + 1]!.start, end: target.end });
  return out;
}
