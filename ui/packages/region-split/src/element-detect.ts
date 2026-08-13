import { regionKey, type ElementNode, type ElementTree } from "./element-types.js";
import type { RawImage } from "./panels.js";
import type { Rect } from "./types.js";

export type Rgb = [number, number, number];

/** 页边距取样宽度。实测左右各 6px 的中位色即页面底色 rgb(245,245,245)。 */
const MARGIN_WIDTH = 6;
/** 与底色的最大通道差超过它就算内容。实测能把白卡片从浅灰底上分出来。 */
export const CONTENT_THRESHOLD = 8;
/** uniformity 的内缩量，避开容器自身的边框和圆角抗锯齿。 */
const UNIFORM_INSET = 4;
/** 小于这个尺寸的连通块是噪声。 */
const MIN_BOX_WIDTH = 80;
const MIN_BOX_HEIGHT = 24;
/** 内部主色占比低于它就是整块位图。实测采购横幅 0.02。 */
export const IMAGE_UNIFORMITY_MAX = 0.1;
/** 高于它就是扁平底色容器，记下 background。实测白卡片下限 0.83。 */
export const FLAT_UNIFORMITY_MIN = 0.8;

export function toHex(color: Rgb): string {
  return `#${color.map(v => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

function medianOfChannel(values: Uint8Array, count: number): number {
  return values.slice(0, count).sort()[Math.floor(count / 2)]!;
}

/**
 * 收集矩形内像素的三通道，返回中位色与"与中位色一致"的像素占比。
 * 用 TypedArray 而不是元组数组：整块区域可能有数百万像素，
 * 每像素分配一个数组会把内存打爆。
 */
function sampleFill(
  raw: RawImage, x0: number, x1: number, y0: number, y1: number,
): { fill: Rgb; ratio: number } {
  const count = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  if (count === 0) return { fill: [0, 0, 0], ratio: 0 };
  const channels = [new Uint8Array(count), new Uint8Array(count), new Uint8Array(count)];
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * raw.width + x) * raw.channels;
      channels[0]![n] = raw.data[i]!;
      channels[1]![n] = raw.data[i + 1]!;
      channels[2]![n] = raw.data[i + 2]!;
      n++;
    }
  }
  const fill = channels.map(channel => medianOfChannel(channel, count)) as Rgb;
  let same = 0;
  for (let k = 0; k < count; k++) {
    const distance = Math.max(
      Math.abs(channels[0]![k]! - fill[0]),
      Math.abs(channels[1]![k]! - fill[1]),
      Math.abs(channels[2]![k]! - fill[2]),
    );
    if (distance <= CONTENT_THRESHOLD) same++;
  }
  return { fill, ratio: same / count };
}

/** 区域左右页边距的代表色 */
export function regionBackground(raw: RawImage, rect: Rect): Rgb {
  const span = Math.min(MARGIN_WIDTH, Math.max(1, Math.floor(rect.w / 4)));
  const count = span * 2 * rect.h;
  const channels = [new Uint8Array(count), new Uint8Array(count), new Uint8Array(count)];
  let n = 0;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let d = 0; d < span; d++) {
      for (const x of [rect.x + d, rect.x + rect.w - 1 - d]) {
        const i = (y * raw.width + x) * raw.channels;
        channels[0]![n] = raw.data[i]!;
        channels[1]![n] = raw.data[i + 1]!;
        channels[2]![n] = raw.data[i + 2]!;
        n++;
      }
    }
  }
  return channels.map(channel => medianOfChannel(channel, n)) as Rgb;
}

/**
 * 内部主色与其占比。这是区分"扁平容器"和"整块位图"的判别量：
 * 实测白卡片 0.83–0.96，采购横幅 0.02，混合内容约 0.64。
 */
export function uniformity(
  raw: RawImage, rect: Rect, inset = UNIFORM_INSET,
): { fill: Rgb; ratio: number } {
  return sampleFill(
    raw,
    rect.x + inset, rect.x + rect.w - inset,
    rect.y + inset, rect.y + rect.h - inset,
  );
}

/** 与底色不同的像素的四连通块外接矩形，按从上到下、从左到右排序 */
export function connectedBoxes(raw: RawImage, rect: Rect, background: Rgb): Rect[] {
  const { w, h } = rect;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((rect.y + y) * raw.width + (rect.x + x)) * raw.channels;
      const distance = Math.max(
        Math.abs(raw.data[i]! - background[0]),
        Math.abs(raw.data[i + 1]! - background[1]),
        Math.abs(raw.data[i + 2]! - background[2]),
      );
      if (distance > CONTENT_THRESHOLD) mask[y * w + x] = 1;
    }
  }

  const seen = new Uint8Array(w * h);
  const boxes: Rect[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0 || seen[start] === 1) continue;
    let minX = w, maxX = -1, minY = h, maxY = -1;
    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const index = stack.pop()!;
      const x = index % w;
      const y = (index - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const neighbours = [
        x > 0 ? index - 1 : -1,
        x < w - 1 ? index + 1 : -1,
        y > 0 ? index - w : -1,
        y < h - 1 ? index + w : -1,
      ];
      for (const next of neighbours) {
        if (next >= 0 && mask[next] === 1 && seen[next] === 0) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    const box: Rect = {
      x: rect.x + minX, y: rect.y + minY, w: maxX - minX + 1, h: maxY - minY + 1,
    };
    if (box.w >= MIN_BOX_WIDTH && box.h >= MIN_BOX_HEIGHT) boxes.push(box);
  }
  return boxes.sort((a, b) => a.y - b.y || a.x - b.x);
}

const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y
  && inner.x + inner.w <= outer.x + outer.w
  && inner.y + inner.h <= outer.y + outer.h;

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x, y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/**
 * 连通块的外接矩形之间会出现两种关系，都必须处理掉，否则兄弟重叠会撞上不变量：
 *
 * - **部分重叠**（既不包含也不被包含）：两个块在视觉上交织在一起，是同一个元素
 *   被抗锯齿或细缝切开的。合并成并集。实测头像圆就被切成了 (54,177,168×140)
 *   和 (79,289,118×29) 两块，后者只差 1px 没被前者完全包含。
 * - **包含**：这是真实的层级，交给 nestByContainment 变成父子。
 */
function mergePartialOverlaps(boxes: Rect[]): Rect[] {
  const out = [...boxes];
  for (let merged = true; merged; ) {
    merged = false;
    search: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!, b = out[j]!;
        if (!overlaps(a, b) || contains(a, b) || contains(b, a)) continue;
        out[i] = union(a, b);
        out.splice(j, 1);
        merged = true;
        break search;
      }
    }
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** 被完整包含的块成为包含它的**最小**那个块的子节点 */
function parentIndexOf(boxes: Rect[], index: number): number {
  let best = -1;
  for (let i = 0; i < boxes.length; i++) {
    if (i === index || !contains(boxes[i]!, boxes[index]!)) continue;
    // 面积相同（互相包含）时保留先出现的那个当父，避免互指成环
    if (contains(boxes[index]!, boxes[i]!) && i > index) continue;
    if (best < 0 || boxes[i]!.w * boxes[i]!.h < boxes[best]!.w * boxes[best]!.h) best = i;
  }
  return best;
}

/**
 * 阶段一只产出顶层容器。多数情况下是一棵扁平的树，但当一个块被另一个完整包含时
 * 会自然产生一层父子——那是真实的层级，不该丢掉。递归切分留到阶段二。
 */
export function detectTopLevel(raw: RawImage, region: Rect, now: string): ElementTree {
  const background = regionBackground(raw, region);
  const merged = mergePartialOverlaps(connectedBoxes(raw, region, background));
  const measured = merged.map(box => ({ box, ...uniformity(raw, box) }));

  // 落在位图内部的块是这张图的一部分，不该单独成节点——
  // image 是叶子类型，给它挂子节点会直接撞上 leaf-with-children。
  const kept = measured.filter((item, index) => {
    const parent = parentIndexOf(merged, index);
    return parent < 0 || measured[parent]!.ratio > IMAGE_UNIFORMITY_MAX;
  });
  const boxes = kept.map(item => item.box);

  const nodes: ElementNode[] = kept.map((item, index) => {
    const parent = parentIndexOf(boxes, index);
    return {
      id: `n${index + 1}`,
      parentId: parent < 0 ? null : `n${parent + 1}`,
      box: item.box,
      kind: item.ratio <= IMAGE_UNIFORMITY_MAX ? "image" : "component",
      displayName: `节点 ${index + 1}`,
      style: item.ratio >= FLAT_UNIFORMITY_MIN ? { background: toHex(item.fill) } : {},
      uniformity: item.ratio,
      source: "auto",
      classification: "tool",
      scrollX: false,
      scrollY: false,
      positioning: "flow",
    };
  });
  return { regionKey: regionKey(region), detectedAt: now, nodes };
}
