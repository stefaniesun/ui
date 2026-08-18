import type { Direction } from "./element-cut.js";
import { PITCH_TOLERANCE, medianOf } from "./element-runs.js";
import type { Rect } from "./types.js";

export { PITCH_TOLERANCE };
/**
 * 末块被判为"截断"所需的尺寸落差。实测分类胶囊末块 138 对其余中位 216
 * （138 < 162 成立）；卡券资产末块 105 对其余中位 122.5（105 < 91.9 不成立）。
 */
const CLIPPED_SIZE_RATIO = 0.75;
/** 末块末端与"内容边缘"的贴合容差 */
const FLUSH_TOLERANCE = 10;

const startOf = (box: Rect, direction: Direction) => direction === "row" ? box.x : box.y;
const sizeOf = (box: Rect, direction: Direction) => direction === "row" ? box.w : box.h;

export function centersOf(boxes: Rect[], direction: Direction): number[] {
  return boxes.map(box => startOf(box, direction) + sizeOf(box, direction) / 2);
}

export function pitchesOf(centers: number[]): number[] {
  return centers.slice(1).map((center, i) => center - centers[i]!);
}

export interface RepeatInfo {
  count: number;
  templateIndex: number;
  pitch: number;
  /** 槽位尺寸。子块的墨迹居中放进去，不拉伸。 */
  slot: { w: number; h: number };
}

/**
 * 等距同构的层就是一次循环渲染，不是 N 段复制粘贴的标签。
 * 实测两张不同卡片测出同一个 220px 的列心间距——那是页面的栅格系统。
 */
export function detectRepeat(boxes: Rect[], direction: Direction): RepeatInfo | null {
  if (boxes.length < 3) return null;
  const pitches = pitchesOf(centersOf(boxes, direction));
  const pitch = medianOf(pitches);
  if (pitch <= 0) return null;
  if (!pitches.every(value => Math.abs(value - pitch) <= PITCH_TOLERANCE)) return null;
  // 模板取最大的那个子块：被截断的子块偏小，照它生成会漏内容
  const sizes = boxes.map(box => sizeOf(box, direction));
  return {
    count: boxes.length,
    templateIndex: sizes.indexOf(Math.max(...sizes)),
    pitch,
    // 槽位取中位数而不是最大值：实测「快捷功能菜单」×5 的子高是
    // 132/134/172/129/134，那个 172 是框切错了，取最大会把整行撑高。
    // 偏离中位数太多本身就是"这一项检测错了"的信号，与字号量化里
    // 用簇内离散度当质量指标是同一个用法。
    slot: {
      w: Math.round(medianOf(boxes.map(box => box.w))),
      h: Math.round(medianOf(boxes.map(box => box.h))),
    },
  };
}

/**
 * 滚动判定，纯几何，不经过模型。
 *
 * 判据是两条同时成立：末块显著小于其余子块的中位尺寸，**并且**它紧贴内容边缘。
 * 只看尺寸会误判——卡券资产的末块只是文字短；只看贴边也会误判——正常网格的
 * 末块本来就在内容边缘附近。两条一起才是"被容器切断"。
 */
export function detectScroll(
  parent: Rect, children: Rect[], direction: Direction, padding: number,
): boolean {
  if (children.length < 3) return false;
  const sorted = [...children].sort((a, b) =>
    startOf(a, direction) - startOf(b, direction));
  const sizes = sorted.map(box => sizeOf(box, direction));
  const last = sorted[sorted.length - 1]!;
  const typical = medianOf(sizes.slice(0, -1));
  if (sizes[sizes.length - 1]! >= typical * CLIPPED_SIZE_RATIO) return false;

  const parentEnd = startOf(parent, direction) + sizeOf(parent, direction);
  const remainder = parentEnd - (startOf(last, direction) + sizeOf(last, direction));
  return Math.abs(remainder - padding) <= FLUSH_TOLERANCE;
}
