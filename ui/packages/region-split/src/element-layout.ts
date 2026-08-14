import { type Direction, type LayoutInfo, measureLayout } from "./element-cut.js";
import { detectRepeat, detectScroll } from "./element-grid.js";
import type { ElementNode } from "./element-types.js";
import type { Rect } from "./types.js";

/**
 * 从子块的排布反推主轴方向。
 *
 * 自动检测出来的容器，方向是切分算法的副产品；但**人工框选新增的容器没有经过切分**，
 * 方向只能从几何反推。判据是子块中心在两个轴上的散布——横排的子块 x 散得开、
 * y 挤在一起，竖排反之。单个子块无从判断，缺省 row。
 */
export function inferDirection(children: Rect[]): Direction {
  if (children.length < 2) return "row";
  const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
  const x = spread(children.map(box => box.x + box.w / 2));
  const y = spread(children.map(box => box.y + box.h / 2));
  return x >= y ? "row" : "column";
}

/** 两个矩形是否相交（相邻不算） */
function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w
    && inner.y + inner.h <= outer.y + outer.h;
}

/** 元素框的最小边长，太小就没法选中也没法看 */
export const MIN_BOX_SIZE = 4;

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x, y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/** 交集；不相交时返回 null */
function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/**
 * 应用一次人工改框，必要时**逐层顶开祖先**，返回整棵更新后的节点表；
 * 做不到就返回 null。
 *
 * 尺寸变化沿两个方向对称传播：**向上取并集，向下取交集**。
 *
 * - **放大**顶到父边界后继续放大：父节点扩成并集，一路往上递归。
 *   想让一个元素更大时被父框卡住、只能先去改父框，顺序是反的。
 * - **缩小**到装不下子节点：子节点收成交集，一路往下递归。
 *   只拒绝不动会和放大方向自相矛盾；取交集则只裁掉伸出去的那部分，
 *   仍然装得下的子节点原样不动，测量数据尽量少丢。
 *
 * **移动**（宽高不变）不参与传播，仍然收进父节点——挪出界基本都是手滑，
 * 顺手把父框拖大反而是破坏。
 *
 * 这几条底线不让步：
 * - 区域是硬顶，谁都不能长出区域
 * - 裁到小于最小边长就整体拒绝，不留下看不见的碎块
 * - 改动过的每一层都不能压到它自己的兄弟
 */
/** 改不动时说明原因，界面要能把它显示出来，否则看起来像失灵 */
export type ApplyBoxResult =
  | { ok: true; nodes: ElementNode[] }
  | { ok: false; reason: string };

