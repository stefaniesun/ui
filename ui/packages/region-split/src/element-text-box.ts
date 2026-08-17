import { medianOf, runsFromOccupancy } from "./element-runs.js";
import type { RawImage } from "./panels.js";
import type { Rect } from "./types.js";

/**
 * 只认**明显是笔画**的像素:离框内背景色的距离 > 40。
 *
 * 抗锯齿边缘不能算墨,否则字与字之间的空隙会被填满、列投影分不出字形。
 * 在 `test-fixtures/maicai.png` 上量过阈值对列游程段数的影响——
 * 「登录/注册」(239×51 @ 269,236) 在阈值 4 和 8 时塌成 **1 段**,
 * 12 起稳定在 **5 段**,一直到 100 都不变;
 * 「联系客服」(142×34 @ 74,1290) 笔画重,4 到 100 全程都是 5 段。
 * 取 40 落在稳定区中段,离塌陷点 8 有 3.3 倍余量,离上界很远。
 *
 * 与前端 `DetailNode.vue` 量墨迹用的 `STROKE_THRESHOLD` 两处算法一致
 * (都是离框内众数背景色的距离),阈值必须同步改。
 */
export const TEXT_INK_THRESHOLD = 40;

/**
 * 框内出现次数最多的颜色当背景。手机 UI 里白字深底极常见（主按钮、徽章、
 * 深色头部），量"离白色的距离"会把这些框系统性判成没有墨迹；量"离框内
 * 众数色的距离"对白底黑字和深底白字一样准。
 *
 * 每个 rect 只统计一次——调用方（`checkTextBox`）算好一次背景色后
 * 传给 `inkRows`/`inkCols` 共用，不重复扫像素。
 */
function rectBackground(raw: RawImage, rect: Rect): readonly [number, number, number] {
  const counts = new Map<number, number>();
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const i = ((rect.y + y) * raw.width + (rect.x + x)) * raw.channels;
      const key = (raw.data[i]! << 16) | (raw.data[i + 1]! << 8) | raw.data[i + 2]!;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let bestKey = 0xffffff;
  let best = -1;
  for (const [key, count] of counts) if (count > best) { best = count; bestKey = key; }
  return [(bestKey >> 16) & 0xff, (bestKey >> 8) & 0xff, bestKey & 0xff];
}

function isInk(raw: RawImage, x: number, y: number, bg: readonly [number, number, number]): boolean {
  const i = (y * raw.width + x) * raw.channels;
  const away = Math.max(
    Math.abs(raw.data[i]! - bg[0]),
    Math.abs(raw.data[i + 1]! - bg[1]),
    Math.abs(raw.data[i + 2]! - bg[2]),
  );
  return away > TEXT_INK_THRESHOLD;
}

/** 逐行是否有墨，下标原点是 rect 左上角 */
export function inkRows(raw: RawImage, rect: Rect, bg = rectBackground(raw, rect)): boolean[] {
  const rows = new Array<boolean>(Math.max(0, rect.h)).fill(false);
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      if (isInk(raw, rect.x + x, rect.y + y, bg)) { rows[y] = true; break; }
    }
  }
  return rows;
}

/** 逐列是否有墨，下标原点是 rect 左上角 */
export function inkCols(raw: RawImage, rect: Rect, bg = rectBackground(raw, rect)): boolean[] {
  const cols = new Array<boolean>(Math.max(0, rect.w)).fill(false);
  for (let x = 0; x < rect.w; x++) {
    for (let y = 0; y < rect.h; y++) {
      if (isInk(raw, rect.x + x, rect.y + y, bg)) { cols[x] = true; break; }
    }
  }
  return cols;
}

/**
 * 列游程的段宽中位数最多是墨高的多少倍。
 *
 * 字与字之间必然有空隙，所以一行文字的列投影一定分得开、每段大致是一个字形宽。
 * 分不开、或者每段宽得离谱，说明框里的东西不是字。实测——
 * 联系客服 32/34 = 0.94、登录/注册 49/51 = 0.96 通过；
 * 猜你喜欢的框列投影只有 1 段、216/90 = 2.40 拒绝。
 * 取 1.4 落在两者之间，两侧各留约 1.46 倍与 0.58 倍余量。
 *
 * **只卡上界。** 西文字形本来就窄（`l`、`i` 的段宽远小于墨高），卡下界会把
 * 正常的西文文字全部误判。要拒绝的是"宽得不像字形"的东西。
 */
export const MAX_GLYPH_ASPECT = 1.4;

export interface TextBoxCheck {
  /** 这个框能不能用来拟合字号 */
  ok: boolean;
  /** 行投影的墨迹段数。单行文字应当是 1 */
  bands: number;
  /** 列游程段宽中位数 / 墨高 */
  glyphAspect: number;
  /** 拒绝原因：`no-ink` 是框里没有墨迹、`multi-band` 是不止一行、`wide-glyph` 是内容不像字形 */
  reason?: "no-ink" | "multi-band" | "wide-glyph";
}

/**
 * 判断一个框是不是真的只圈住了一行文字。
 *
 * 不通过的框**不要在上面拟合字号**——实测「猜你喜欢」那种框会算出 96px。
 * 这里只做判断不做修正:框错了该由人来改,自动挪框会把错误藏起来。
 */
export function checkTextBox(raw: RawImage, rect: Rect): TextBoxCheck {
  const bg = rectBackground(raw, rect);
  const bandRuns = runsFromOccupancy(inkRows(raw, rect, bg));
  const colRuns = runsFromOccupancy(inkCols(raw, rect, bg));
  const bands = bandRuns.length;

  if (bands === 0) {
    return { ok: false, bands, glyphAspect: 0, reason: "no-ink" };
  }

  // 墨高取行投影的实际跨度，不取框高——框可能比内容大
  const inkHeight = bandRuns[bandRuns.length - 1]!.end - bandRuns[0]!.start;
  const widths = colRuns.map(run => run.end - run.start);
  // 落盘前四舍五入到两位小数，避免 0.38372093023255816 这种 JSON 噪音
  const glyphAspect = inkHeight > 0 ? Math.round((medianOf(widths) / inkHeight) * 100) / 100 : 0;

  if (bands > 1) return { ok: false, bands, glyphAspect, reason: "multi-band" };
  if (glyphAspect > MAX_GLYPH_ASPECT) {
    return { ok: false, bands, glyphAspect, reason: "wide-glyph" };
  }
  return { ok: true, bands, glyphAspect };
}
