import sharp from "sharp";
import type { CandidateLine } from "./types.js";

export interface RowStat { mean: [number, number, number]; variance: number }

const MERGE_DISTANCE = 4;
// 少于这么多行的纯色段视为噪声，不作为候选切分线
const MIN_BAND_HEIGHT = 3;

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const f = (v: number) => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; };
  const [rl, gl, bl] = [f(r), f(g), f(b)];
  let x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
  let y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  let z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;
  const g2 = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  [x, y, z] = [g2(x), g2(y), g2(z)];
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function deltaE(a: [number, number, number], b: [number, number, number]): number {
  const la = rgbToLab(...a);
  const lb = rgbToLab(...b);
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

export function candidatesFromRows(
  rows: RowStat[],
  opts: { uniformVariance?: number; transitionDeltaE?: number; bandColorTolerance?: number } = {},
): CandidateLine[] {
  if (rows.length === 0) return [];
  const uniformVariance = opts.uniformVariance ?? 10;
  const transitionDeltaE = opts.transitionDeltaE ?? 12;
  // 容差要小于"浅灰分隔带 vs 白底"的 ΔE（约 3.5），否则分隔带会被并进白底；
  // 行均值是整行宽度上的平均，压缩噪声已被大幅抹平，1.5 足够稳。
  const bandColorTolerance = opts.bandColorTolerance ?? 1.5;
  const found: CandidateLine[] = [];

  // ① 留白带：连续的纯色行，且**整段颜色自洽**。
  //
  // 这里刻意不要求留白带等于"页面背景色（全行均值的中位数）"。实测发现，
  // 页面顶部有大面积彩色页头时（例如会员页的黄色渐变头），中位色会被拽成
  // 一个偏黄的奶油色，白色正文和灰色分隔带与它的 ΔE 都在 8 以上，
  // 结果全页最显眼的那条灰色分隔带反而检不出来。
  // 带内自洽同样能挡住照片内部的伪留白——照片很难连续多行既低方差、
  // 颜色又完全一致。
  let bandStart: number | null = null;
  let bandColor: [number, number, number] | null = null;
  const closeBand = (endExclusive: number) => {
    if (bandStart === null) return;
    const start = bandStart;
    const height = endExclusive - start;
    // 顶到图片边缘的留白不是模块边界；单行噪声也不算
    if (start > 0 && endExclusive < rows.length && height >= MIN_BAND_HEIGHT) {
      found.push({
        y: Math.floor(start + height / 2),
        strength: Math.min(1, height / 24),
      });
    }
    bandStart = null;
    bandColor = null;
  };
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y]!;
    const uniform = row.variance < uniformVariance;
    if (!uniform) { closeBand(y); continue; }
    if (bandColor !== null && deltaE(row.mean, bandColor) >= bandColorTolerance) {
      // 颜色变了：上一段到此为止，本行作为新一段的开头
      closeBand(y);
    }
    if (bandStart === null) { bandStart = y; bandColor = row.mean; }
  }
  closeBand(rows.length);

  // ② 突变行：与上一行的感知色差超过阈值
  for (let y = 1; y < rows.length; y++) {
    const difference = deltaE(rows[y]!.mean, rows[y - 1]!.mean);
    if (difference > transitionDeltaE) {
      found.push({ y, strength: Math.min(1, difference / 40) });
    }
  }

  // ③ 合并过近的候选，保留更强的一条
  found.sort((a, b) => a.y - b.y);
  const merged: CandidateLine[] = [];
  for (const line of found) {
    const previous = merged[merged.length - 1];
    if (previous && line.y - previous.y < MERGE_DISTANCE) {
      if (line.strength > previous.strength) merged[merged.length - 1] = line;
      continue;
    }
    merged.push(line);
  }
  return merged;
}

export async function rowStats(imagePath: string): Promise<RowStat[]> {
  const { data, info } = await sharp(imagePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const stats: RowStat[] = [];
  for (let y = 0; y < info.height; y++) {
    let r = 0, g = 0, b = 0;
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      r += data[i]!; g += data[i + 1]!; b += data[i + 2]!;
    }
    const mean: [number, number, number] = [r / info.width, g / info.width, b / info.width];
    let spread = 0;
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      spread += Math.hypot(data[i]! - mean[0], data[i + 1]! - mean[1], data[i + 2]! - mean[2]);
    }
    stats.push({ mean, variance: spread / info.width });
  }
  return stats;
}

export async function detectCandidateLines(imagePath: string): Promise<CandidateLine[]> {
  return candidatesFromRows(await rowStats(imagePath));
}