export function applyBox(
  nodes: ElementNode[], region: Rect, id: string, next: Rect,
): ApplyBoxResult {
  const node = nodes.find(item => item.id === id);
  if (!node) return { ok: false, reason: "找不到这个元素" };

  const box: Rect = {
    x: Math.round(next.x), y: Math.round(next.y),
    w: Math.max(MIN_BOX_SIZE, Math.round(next.w)),
    h: Math.max(MIN_BOX_SIZE, Math.round(next.h)),
  };
  const grows = box.w > node.box.w || box.h > node.box.h;

  const parentOf = (item: ElementNode): ElementNode | null =>
    item.parentId === null ? null : nodes.find(x => x.id === item.parentId) ?? null;

  // 区域是硬顶
  box.w = Math.min(box.w, region.w);
  box.h = Math.min(box.h, region.h);
  box.x = Math.min(Math.max(box.x, region.x), region.x + region.w - box.w);
  box.y = Math.min(Math.max(box.y, region.y), region.y + region.h - box.h);

  if (!grows) {
    const bounds = parentOf(node)?.box ?? region;
    box.w = Math.min(box.w, bounds.w);
    box.h = Math.min(box.h, bounds.h);
    box.x = Math.min(Math.max(box.x, bounds.x), bounds.x + bounds.w - box.w);
    box.y = Math.min(Math.max(box.y, bounds.y), bounds.y + bounds.h - box.h);
  }

  const updates = new Map<string, Rect>([[id, box]]);

  // 逐层往下收：装不下的子节点裁成交集
  const trim = (parentId: string, parentBox: Rect): boolean => {
    for (const child of nodes.filter(item => item.parentId === parentId)) {
      const current = updates.get(child.id) ?? child.box;
      if (contains(parentBox, current)) continue;
      const trimmed = intersect(current, parentBox);
      if (!trimmed || trimmed.w < MIN_BOX_SIZE || trimmed.h < MIN_BOX_SIZE) return false;
      updates.set(child.id, trimmed);
      if (!trim(child.id, trimmed)) return false;
    }
    return true;
  };
  if (!trim(id, box)) {
    return { ok: false, reason: "再缩下去里面的子元素就看不见了" };
  }

  // 逐层往上顶：装不下就把祖先扩成并集，一直到区域为止
  let current: ElementNode = node;
  let currentBox = box;
  for (;;) {
    const parent = parentOf(current);
    if (!parent) break;
    const parentBox = updates.get(parent.id) ?? parent.box;
    if (contains(parentBox, currentBox)) break;
    const grown = union(parentBox, currentBox);
    if (!contains(region, grown)) {
      return { ok: false, reason: "已经顶到区域边界，再大就超出这个区域了" };
    }
    updates.set(parent.id, grown);
    current = parent;
    currentBox = grown;
  }

  // 改动过的每一层都要重新检查兄弟重叠（absolute 的本来就允许压层）
  for (const [changedId, changedBox] of updates) {
    const changed = nodes.find(item => item.id === changedId)!;
    if (changed.positioning !== "flow") continue;
    const clash = nodes.some(other =>
      other.id !== changedId && other.parentId === changed.parentId
      && other.positioning === "flow"
      && overlaps(updates.get(other.id) ?? other.box, changedBox));
    if (clash) {
      return { ok: false, reason: "会压到旁边的同级元素上；要压层请先把类型改成绝对定位" };
    }
  }

  return {
    ok: true,
    nodes: nodes.map(item =>
      updates.has(item.id) ? { ...item, box: updates.get(item.id)! } : item),
  };
}

/**
 * 按当前的父子关系重算每个容器的布局量、重复与滚动。
 *
 * 人工删除一层或框选新增一层之后，受影响容器的 layout / repeat / scroll 就过时了，
 * 而这些量全部是**纯几何**——只用得到子块的矩形，不需要像素。所以放在这里由前端
 * 直接算，人工一改立刻看到结果，不必等服务端读图。
 *
 * `scrollX` / `scrollY` 允许人工覆盖，所以只在 `preserveScroll` 里列出的节点上
 * 保留原值；其余一律按几何重算。
 */
export function recomputeLayout(
  nodes: ElementNode[], preserveScroll: ReadonlySet<string> = new Set(),
): ElementNode[] {
  const childrenOf = new Map<string, ElementNode[]>();
  for (const node of nodes) {
    if (node.parentId === null) continue;
    const list = childrenOf.get(node.parentId) ?? [];
    list.push(node);
    childrenOf.set(node.parentId, list);
  }

  return nodes.map(node => {
    const children = childrenOf.get(node.id) ?? [];
    if (children.length < 2) {
      // 不足两个子块谈不上布局；清掉过时的量，别让界面显示已经不成立的数字
      const { layout: _layout, repeat: _repeat, ...rest } = node;
      return preserveScroll.has(node.id)
        ? { ...rest }
        : { ...rest, scrollX: false, scrollY: false };
    }

    const boxes = children.map(child => child.box);
    const direction = inferDirection(boxes);
    const layout: LayoutInfo = measureLayout(node.box, boxes, direction);
    const repeat = detectRepeat(boxes, direction);
    const template = repeat ? children[repeat.templateIndex] : undefined;

    const next: ElementNode = { ...node, layout };
    if (repeat && template) {
      next.repeat = { count: repeat.count, templateId: template.id, pitch: repeat.pitch };
    } else {
      delete next.repeat;
    }

    if (!preserveScroll.has(node.id)) {
      const scrolls = detectScroll(
        node.box, boxes, direction,
        direction === "row" ? layout.padding.left : layout.padding.top,
      );
      next.scrollX = direction === "row" ? scrolls : false;
      next.scrollY = direction === "column" ? scrolls : false;
    }
    return next;
  });
}
