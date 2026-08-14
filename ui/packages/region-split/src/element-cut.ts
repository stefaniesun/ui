import { uniformity, type Rgb } from "./element-pixels.js";
import {
  medianOf, mergeByGap, repairMissedMerge, runsFromOccupancy, type Run,
} from "./element-runs.js";
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
/**
 * 间隙占子块尺寸的比例低于它，就认为这一层是**一整行文字**而不是并列的元素，
 * 不再切分。
 *
 * 双峰判据只在间隙真有两个峰时才合并；一行文字的字距是均匀的，因此不会被合并，
 * 会被逐字切成子节点——实测「猜你喜欢」这个 216×90 的胶囊被切成 4 个 34×90 的块。
 *
 * 判别量取"间隙 / 子块尺寸"而不是间隙绝对值：字距占字宽的比例天然远小于
 * UI 元素间距占元素宽的比例，这是排版事实不是拟合。
 *
 * 实测两侧——
 *   文字：猜你喜欢 2/34 = 0.06；企业采购 4.5/26 = 0.173（这行字距偏宽）
 *   元素：关注领券两列 55/135 = 0.41、两行 19/37 = 0.51；
 *         常用服务五格 98/140 = 0.70；订单入口五列 101/105 = 0.96
 * 取 0.25 落在 0.173 与 0.41 之间，两侧各留约 1.5 倍与 1.6 倍余量。
 */
const TEXT_RUN_GAP_RATIO = 0.25;

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
 * 这批游程看起来是一整行文字（字距远小于字宽），而不是并列的元素。
 *
 * 只有两段时一律不判为文字：实测「账户顶部」整区横切成 `[头像+登录注册 678, 图标组 295]`
 * 两段、比值 0.208，「关注领券」卡切成 `[文案 182, 图标 89]`、比值 0.406——
 * 都是极常见的左右布局，误判会让整个区域一个节点都出不来。
 * 而一行文字很少只有两个游程（合并后更少）。
 */
export function looksLikeTextRun(runs: Run[]): boolean {
  if (runs.length < 3) return false;
  const gaps = runs.slice(1).map((run, i) => run.start - runs[i]!.end);
  const sizes = runs.map(run => run.end - run.start);
  const size = medianOf(sizes);
  if (size <= 0) return false;
  return medianOf(gaps) < size * TEXT_RUN_GAP_RATIO;
}

/**
 * 沿**交叉轴**把子块收紧到真实内容范围。
 *
 * 横切出来的子块在交叉轴上继承父块的完整高度，这是 X-Y cut 的固有形态。原本指望
 * 下一层的纵切去收紧，但**叶子没有下一层**——实测账户顶部的头像和「登录/注册」
 * 都停在 338（整个区域高），真实内容只有 140 上下，位置尺寸和上下内边距全是错的。
 *
 * 所以切完就地收紧，不等下一层。只会缩小不会放大，兄弟不重叠的保证不受影响。
 */
function tightenToContent(
  raw: RawImage, box: Rect, direction: Direction, fill: Rgb,
): Rect {
  // 交叉轴两端要避开父块的边框与圆角；主轴方向上子块边界就是内容边界，不必内缩
  const x0 = box.x + (direction === "column" ? CUT_INSET : 0);
  const x1 = box.x + box.w - (direction === "column" ? CUT_INSET : 0);
  const y0 = box.y + (direction === "row" ? CUT_INSET : 0);
  const y1 = box.y + box.h - (direction === "row" ? CUT_INSET : 0);
  if (x1 <= x0 || y1 <= y0) return box;

  let min = Infinity;
  let max = -Infinity;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * raw.width + x) * raw.channels;
      const distance = Math.max(
        Math.abs(raw.data[i]! - fill[0]),
        Math.abs(raw.data[i + 1]! - fill[1]),
        Math.abs(raw.data[i + 2]! - fill[2]),
      );
      if (distance <= CUT_THRESHOLD) continue;
      const along = direction === "row" ? y : x;
      if (along < min) min = along;
      if (along > max) max = along;
    }
  }
  if (min > max) return box;                       // 全是底色，保持原样
  return direction === "row"
    ? { ...box, y: min, h: max - min + 1 }
    : { ...box, x: min, w: max - min + 1 };
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
  if (looksLikeTextRun(runs)) return [];
  return runs
    .map(run => direction === "row"
      ? { x: rect.x + CUT_INSET + run.start, y: rect.y, w: run.end - run.start, h: rect.h }
      : { x: rect.x, y: rect.y + CUT_INSET + run.start, w: rect.w, h: run.end - run.start })
    .map(box => tightenToContent(raw, box, direction, fill));
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
