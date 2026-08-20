import sharp from "sharp";
import { ensureCleanImage } from "./analyze.js";
import { materializeTreeAssets } from "./asset-cache.js";
import { detectElementTree } from "./element-detect.js";
import { checkTextBox } from "./element-text-box.js";
import { leafKinds, type ElementNode, type ElementTree } from "./element-types.js";
import { iconById, iconToSvg, searchIcons } from "./icon-library.js";
import type { SegmentModel } from "./model.js";
import type { ProjectStore } from "./store.js";
import type { Rect } from "./types.js";
import type { RawImage } from "./panels.js";

/** 小于这个尺寸的区域没有解析价值 */
export const MIN_ANALYZABLE_SIZE = 32;

/**
 * 间隙相对子块小到这个程度，就怀疑这一组是**同一个元素被误切开**的，
 * 允许模型答"其实是一个整体"。与切分时的文字保护用的是同一个常量。
 *
 * 必须由几何先标出可疑对象，不能对所有容器都问：模型会把
 * `[图标, 文字]` 这种真实结构也一并拍平。实测——
 * 扫码图标被切开的两半 2/25 = 0.08（可疑）；常用服务格子 29/54 = 0.54（正常）。
 */
const SUSPECT_GAP_RATIO = 0.25;

/** 一批要交给模型的兄弟节点，以及它们共同的裁图范围 */
interface Group {
  crop: Rect;
  direction: "row" | "column";
  children: ElementNode[];
  /** 父节点 id；顶层组为 null，顶层不允许拍平（它就是区域） */
  parentId: string | null;
  /** 几何认为这一组可能是误切，允许模型提议拍平 */
  mayBeWhole: boolean;
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** 这一组的间隙相对子块尺寸是否小得反常 */
function looksOverCut(children: ElementNode[], direction: "row" | "column"): boolean {
  if (children.length < 2) return false;
  const start = (n: ElementNode) => direction === "row" ? n.box.x : n.box.y;
  const size = (n: ElementNode) => direction === "row" ? n.box.w : n.box.h;
  const sorted = [...children].sort((a, b) => start(a) - start(b));
  const gaps = sorted.slice(1).map((n, i) => start(n) - (start(sorted[i]!) + size(sorted[i]!)));
  const median = medianOf(sorted.map(size));
  return median > 0 && medianOf(gaps) < median * SUSPECT_GAP_RATIO;
}

/**
 * 按父节点把兄弟分组，并按**阅读顺序**排好。
 *
 * 顺序是这套做法的关键：模型不需要定位任何东西，只按横排从左到右、竖排从上到下
 * 依次作答，位置由树提供。顶层节点没有父节点，用整个区域当裁图范围。
 */
export function groupForClassification(nodes: ElementNode[], region: Rect): Group[] {
  const byParent = new Map<string | null, ElementNode[]>();
  for (const node of nodes) {
    const list = byParent.get(node.parentId) ?? [];
    list.push(node);
    byParent.set(node.parentId, list);
  }
  const groups: Group[] = [];
  for (const [parentId, children] of byParent) {
    const parent = parentId === null
      ? null
      : nodes.find(node => node.id === parentId);
    const direction = parent?.layout?.direction ?? "column";
    const sorted = [...children].sort((a, b) => direction === "row"
      ? a.box.x - b.box.x || a.box.y - b.box.y
      : a.box.y - b.box.y || a.box.x - b.box.x);
    // 顶层组不允许拍平：它的"父"是区域本身，拍平就等于把整个区域当一个元素
    const mayBeWhole = parent !== null && parent !== undefined
      && looksOverCut(sorted, direction)
      && sorted.every(child => !nodes.some(n => n.parentId === child.id));
    groups.push({
      crop: parent?.box ?? region, direction, children: sorted,
      parentId: parentId, mayBeWhole,
    });
  }
  return groups;
}

/**
 * 给每个文字节点填上框校验结果。
 *
 * 必须在模型分类**之后**跑:`kind` 是模型定的,检测阶段还不知道谁是文字。
 * 只判断不修正——框错了该由人来改,自动挪框会把错误藏起来。
 */
export function markTextBoxes(raw: RawImage, nodes: ElementNode[]): ElementNode[] {
  return nodes.map(node => node.kind === "text"
    ? { ...node, textBox: checkTextBox(raw, node.box) }
    : node);
}

async function decideIcons(
  model: SegmentModel,
  source: string,
  nodes: ElementNode[],
): Promise<ElementNode[]> {
  return Promise.all(nodes.map(async node => {
    if (node.kind !== "icon") return node;
    const keywords = node.iconKeywords?.length ? node.iconKeywords : [node.text?.trim() || node.displayName.trim()];
    const query = keywords.join(" ");
    const seen = new Set<string>();
    const candidates = keywords.flatMap(keyword => searchIcons(keyword, 8)).filter(candidate => {
      if (seen.has(candidate.id)) return false;
      seen.add(candidate.id);
      return true;
    }).slice(0, 12);
    try {
      const cropBase64 = (await sharp(source).extract({
        left: node.box.x, top: node.box.y, width: node.box.w, height: node.box.h,
      }).png().toBuffer()).toString("base64");
      const decision = await model.decideIcon({
        cropBase64,
        candidates: candidates.flatMap(candidate => {
          const icon = iconById(candidate.id);
          return icon ? [{ ...candidate, svg: iconToSvg(icon) }] : [];
        }),
      });
      return { ...node, iconDecision: { ...decision, keywords, by: "model" as const } };
    } catch (error) {
      return {
        ...node,
        iconDecision: {
          kind: "crop" as const,
          assetRef: "",
          reason: error instanceof Error ? `图标判断失败：${error.message}` : "图标判断失败",
          keywords,
          by: "model" as const,
        },
      };
    }
  }));
}

export async function detectElements(
  deps: { store: ProjectStore; model?: SegmentModel },
  projectId: string,
  region: Rect,
): Promise<ElementTree> {
  if (region.w < MIN_ANALYZABLE_SIZE || region.h < MIN_ANALYZABLE_SIZE) {
    throw new Error("region is too small to analyse");
  }
  const { store, model } = deps;
  // 用清理图：解析不该再看到手机系统外壳
  await ensureCleanImage(store, projectId);
  const path = store.cleanImagePath(projectId);
  const { data, info } = await sharp(path).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const tree = detectElementTree(
    { data, width: info.width, height: info.height, channels: info.channels },
    region, new Date().toISOString(),
  );

  const hasChildren = new Set(tree.nodes.map(node => node.parentId).filter(Boolean));
  const isLeaf = (node: ElementNode) => !hasChildren.has(node.id);
  // 位图已由 uniformity 判定；其余叶子在模型给出结果前一律存疑
  for (const node of tree.nodes) {
    if (isLeaf(node) && !leafKinds.includes(node.kind)) node.classification = "uncertain";
  }

  // 检测本身是纯本地计算：没配模型也必须拿得到层级、布局量和滚动属性
  if (!model) {
    const raw: RawImage = {
      data, width: info.width, height: info.height, channels: info.channels,
    };
    return store.writeElementTree(
      projectId, { ...tree, nodes: markTextBoxes(raw, tree.nodes) }, region);
  }

  // 每组问一次，并发发出，结果收齐后一次性落盘——只有一次写盘，
  // 不存在区域自动重命名那里要规避的读写覆盖竞态。
  const groups = groupForClassification(tree.nodes, region);
  const results = await Promise.all(groups.map(async group => {
    try {
      const crop = await sharp(path).extract({
        left: group.crop.x, top: group.crop.y,
        width: group.crop.w, height: group.crop.h,
      }).png().toBuffer();
      const result = await model.classifyChildren({
        cropBase64: crop.toString("base64"),
        count: group.children.length,
        direction: group.direction,
        mayBeWhole: group.mayBeWhole,
      });
      return { group, result };
    } catch {
      // 模型未配置、超时、长度不符都走这里：该组保持占位名与存疑状态，
      // 其余组不受影响。层级是纯本地算出来的，不该被模型拖累。
      return { group, result: null };
    }
  }));

  let named = false;
  const flattened = new Set<string>();
  for (const { group, result } of results) {
    if (!result) continue;
    named = true;

    // 模型认定这一组其实是同一个元素被误切开：拍平这一层。
    // 只在几何已经标出可疑时才可能走到这里。
    if (result.whole && group.parentId) {
      const parent = tree.nodes.find(node => node.id === group.parentId);
      if (parent) {
        parent.kind = result.whole.kind;
        parent.displayName = result.whole.displayName;
        if (result.whole.kind === "text" && result.whole.text?.trim()) parent.text = result.whole.text.trim();
        else delete parent.text;
        parent.classification = "model";
        delete parent.layout;
        delete parent.repeat;
        for (const child of group.children) flattened.add(child.id);
        continue;
      }
    }

    group.children.forEach((child, index) => {
      const item = result.children[index]!;
      // 只有叶子接受模型给的 kind；容器的 kind 由几何决定，模型不得改写
      if (isLeaf(child)) {
        child.kind = item.kind;
        child.classification = "model";
        if (item.kind === "text" && item.text?.trim()) child.text = item.text.trim();
        else delete child.text;
        if (item.kind === "icon" && item.iconKeywords?.length) child.iconKeywords = item.iconKeywords;
        else delete child.iconKeywords;
      }
      child.displayName = item.displayName;
    });
  }
  if (named) tree.namedAt = new Date().toISOString();

  const kept = flattened.size === 0
    ? tree.nodes
    : tree.nodes.filter(node => !flattened.has(node.id));
  const raw: RawImage = {
    data, width: info.width, height: info.height, channels: info.channels,
  };
  const nodes = await decideIcons(model, path, markTextBoxes(raw, kept));
  const written = store.writeElementTree(projectId, { ...tree, nodes }, region);
  return (await materializeTreeAssets(store, projectId, region, written)).tree;
}
