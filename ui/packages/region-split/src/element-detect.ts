import {
  MAX_DEPTH, MIN_CHILD_SIZE, cutChildren, measureLayout, type Direction,
} from "./element-cut.js";
import { detectRepeat, detectScroll } from "./element-grid.js";
import {
  FLAT_UNIFORMITY_MIN, IMAGE_UNIFORMITY_MAX,
  connectedBoxes, regionBackground, toHex, uniformity,
} from "./element-pixels.js";
import { regionKey, type ElementNode, type ElementTree } from "./element-types.js";
import type { RawImage } from "./panels.js";
import type { Rect } from "./types.js";

// 像素基元由 element-pixels 提供，这里一并转出，调用方不必关心拆分细节。
export * from "./element-pixels.js";

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

/** 按矩形建一个节点，类型由内部主色占比决定 */
function makeNode(
  raw: RawImage, box: Rect, id: string, parentId: string | null,
): ElementNode {
  const { fill, ratio } = uniformity(raw, box);
  return {
    id, parentId, box,
    kind: ratio <= IMAGE_UNIFORMITY_MAX ? "image" : "component",
    displayName: `节点 ${id.slice(1)}`,
    style: ratio >= FLAT_UNIFORMITY_MIN ? { background: toHex(fill) } : {},
    uniformity: ratio,
    source: "auto",
    classification: "tool",
    scrollX: false,
    scrollY: false,
    positioning: "flow",
  };
}

/**
 * 往容器内部递归切分。横切一层就是 flex-direction: row，纵切就是 column——
 * 方向是切分算法的副产品，不是二次推断；下一层换方向，即经典的 X-Y cut。
 */
function expand(
  raw: RawImage, parent: ElementNode, depth: number, direction: Direction,
  nodes: ElementNode[], nextId: () => string,
): void {
  if (parent.kind === "image") return;                  // 位图是叶子，不再往里切
  if (depth >= MAX_DEPTH) return;
  if (parent.box.w < MIN_CHILD_SIZE * 2 || parent.box.h < MIN_CHILD_SIZE * 2) return;

  const boxes = cutChildren(raw, parent.box, direction)
    .filter(box => box.w >= MIN_CHILD_SIZE && box.h >= MIN_CHILD_SIZE);
  if (boxes.length < 2) return;

  const layout = measureLayout(parent.box, boxes, direction);
  parent.layout = layout;
  // 滚动是纯几何判定：末块显著偏小且紧贴内容边缘 = 被容器切断
  const scrolls = detectScroll(
    parent.box, boxes, direction,
    direction === "row" ? layout.padding.left : layout.padding.top,
  );
  if (direction === "row") parent.scrollX = scrolls;
  else parent.scrollY = scrolls;

  const children = boxes.map(box => makeNode(raw, box, nextId(), parent.id));
  nodes.push(...children);

  // 等距同构的层是一次循环渲染，不是 N 段复制粘贴的标签
  const repeat = detectRepeat(boxes, direction);
  const template = repeat ? children[repeat.templateIndex] : undefined;
  if (repeat && template) {
    parent.kind = "grid";
    parent.repeat = { count: repeat.count, templateId: template.id, pitch: repeat.pitch };
  }

  const next: Direction = direction === "row" ? "column" : "row";
  for (const child of children) expand(raw, child, depth + 1, next, nodes, nextId);
}

/**
 * 先用连通块找出顶层容器，再往每个容器内部递归切分。
 *
 * 顶层一律先横切：移动端页面的顶层容器几乎总是竖直堆叠的卡片，卡片内部才是横排。
 * 切不动会返回空，下一层自然去切行。
 */
export function detectElementTree(raw: RawImage, region: Rect, now: string): ElementTree {
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

  let counter = 0;
  const nextId = () => `n${++counter}`;
  const nodes: ElementNode[] = kept.map((item, index) => {
    const parent = parentIndexOf(boxes, index);
    return makeNode(raw, item.box, nextId(), parent < 0 ? null : `n${parent + 1}`);
  });

  // 顶层节点已经全部建好（id 与下标一一对应），再逐个展开内部
  for (const top of [...nodes]) expand(raw, top, 1, "row", nodes, nextId);

  return { regionKey: regionKey(region), detectedAt: now, nodes };
}
