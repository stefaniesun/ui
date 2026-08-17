import type { RawImage } from "./panels.js";
import type { Rect } from "./types.js";

/**
 * 只认**明显是笔画**的像素:`max(R,G,B) < 255 - 40`。
 *
 * 抗锯齿边缘不能算墨,否则字与字之间的空隙会被填满、列投影分不出字形。
 * 在 `test-fixtures/maicai.png` 上量过阈值对列游程段数的影响——
 * 「登录/注册」(239×51 @ 269,236) 在阈值 4 和 8 时塌成 **1 段**,
 * 12 起稳定在 **5 段**,一直到 100 都不变;
 * 「联系客服」(142×34 @ 74,1290) 笔画重,4 到 100 全程都是 5 段。
 * 取 40 落在稳定区中段,离塌陷点 8 有 3.3 倍余量,离上界很远。
 *
 * 与前端 `DetailNode.vue` 量墨迹用的 `STROKE_THRESHOLD` 是同一个数值,
 * 但那边算的是"离局部背景色的距离",不是同一套算法,只是阈值巧合一致。
 */
export const TEXT_INK_THRESHOLD = 40;

function isInk(raw: RawImage, x: number, y: number): boolean {
  const i = (y * raw.width + x) * raw.channels;
  return Math.max(raw.data[i]!, raw.data[i + 1]!, raw.data[i + 2]!) < 255 - TEXT_INK_THRESHOLD;
}

/** 逐行是否有墨，下标原点是 rect 左上角 */
export function inkRows(raw: RawImage, rect: Rect): boolean[] {
  const rows = new Array<boolean>(Math.max(0, rect.h)).fill(false);
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      if (isInk(raw, rect.x + x, rect.y + y)) { rows[y] = true; break; }
    }
  }
  return rows;
}

/** 逐列是否有墨，下标原点是 rect 左上角 */
export function inkCols(raw: RawImage, rect: Rect): boolean[] {
  const cols = new Array<boolean>(Math.max(0, rect.w)).fill(false);
  for (let x = 0; x < rect.w; x++) {
    for (let y = 0; y < rect.h; y++) {
      if (isInk(raw, rect.x + x, rect.y + y)) { cols[x] = true; break; }
    }
  }
  return cols;
}
