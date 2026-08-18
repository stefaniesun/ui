import type { LayoutInfo } from "./element-cut.js";
import type { ElementNode, ElementTree } from "./element-types.js";
import type { Rect } from "./types.js";

export const FLEX_TOLERANCE = 2;

export interface EmitHtmlInput {
  designWidth: number;
  region: Rect;
  tree: ElementTree;
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

export function emitHtml(input: EmitHtmlInput): EmitHtmlResult {
  const { designWidth, region, tree } = input;
  if (!Number.isFinite(designWidth) || designWidth <= 0) throw new Error("designWidth must be positive");
  const byParent = new Map<string | null, ElementNode[]>();
  const byId = new Map(tree.nodes.map((node) => [node.id, node]));
  for (const node of tree.nodes) byParent.set(node.parentId, [...(byParent.get(node.parentId) ?? []), node]);

  const flexParents = new Set<string>();
  const deviations = new Map<string, number>();
  for (const parent of tree.nodes) {
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

  for (const node of tree.nodes) {
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
    const inRepeat = node.parentId !== null
      && byId.get(node.parentId)?.repeat !== undefined
      && node.positioning !== "absolute";
    if (!inRepeat) {
      lines.push(`  width: ${toVw(node.box.w, designWidth)};`);
      lines.push(`  height: ${toVw(node.box.h, designWidth)};`);
    }
    lines.push(...declaration("background", node.style.background));
    lines.push(...declaration("color", node.style.color));
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
