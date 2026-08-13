import sharp from "sharp";
import { ensureCleanImage } from "./analyze.js";
import { detectElementTree } from "./element-detect.js";
import { leafKinds, type ElementNode, type ElementTree } from "./element-types.js";
import type { SegmentModel } from "./model.js";
import type { ProjectStore } from "./store.js";
import type { Rect } from "./types.js";

/** 小于这个尺寸的区域没有解析价值 */
export const MIN_ANALYZABLE_SIZE = 32;

/** 一批要交给模型的兄弟节点，以及它们共同的裁图范围 */
interface Group {
  crop: Rect;
  direction: "row" | "column";
  children: ElementNode[];
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
    groups.push({ crop: parent?.box ?? region, direction, children: sorted });
  }
  return groups;
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
  if (!model) return store.writeElementTree(projectId, tree, region);

  // 每组问一次，并发发出，结果收齐后一次性落盘——只有一次写盘，
  // 不存在区域自动重命名那里要规避的读写覆盖竞态。
  const groups = groupForClassification(tree.nodes, region);
  const results = await Promise.all(groups.map(async group => {
    try {
      const crop = await sharp(path).extract({
        left: group.crop.x, top: group.crop.y,
        width: group.crop.w, height: group.crop.h,
      }).png().toBuffer();
      const classified = await model.classifyChildren({
        cropBase64: crop.toString("base64"),
        count: group.children.length,
        direction: group.direction,
      });
      return { group, classified };
    } catch {
      // 模型未配置、超时、长度不符都走这里：该组保持占位名与存疑状态，
      // 其余组不受影响。层级是纯本地算出来的，不该被模型拖累。
      return { group, classified: null };
    }
  }));

  let named = false;
  for (const { group, classified } of results) {
    if (!classified) continue;
    named = true;
    group.children.forEach((child, index) => {
      const item = classified[index]!;
      // 只有叶子接受模型给的 kind；容器的 kind 由几何决定，模型不得改写
      if (isLeaf(child)) {
        child.kind = item.kind;
        child.classification = "model";
      }
      child.displayName = item.displayName;
    });
  }
  if (named) tree.namedAt = new Date().toISOString();

  return store.writeElementTree(projectId, tree, region);
}
