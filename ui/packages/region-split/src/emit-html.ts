import type { LayoutInfo } from "./element-cut.js";
import type { ElementNode, ElementTree } from "./element-types.js";
import type { Rect } from "./types.js";

export const FLEX_TOLERANCE = 2;

export interface EmitHtmlInput {
  designWidth: number;
  region: Rect;
  tree: ElementTree;
  /** 图片和图标节点对应的可移植资源地址，通常为内嵌 data URL。 */
  assetSources?: Readonly<Record<string, string>>;
}

export interface EmitHtmlResult {
  html: string;
  css: string;
}

export function toVw(px: number, designWidth: number): string {
  if (px === 0) return "0";
  const value = Number(((px / designWidth) * 100).toFixed(4));
  return `${value}vw`;
}

export function flexDeviation(parent: Rect, children: readonly Rect[], layout: LayoutInfo): number {
  const horizontal = layout.direction === "row";
  const start = (box: Rect) => horizontal ? box.x : box.y;
  const sorted = [...children].sort((a, b) => start(a) - start(b));
  let expected = horizontal ? parent.x + layout.padding.left : parent.y + layout.padding.top;
  let deviation = 0;
  for (const child of sorted) {
    deviation = Math.max(deviation, Math.abs(start(child) - expected));
    expected += (horizontal ? child.w : child.h) + layout.gap;
  }
  return deviation;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function classKey(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, (char) => `_${char.codePointAt(0)!.toString(16)}_`);
}

function declaration(name: string, value: string | undefined): string[] {
  return value === undefined ? [] : [`  ${name}: ${value};`];
}

/**
 * 按父子关系拓扑排序：父节点排在它的子节点之前再输出。
 *
 * `.e-父 > *` 规则与列表项自己的 `.e-子` 规则选择器权重相同，全靠"谁在 CSS 里
 * 写在后面谁赢"来保证绝对定位的角标最终用回自己的尺寸（见下方 repeat 的 CSS 生成）。
 * 这就要求父节点的规则必须先于子节点输出——但 `tree.nodes` 的数组顺序不可信：
 * 校验只查重叠和环，不查顺序；AI 重构把模型给的数组原样 splice 进去；PUT 路由只做
 * zod 校验也不重排。所以这里不依赖输入数组顺序，显式做一次拓扑排序。
 *
 * 同一层内维持 `byParent`已经记录的顺序（即各节点在输入数组里各自出现的先后），
 * 不打乱现有的阅读顺序。万一数据成环（不变量检查本应挡住，这里只是防御），
 * 不会死循环——没被拓扑访问到的节点原样追加在末尾。
 */
function topoSortByParent(
  nodes: readonly ElementNode[], byParent: Map<string | null, ElementNode[]>,
): ElementNode[] {
  const out: ElementNode[] = [];
  const visited = new Set<string>();
  const visit = (node: ElementNode): void => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    out.push(node);
    for (const child of byParent.get(node.id) ?? []) visit(child);
  };
  for (const root of byParent.get(null) ?? []) visit(root);
  // 兜底：孤儿节点或环上的节点，按原数组顺序追加在末尾
  for (const node of nodes) visit(node);
  return out;
}

