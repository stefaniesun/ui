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

/** 一组矩形的并集包围盒 */
function boundsOf(boxes: Rect[]): Rect | null {
  if (boxes.length === 0) return null;
  const x = Math.min(...boxes.map(b => b.x));
  const y = Math.min(...boxes.map(b => b.y));
  return {
    x, y,
    w: Math.max(...boxes.map(b => b.x + b.w)) - x,
    h: Math.max(...boxes.map(b => b.y + b.h)) - y,
  };
}

/** 元素框的最小边长，太小就没法选中也没法看 */
export const MIN_BOX_SIZE = 4;

/**
 * 把人工改动过的框钳制到合法范围，改不动就返回 null。
 *
 * 测量会出错，所以人工必须能调；但调完仍要满足写盘时的那几条不变量，
 * 否则只会换来一个 422。三条约束按"改不动就别改"处理，不做部分妥协：
 *
 * - 不能越出父节点（根节点不能越出区域）
 * - 不能小到装不下自己的子节点
 * - 不能与同层的兄弟重叠
 */
export function clampBox(
  nodes: ElementNode[], region: Rect, id: string, next: Rect,
): Rect | null {
  const node = nodes.find(item => item.id === id);
  if (!node) return null;

  const box: Rect = {
    x: Math.round(next.x), y: Math.round(next.y),
    w: Math.max(MIN_BOX_SIZE, Math.round(next.w)),
    h: Math.max(MIN_BOX_SIZE, Math.round(next.h)),
  };

  // ① 收进父节点（根节点收进区域）
  const parent = node.parentId === null
    ? region
    : nodes.find(item => item.id === node.parentId)?.box;
  if (!parent) return null;
  box.w = Math.min(box.w, parent.w);
  box.h = Math.min(box.h, parent.h);
  box.x = Math.min(Math.max(box.x, parent.x), parent.x + parent.w - box.w);
  box.y = Math.min(Math.max(box.y, parent.y), parent.y + parent.h - box.h);

  // ② 必须装得下自己的子节点
  const childBounds = boundsOf(
    nodes.filter(item => item.parentId === id).map(item => item.box));
  if (childBounds && !contains(box, childBounds)) return null;

  // ③ 不能压到同层的兄弟身上（absolute 的节点本来就允许压层）
  if (node.positioning === "flow") {
    const clash = nodes.some(item =>
      item.id !== id && item.parentId === node.parentId
      && item.positioning === "flow" && overlaps(item.box, box));
    if (clash) return null;
  }
  return box;
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
