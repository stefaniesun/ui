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
