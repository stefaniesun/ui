import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import sharp from "sharp";
import { ensureCleanImage } from "./analyze.js";
import type { ElementNode, ElementTree } from "./element-types.js";
import { iconById, iconToSvg } from "./icon-library.js";
import type { ProjectStore } from "./store.js";
import type { Rect } from "./types.js";

function sameRect(a: Rect | undefined, b: Rect): boolean {
  return a !== undefined && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

export function assetFileName(projectId: string, box: Rect): string {
  const key = `${projectId}:${box.x},${box.y},${box.w},${box.h}`;
  return `${createHash("sha1").update(key).digest("hex")}.png`;
}

export function iconAssetFileName(projectId: string, nodeId: string, iconId: string): string {
  const hash = createHash("sha1").update(iconId).digest("hex").slice(0, 12);
  return `${projectId}-${nodeId}-${hash}.svg`;
}

function expectedAssetName(projectId: string, node: ElementNode): string {
  return node.kind === "icon" && node.iconDecision?.kind === "library" && iconById(node.iconDecision.iconId)
    ? iconAssetFileName(projectId, node.id, node.iconDecision.iconId)
    : assetFileName(projectId, node.box);
}

export interface MaterializedAssets {
  tree: ElementTree;
  files: Readonly<Record<string, string>>;
}

export function treeAssetFiles(store: ProjectStore, projectId: string, tree: ElementTree): Readonly<Record<string, string>> {
  return Object.fromEntries(tree.nodes.flatMap(node => {
    if ((node.kind !== "image" && node.kind !== "icon") || !node.asset) return [];
    const expected = expectedAssetName(projectId, node);
    if (node.asset.ref !== expected || !sameRect(node.asset.cutFrom, node.box)) return [];
    const path = join(store.assetsDir(projectId), node.asset.ref);
    return existsSync(path) ? [[node.id, path]] : [];
  }));
}

/**
 * 按项目和几何框寻址图片资产。原图与 box 是事实源，缓存文件和节点引用均可重建。
 */
export async function materializeTreeAssets(
  store: ProjectStore,
  projectId: string,
  region: Rect,
  tree: ElementTree,
  persistTree = true,
): Promise<MaterializedAssets> {
  await ensureCleanImage(store, projectId);
  const source = store.cleanImagePath(projectId);
  const assetsDir = store.assetsDir(projectId);
  mkdirSync(assetsDir, { recursive: true });

  let changed = false;
  const files: Record<string, string> = {};
  const nodes: ElementNode[] = [];
  for (const node of tree.nodes) {
    if (node.kind !== "image" && node.kind !== "icon") {
      nodes.push(node);
      continue;
    }
    let materializedNode = node;
    if (node.kind === "icon" && node.iconDecision?.kind === "library") {
      const sourceAssetRef = node.iconDecision.sourceAssetRef ?? assetFileName(projectId, node.box);
      const sourceAssetPath = join(assetsDir, sourceAssetRef);
      if (!existsSync(sourceAssetPath)) {
        const temporary = join(assetsDir, `.${sourceAssetRef}.${randomUUID()}.tmp`);
        try {
          await sharp(source).extract({
            left: node.box.x, top: node.box.y, width: node.box.w, height: node.box.h,
          }).png().toFile(temporary);
          renameSync(temporary, sourceAssetPath);
        } finally {
          rmSync(temporary, { force: true });
        }
      }
      materializedNode = { ...node, iconDecision: { ...node.iconDecision, sourceAssetRef } };
      changed = true;
    }
    const fileName = expectedAssetName(projectId, materializedNode);
    const path = join(assetsDir, fileName);
    if (!existsSync(path)) {
      if (fileName.endsWith(".svg") && materializedNode.iconDecision?.kind === "library") {
        const icon = iconById(materializedNode.iconDecision.iconId)!;
        writeFileSync(path, iconToSvg(icon), "utf8");
      } else {
        const temporary = join(assetsDir, `.${fileName}.${randomUUID()}.tmp`);
        try {
          await sharp(source).extract({
            left: node.box.x,
            top: node.box.y,
            width: node.box.w,
            height: node.box.h,
          }).png().toFile(temporary);
          try {
            renameSync(temporary, path);
          } catch (error) {
            if (!existsSync(path)) throw error;
          }
        } finally {
          rmSync(temporary, { force: true });
        }
      }
    }
    files[node.id] = path;
    const asset = { ref: fileName, cutFrom: { ...materializedNode.box } };
    const iconDecision = materializedNode.iconDecision?.kind === "crop"
      ? { ...materializedNode.iconDecision, assetRef: fileName }
      : materializedNode.iconDecision;
    if (materializedNode.asset?.ref !== fileName || !sameRect(materializedNode.asset?.cutFrom, materializedNode.box)
      || (materializedNode.iconDecision?.kind === "crop" && materializedNode.iconDecision.assetRef !== fileName)) changed = true;
    nodes.push({ ...materializedNode, asset, iconDecision });
  }

  const nextTree = changed ? { ...tree, nodes } : tree;
  if (changed && persistTree) store.writeElementTree(projectId, nextTree, region);
  return { tree: nextTree, files };
}

export function portableAssetPath(path: string): string {
  return `assets/${basename(path).replaceAll("\\", "/")}`;
}