export function emitHtml(input: EmitHtmlInput): EmitHtmlResult {
  const { designWidth, region, tree, assetSources = {} } = input;
  if (!Number.isFinite(designWidth) || designWidth <= 0) throw new Error("designWidth must be positive");
  const byParent = new Map<string | null, ElementNode[]>();
  const byId = new Map(tree.nodes.map((node) => [node.id, node]));
  for (const node of tree.nodes) byParent.set(node.parentId, [...(byParent.get(node.parentId) ?? []), node]);

  const orderedNodes = topoSortByParent(tree.nodes, byParent);

  const flexParents = new Set<string>();
  const deviations = new Map<string, number>();
  for (const parent of orderedNodes) {
    if (!parent.layout) continue;
    if (parent.repeat) {
      flexParents.add(parent.id);
      continue;
    }
    const flowChildren = (byParent.get(parent.id) ?? []).filter((child) => child.positioning !== "absolute");
    const deviation = flexDeviation(parent.box, flowChildren.map((child) => child.box), parent.layout);
    deviations.set(parent.id, deviation);
    if (deviation <= FLEX_TOLERANCE) flexParents.add(parent.id);
  }

  const renderNode = (node: ElementNode, depth: number): string => {
    const children = byParent.get(node.id) ?? [];
    const indent = "  ".repeat(depth);
    const attributes = `class="e-${classKey(node.id)}" data-element-id="${escapeHtml(node.id)}"`;
    if (node.kind === "text") return `${indent}<span ${attributes} data-todo="text">${escapeHtml(node.displayName)}</span>`;
    if (node.kind === "icon" || node.kind === "image") {
      const source = assetSources[node.id];
      if (source) {
        return `${indent}<img ${attributes} src="${escapeHtml(source)}" alt="${escapeHtml(node.displayName)}">`;
      }
      return `${indent}<div ${attributes} data-todo="asset" aria-label="${escapeHtml(node.displayName)}"></div>`;
    }
    const content = children.length
      ? `\n${children.map((child) => renderNode(child, depth + 1)).join("\n")}\n${indent}`
      : "";
    return `${indent}<div ${attributes}>${content}</div>`;
  };

  const roots = byParent.get(null) ?? [];
  const html = ["<section class=\"region\">", ...roots.map((node) => renderNode(node, 1)), "</section>"].join("\n");
  const cssBlocks: string[] = [];
  const regionLines = [".region {", "  position: relative;", `  width: ${toVw(region.w, designWidth)};`, `  height: ${toVw(region.h, designWidth)};`, ...declaration("background", tree.background), "}"];
  cssBlocks.push(regionLines.join("\n"));

  for (const node of orderedNodes) {
    const parent = node.parentId === null ? null : byId.get(node.parentId);
    const parentUsesFlex = parent ? flexParents.has(parent.id) : false;
    const inFlow = parentUsesFlex && node.positioning !== "absolute";
    const origin = parent?.box ?? region;
    const lines = [`.e-${classKey(node.id)} {`, "  box-sizing: border-box;"];
    if (!inFlow) {
      lines.push("  position: absolute;");
      lines.push(`  left: ${toVw(node.box.x - origin.x, designWidth)};`);
      lines.push(`  top: ${toVw(node.box.y - origin.y, designWidth)};`);
    }
    // 列表项的尺寸由父节点的 `> *` 一条规则统一给出。项自己再写一遍，
    // 既是重复，也会因为选择器权重相同、后写的赢，逼得 `> *` 去用 !important。
    //
    // 光看"父节点有没有 repeat"不够：AI 重构能产出有 repeat 但没有 layout 的
    // 容器，这种容器不在 flexParents 里（见上面 flexParents 的构建——没有
    // layout 直接 continue），子项走的是各自的 absolute left/top，尺寸也必须
    // 是自己的，不能假定它在吃 `> *` 的槽位。所以要求父节点确实在 flexParents
    // 里——parentUsesFlex 就是这个语义，跟上面判断 inFlow 用的是同一个量。
    const inRepeat = parentUsesFlex
      && parent?.repeat !== undefined
      && node.positioning !== "absolute";
    if (!inRepeat) {
      lines.push(`  width: ${toVw(node.box.w, designWidth)};`);
      lines.push(`  height: ${toVw(node.box.h, designWidth)};`);
    }
    lines.push(...declaration("background", node.style.background));
    lines.push(...declaration("color", node.style.color));
    if ((node.kind === "image" || node.kind === "icon") && assetSources[node.id]) {
      lines.push("  display: block;");
      lines.push("  object-fit: contain;");
    }
    if (node.style.borderRadius !== undefined) lines.push(`  border-radius: ${toVw(node.style.borderRadius, designWidth)};`);
    if (node.style.fontSize !== undefined) lines.push(`  font-size: ${toVw(node.style.fontSize, designWidth)};`);
    if (node.style.fontWeight !== undefined) lines.push(`  font-weight: ${node.style.fontWeight};`);
    if (node.scrollX || node.scrollY) {
      lines.push(`  overflow-x: ${node.scrollX ? "auto" : "hidden"};`);
      lines.push(`  overflow-y: ${node.scrollY ? "auto" : "hidden"};`);
    }
    if (node.repeat && node.layout) {
      const { top, right, bottom, left } = node.layout.padding;
      lines.push("  display: flex;");
      lines.push(`  flex-direction: ${node.layout.direction};`);
      lines.push(`  padding: ${toVw(top, designWidth)} ${toVw(right, designWidth)} ${toVw(bottom, designWidth)} ${toVw(left, designWidth)};`);
    } else if (node.layout && flexParents.has(node.id)) {
      lines.push("  display: flex;");
      lines.push(`  flex-direction: ${node.layout.direction};`);
      lines.push(`  gap: ${toVw(node.layout.gap, designWidth)};`);
      const { top, right, bottom, left } = node.layout.padding;
      lines.push(`  padding: ${toVw(top, designWidth)} ${toVw(right, designWidth)} ${toVw(bottom, designWidth)} ${toVw(left, designWidth)};`);
    } else if (node.layout) {
      lines.push(`  /* flex 复现不了，累计偏差 ${deviations.get(node.id) ?? 0}px，回退绝对定位 */`);
    }
    lines.push("}");
    cssBlocks.push(lines.join("\n"));
    if (node.repeat) {
      const horizontal = node.layout?.direction !== "column";
      const main = `${horizontal ? "width" : "height"}: `
        + `${toVw(node.repeat.pitch, designWidth)};`;
      // 老文件的 repeat 没有槽位，那就只给主轴，交叉轴由内容撑
      const slot = node.repeat.slot;
      const cross = slot
        ? [`  ${horizontal ? "height" : "width"}: `
           + `${toVw(horizontal ? slot.h : slot.w, designWidth)};`]
        : [];
      cssBlocks.push([
        `/* ${node.displayName}：${node.repeat.count} 项重复。`,
        "   主轴用中心距、交叉轴用槽位；子块宽度不同，用 gap 会让位置沿主轴累积偏移。",
        "   墨迹居中放进槽位，不拉伸——三个图标量出 56/52/54 不是误差，",
        "   是它们本来就画得不一样大。",
        "   这条规则必须先于列表项自己的规则输出——两者选择器权重相同，",
        "   靠“后写的赢”让绝对定位的角标用回自己的尺寸。调整输出顺序会静默破坏这一点。 */",
        `.e-${classKey(node.id)} > * {`,
        `  ${main}`,
        ...cross,
        "  display: flex;",
        "  justify-content: center;",
        "  align-items: center;",
        "  flex: 0 0 auto;",
        "}",
      ].join("\n"));
    }
  }
  return { html, css: cssBlocks.join("\n\n") };
}
