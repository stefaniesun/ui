import {
  MAX_DEPTH, MIN_CHILD_SIZE, cutChildren, measureLayout, type Direction,
} from "./element-cut.js";
import { detectRepeat, detectScroll } from "./element-grid.js";
import {
  CONTENT_THRESHOLD, FLAT_UNIFORMITY_MIN, IMAGE_UNIFORMITY_MAX,
  connectedBoxes, measureBorderRadius, measureInkColor,
  regionBackground, toHex, uniformity, type Rgb,
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

/**
 * 内容没被任何顶层框盖住的比例超过它，就说明这个区域根本没有可见容器——
 * 元素直接摆在页面底色上，各自的连通块又小于顶层最小尺寸，被当噪声滤掉了。
 * 这时改为把**区域自己当容器**切分。
 *
 * 实测九个区域的分布没有中间值：账户顶部 53.5%、底部导航 52.8% 需要回退；
 * 商品推荐分类 6.1%，其余七个 ≤ 0.1%。25% 落在 6.1% 与 52.8% 之间，
 * 两侧各留约一倍余量。
 */
const REGION_FALLBACK_RATIO = 0.25;

/** 区域内的内容像素有多大比例落在所有框之外 */
export function uncoveredContentRatio(
  raw: RawImage, region: Rect, background: Rgb, boxes: Rect[],
): number {
  let content = 0;
  let uncovered = 0;
  for (let y = region.y; y < region.y + region.h; y++) {
    for (let x = region.x; x < region.x + region.w; x++) {
      const i = (y * raw.width + x) * raw.channels;
      const distance = Math.max(
        Math.abs(raw.data[i]! - background[0]),
        Math.abs(raw.data[i + 1]! - background[1]),
        Math.abs(raw.data[i + 2]! - background[2]),
      );
      if (distance <= CONTENT_THRESHOLD) continue;
      content++;
      if (!boxes.some(box =>
        x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h)) uncovered++;
    }
  }
  return content === 0 ? 0 : uncovered / content;
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
 * 按矩形建一个节点，类型由内部主色占比决定。
 * `outside` 是这个框**外面**的颜色，量圆角要用它——角上被啃掉的那部分
 * 露出来的就是外部色。
 */
function makeNode(
  raw: RawImage, box: Rect, id: string, parentId: string | null, outside: Rgb,
): ElementNode {
  const { fill, ratio } = uniformity(raw, box);
  const radius = measureBorderRadius(raw, box, outside);
  // 墨色对每个框都测得出来，但只对文字/图标/装饰有意义。检测阶段还不知道
  // 类型（那是模型定的），所以先一律测下来，界面按类型决定显不显示。
  const ink = measureInkColor(raw, box);
  return {
    id, parentId, box,
    kind: ratio <= IMAGE_UNIFORMITY_MAX ? "image" : "component",
    displayName: `节点 ${id.slice(1)}`,
    style: {
      ...(ratio >= FLAT_UNIFORMITY_MIN ? { background: toHex(fill) } : {}),
      ...(radius > 0 ? { borderRadius: radius } : {}),
      ...(ink ? { color: ink } : {}),
    },
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

  // 两个方向都试，不搞严格交替。
  //
  // 交替是 X-Y cut 的惯例，但它会在"子块内部沿着同一个方向继续排布"时丢结构：
  // 实测账户顶部横切成 [头像+登录注册, 图标组] 之后，前者内部仍是左右排布，
  // 纵切切不动就停住了，整个区域只剩 2 个叶子。
  //
  // 同方向再切一次不是无用功：合并阈值是**按本层最大间隙**算的，进到子块里
  // 重新算会更小，父层被并在一起的两项在这里就分得开了。
  const cut = (d: Direction) => cutChildren(raw, parent.box, d)
    .filter(box => box.w >= MIN_CHILD_SIZE && box.h >= MIN_CHILD_SIZE);
  const other: Direction = direction === "row" ? "column" : "row";
  let boxes = cut(direction);
  let used = direction;
  if (boxes.length < 2) {
    boxes = cut(other);
    used = other;
  }
  if (boxes.length < 2) return;
  direction = used;

  const layout = measureLayout(parent.box, boxes, direction);
  parent.layout = layout;
  // 滚动是纯几何判定：末块显著偏小且紧贴内容边缘 = 被容器切断
  const scrolls = detectScroll(
    parent.box, boxes, direction,
    direction === "row" ? layout.padding.left : layout.padding.top,
  );
  if (direction === "row") parent.scrollX = scrolls;
  else parent.scrollY = scrolls;

  // 子块的"外部"就是父块自己的底色
  const parentFill = uniformity(raw, parent.box).fill;
  const children = boxes.map(box => makeNode(raw, box, nextId(), parent.id, parentFill));
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
  const nodes: ElementNode[] = [];

  // 没有可见容器时（元素直接摆在页面底色上），把区域自己当容器切。
  // 否则文字和图标各自的连通块都小于顶层最小尺寸，会被整批当噪声滤掉。
  if (uncoveredContentRatio(raw, region, background, boxes) > REGION_FALLBACK_RATIO) {
    const virtual = makeNode(raw, region, "region", null, background);
    expand(raw, virtual, 0, "row", nodes, nextId);
    // 虚拟容器本身不进树——它就是区域，没有像素证据说明它是个元素。
    // 它的直接子节点提升为顶层。
    for (const node of nodes) if (node.parentId === virtual.id) node.parentId = null;
    return { regionKey: regionKey(region), detectedAt: now, nodes };
  }

  nodes.push(...kept.map((item, index) => {
    const parent = parentIndexOf(boxes, index);
    // 被包含的块，其"外部"是包住它的那个块的底色
    const outside = parent < 0 ? background : uniformity(raw, boxes[parent]!).fill;
    return makeNode(raw, item.box, nextId(), parent < 0 ? null : `n${parent + 1}`, outside);
  }));

  // 顶层节点已经全部建好（id 与下标一一对应），再逐个展开内部
  for (const top of [...nodes]) expand(raw, top, 1, "row", nodes, nextId);

  return { regionKey: regionKey(region), detectedAt: now, nodes };
}
