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
