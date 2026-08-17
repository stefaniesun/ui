import type { RawImage } from "./panels.js";
import type { Rect } from "./types.js";

/**
 * 只认**明显是笔画**的像素。抗锯齿边缘不算，否则任何一行都会有"墨"，
 * 行投影就永远分不出段。40 与前端量墨迹用的 STROKE_THRESHOLD 是同一个数
 * （实测阈值低于它时，小字的边缘像素占比很高，会把间隙填满）。
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
