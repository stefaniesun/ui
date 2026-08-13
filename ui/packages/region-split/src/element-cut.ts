import { uniformity, type Rgb } from "./element-detect.js";
import { medianOf, mergeByGap, repairMissedMerge, runsFromOccupancy } from "./element-runs.js";
import type { RawImage } from "./panels.js";
import type { Rect } from "./types.js";

export type Direction = "row" | "column";

/**
 * 递归深度上限。刻意保守：不可见容器在图上不留痕迹，树在数学上是多解的，
 * 工具只输出有像素证据的层级，缺的层留给人工补。实测标题+副标题这类
 * 真实结构在深度 3 内即可完整表达。
 */
export const MAX_DEPTH = 4;
/** 小于这个尺寸的子块不再往下切 */
export const MIN_CHILD_SIZE = 16;
/** 切分内缩量，避开容器自身的边框与圆角 */
export const CUT_INSET = 6;
/** 与本层底色的差异阈值。比顶层的 8 略高，因为容器内部有阴影和抗锯齿。 */
const CUT_THRESHOLD = 10;
/** 列游程最短长度，滤掉单列噪声 */
const MIN_COLUMN_RUN = 4;

export interface LayoutInfo {
  direction: Direction;
  gap: number;
  padding: { top: number; right: number; bottom: number; left: number };
}

/** 内缩后逐行、逐列是否有内容。返回数组的下标原点是 rect 内缩之后的左上角。 */
export function occupancy(
  raw: RawImage, rect: Rect, fill: Rgb, inset = CUT_INSET,
): { rows: boolean[]; cols: boolean[] } {
  const x0 = rect.x + inset, x1 = rect.x + rect.w - inset;
  const y0 = rect.y + inset, y1 = rect.y + rect.h - inset;
  const rows = new Array<boolean>(Math.max(0, y1 - y0)).fill(false);
  const cols = new Array<boolean>(Math.max(0, x1 - x0)).fill(false);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * raw.width + x) * raw.channels;
      const distance = Math.max(
        Math.abs(raw.data[i]! - fill[0]),
        Math.abs(raw.data[i + 1]! - fill[1]),
        Math.abs(raw.data[i + 2]! - fill[2]),
      );
      if (distance > CUT_THRESHOLD) {
        rows[y - y0] = true;
        cols[x - x0] = true;
      }
    }
  }
  return { rows, cols };
}

/**
 * 沿指定方向把容器切成子块。
 *
 * 子块在**交叉轴上继承父块的完整范围**——横切出来的列高度等于父高。这是 X-Y cut
 * 的固有形态，交叉轴的边界由下一层反方向的切分负责收紧。好处是兄弟之间天然不重叠，
 * 不会重蹈阶段一顶层检测踩过的 sibling-overlap。
 */
export function cutChildren(raw: RawImage, rect: Rect, direction: Direction): Rect[] {
  const { fill } = uniformity(raw, rect);
  const { rows, cols } = occupancy(raw, rect, fill);
  const rawRuns = direction === "row"
    ? runsFromOccupancy(cols, MIN_COLUMN_RUN)
    : runsFromOccupancy(rows, 1);
  // 单元间隙偏小时自适应阈值会把相邻两项并成一段；修复必须在这一层做，
  // 因为只有这里还握着合并前的原始游程——边界得从真实空白里量出来，不能猜。
  const merged = mergeByGap(rawRuns);
  const runs = repairMissedMerge(merged, rawRuns) ?? merged;
  if (runs.length < 2) return [];
  return runs.map(run => direction === "row"
    ? { x: rect.x + CUT_INSET + run.start, y: rect.y, w: run.end - run.start, h: rect.h }
    : { x: rect.x, y: rect.y + CUT_INSET + run.start, w: rect.w, h: run.end - run.start });
}

/**
 * 布局量是切分的**副产品**，不是二次分析：切的方向就是 flex-direction，
 * 子块之间的间隙就是 gap，内容到父边的距离就是 padding。
 * 光有树生成不出 HTML——不知道孩子横排还是竖排、间距多少。
 */
export function measureLayout(rect: Rect, children: Rect[], direction: Direction): LayoutInfo {
  const empty = { top: 0, right: 0, bottom: 0, left: 0 };
  if (children.length === 0) return { direction, gap: 0, padding: empty };

  const sorted = [...children].sort((a, b) =>
    direction === "row" ? a.x - b.x : a.y - b.y);
  const gaps = sorted.slice(1).map((child, i) => direction === "row"
    ? child.x - (sorted[i]!.x + sorted[i]!.w)
    : child.y - (sorted[i]!.y + sorted[i]!.h));

  const left = Math.min(...children.map(child => child.x)) - rect.x;
  const top = Math.min(...children.map(child => child.y)) - rect.y;
  const right = rect.x + rect.w - Math.max(...children.map(child => child.x + child.w));
  const bottom = rect.y + rect.h - Math.max(...children.map(child => child.y + child.h));

  return {
    direction,
    gap: Math.max(0, Math.round(medianOf(gaps))),
    padding: {
      top: Math.max(0, top), right: Math.max(0, right),
      bottom: Math.max(0, bottom), left: Math.max(0, left),
    },
  };
}
