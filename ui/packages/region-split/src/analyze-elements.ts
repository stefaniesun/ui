import sharp from "sharp";
import { ensureCleanImage } from "./analyze.js";
import { detectTopLevel } from "./element-detect.js";
import type { ElementTree } from "./element-types.js";
import type { ProjectStore } from "./store.js";
import type { Rect } from "./types.js";

/** 小于这个尺寸的区域没有解析价值 */
export const MIN_ANALYZABLE_SIZE = 32;

export async function detectElements(
  deps: { store: ProjectStore },
  projectId: string,
  region: Rect,
): Promise<ElementTree> {
  if (region.w < MIN_ANALYZABLE_SIZE || region.h < MIN_ANALYZABLE_SIZE) {
    throw new Error("region is too small to analyse");
  }
  const { store } = deps;
  // 用清理图：解析不该再看到手机系统外壳
  await ensureCleanImage(store, projectId);
  const { data, info } = await sharp(store.cleanImagePath(projectId))
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const tree = detectTopLevel(
    { data, width: info.width, height: info.height, channels: info.channels },
    region, new Date().toISOString(),
  );
  return store.writeElementTree(projectId, tree, region);
}
