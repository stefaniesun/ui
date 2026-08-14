/**
 * 用**渲染比对**定字号和字重：量出目标，渲染候选，比对。
 *
 * 全程不使用绝对经验系数。所有"字形占多少 em"之类的比例都靠"拿同一串文字
 * 渲染一次"现算——字形复杂度和字号因此自动抵消。
 *
 * 渲染能力通过 `MetricsSource` 注入，核心逻辑不依赖 canvas，可以单测。
 */

/** 参考字号。比例是无量纲的，取多大都行，100 便于心算。 */
export const REFERENCE_SIZE = 100;

/**
 * 候选字重。移动端 UI 实际用到的就这几档；再细分靠覆盖率也分不开。
 * 实测「关注领券」标题判为 500、「联系客服」标签判为 400，与肉眼一致。
 */
export const FONT_WEIGHTS = [400, 500, 700] as const;
export type FontWeight = (typeof FONT_WEIGHTS)[number];

export interface MetricsSource {
  /** 这串文字在 REFERENCE_SIZE 下的墨迹高度（不是行高，是实际笔画上下沿） */
  inkHeightAtReference(text: string, weight: number): number;
  /** 在给定字号字重下渲染，返回墨像素占墨迹框的比例 */
  coverage(text: string, weight: number, size: number): number;
}

/**
 * 由墨迹高度反推字号。
 *
 * **不能用固定系数**：同一字体下实测比例 联系客服 0.940、`¥18` 0.770、
 * `gjpqy` 1.030（有下伸部），差 34%。所以拿这串文字自己的比例来换算。
 */
export function fitFontSize(
  source: MetricsSource, text: string, weight: number, inkHeight: number,
): number | null {
  if (inkHeight <= 0) return null;
  const reference = source.inkHeightAtReference(text, weight);
  if (!Number.isFinite(reference) || reference <= 0) return null;
  return (inkHeight * REFERENCE_SIZE) / reference;
}

export interface FontMatch {
  fontSize: number;
  fontWeight: FontWeight;
  /** 最优候选的覆盖率误差，越小越有把握 */
  error: number;
  /** 与次优候选的差距。太接近说明判不准，界面应当提示存疑。 */
  margin: number;
}

/**
 * 逐个字重试：各自拟合字号、渲染、比覆盖率，取误差最小的。
 *
 * 覆盖率**不能单独当字重判据**——实测标签 0.429 与标题 0.431 几乎相同，
 * 因为字号越小笔画相对越粗。渲染同一串文字后再比，尺寸和字形都被抵消，
 * 差距才拉得开（实测最优与次优差 4–10 倍）。
 */
export function matchFont(
  source: MetricsSource, text: string, inkHeight: number, inkCoverage: number,
): FontMatch | null {
  if (text.trim() === "" || inkHeight <= 0 || inkCoverage <= 0) return null;

  const scored: { weight: FontWeight; size: number; error: number }[] = [];
  for (const weight of FONT_WEIGHTS) {
    const size = fitFontSize(source, text, weight, inkHeight);
    if (size === null || size <= 0) continue;
    const rendered = source.coverage(text, weight, size);
    if (!Number.isFinite(rendered) || rendered <= 0) continue;
    scored.push({ weight, size, error: Math.abs(rendered - inkCoverage) });
  }
  if (scored.length === 0) return null;

  scored.sort((a, b) => a.error - b.error);
  const best = scored[0]!;
  const runnerUp = scored[1];
  return {
    fontSize: Math.round(best.size * 10) / 10,
    fontWeight: best.weight,
    error: Math.round(best.error * 1000) / 1000,
    margin: runnerUp ? Math.round((runnerUp.error - best.error) * 1000) / 1000 : Infinity,
  };
}
