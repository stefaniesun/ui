import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import sharp from "sharp";
import { ensureCleanImage } from "./analyze.js";
import type { ElementNode, ElementTree } from "./element-types.js";
import type { ProjectStore } from "./store.js";
import type { Rect } from "./types.js";

function sameRect(a: Rect | undefined, b: Rect): boolean {
  return a !== undefined && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

export function assetFileName(projectId: string, box: Rect): string {
  const key = `${projectId}:${box.x},${box.y},${box.w},${box.h}`;
  return `${createHash("sha1").update(key).digest("hex")}.png`;
}

export interface MaterializedAssets {
  tree: ElementTree;
  files: Readonly<Record<string, string>>;
}

export function treeAssetFiles(store: ProjectStore, projectId: string, tree: ElementTree): Readonly<Record<string, string>> {
  return Object.fromEntries(tree.nodes.flatMap(node => {
    if ((node.kind !== "image" && node.kind !== "icon") || !node.asset) return [];
    const expected = assetFileName(projectId, node.box);
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
    const fileName = assetFileName(projectId, node.box);
    const path = join(assetsDir, fileName);
    if (!existsSync(path)) {
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
    files[node.id] = path;
    const asset = { ref: fileName, cutFrom: { ...node.box } };
    if (node.asset?.ref !== fileName || !sameRect(node.asset?.cutFrom, node.box)) changed = true;
    nodes.push({ ...node, asset });
  }

  const nextTree = changed ? { ...tree, nodes } : tree;
  if (changed && persistTree) store.writeElementTree(projectId, nextTree, region);
  return { tree: nextTree, files };
}

export function portableAssetPath(path: string): string {
  return `assets/${basename(path).replaceAll("\\", "/")}`;
}
