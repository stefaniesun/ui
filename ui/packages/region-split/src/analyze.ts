import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { applyNaming } from "./operations.js";
import { initialRegionsFromCandidateLines, reconcile } from "./reconcile.js";
import type { SegmentModel } from "./model.js";
import type { ProjectStore } from "./store.js";
import type { CandidateLine, RegionSplitDoc } from "./types.js";

export const MAX_ANALYZED_HEIGHT = 2000;

/** Thrown when the uploaded file cannot be decoded as an image — the server maps this to 400. */
export class InvalidImageError extends Error {}

// fs/sharp 读盘失败的原始消息（如 ENOENT、"Input file is missing: ..."）会带上完整绝对路径。
// 这些是服务端本地细节，不应该原样透传给前端渲染；统一换成不含路径的通用消息，
// 与模型层的错误消息（超时、HTTP 状态、解析失败等，本身不含路径）区分开。
const IMAGE_READ_ERROR = "failed to read project image from disk";

async function readImageForModel(path: string): Promise<{ base64: string; width: number; height: number }> {
  try {
    const meta = await sharp(path).metadata();
    const base64 = readFileSync(path).toString("base64");
    return { base64, width: meta.width ?? 0, height: meta.height ?? 0 };
  } catch {
    throw new Error(IMAGE_READ_ERROR);
  }
}

async function readImageCropForModel(
  path: string, rect: { left: number; top: number; width: number; height: number },
): Promise<string> {
  try {
    const crop = await sharp(path).extract(rect).png().toBuffer();
    return crop.toString("base64");
  } catch {
    throw new Error(IMAGE_READ_ERROR);
  }
}

export async function createProject(
  deps: { store: ProjectStore; detectLines?: (analyzedPath: string) => Promise<CandidateLine[]> },
  input: { fileName: string; buffer: Buffer },
): Promise<{ projectId: string; doc: RegionSplitDoc }> {
  const { store } = deps;
  const projectId = store.newProjectId();

  let meta: sharp.Metadata;
  try {
    meta = await sharp(input.buffer).metadata();
  } catch {
    throw new InvalidImageError("uploaded file is not a valid image");
  }
  if (!meta.width || !meta.height) throw new InvalidImageError("uploaded file is not a valid image");

  // 只有确认是可解码的图片之后才建项目目录，失败时不留下空目录。
  mkdirSync(store.projectDir(projectId), { recursive: true });
  await sharp(input.buffer).png().toFile(store.imagePath(projectId));

  const analyzedScale = meta.height > MAX_ANALYZED_HEIGHT ? MAX_ANALYZED_HEIGHT / meta.height : 1;
  if (analyzedScale < 1) {
    await sharp(input.buffer)
      .resize(Math.round(meta.width * analyzedScale), MAX_ANALYZED_HEIGHT)
      .png().toFile(store.analyzedImagePath(projectId));
  } else {
    writeFileSync(store.analyzedImagePath(projectId), readFileSync(store.imagePath(projectId)));
  }

  // 候选线是纯图像分析，不需要模型，所以上传时就算好——
  // 这样即使还没配模型，人工拆分也能吸附到真实分割位置。
  const analyzedLines = deps.detectLines
    ? await deps.detectLines(store.analyzedImagePath(projectId))
    : [];
  const candidateLines: CandidateLine[] = analyzedLines.map(line => ({
    y: Math.round(line.y / analyzedScale),
    strength: line.strength,
  }));

  const doc: RegionSplitDoc = {
    schemaVersion: "1",
    image: { fileName: input.fileName, width: meta.width, height: meta.height, analyzedScale },
    regions: initialRegionsFromCandidateLines(
      { width: meta.width, height: meta.height },
      candidateLines,
    ),
    candidateLines,
    updatedAt: new Date().toISOString(),
  };
  store.writeDoc(projectId, doc);
  return { projectId, doc };
}

export async function analyzeProject(
  deps: {
    store: ProjectStore;
    model: SegmentModel;
    detectLines?: (analyzedPath: string) => Promise<CandidateLine[]>;
  },
  projectId: string,
): Promise<RegionSplitDoc> {
  const { store, model } = deps;
  const doc = store.readDoc(projectId);
  const analyzedPath = store.analyzedImagePath(projectId);
  const image = await readImageForModel(analyzedPath);

  // detectLines 返回分析图坐标，这里统一换算成原图坐标后再往下传。
  // 不传 detectLines 时沿用上传时已算好的候选线（已是原图坐标），不要覆盖成空——
  // 否则会丢失候选线，导致拆分吸附失效，还会白白重跑一遍整图 rowStats。
  const candidateLines: CandidateLine[] = deps.detectLines
    ? (await deps.detectLines(analyzedPath)).map(line => ({
        y: Math.round(line.y / doc.image.analyzedScale),
        strength: line.strength,
      }))
    : doc.candidateLines;

  const segments = await model.segment({
    imageBase64: image.base64,
    width: image.width,
    height: image.height,
    candidateYs: candidateLines.map(line => Math.round(line.y * doc.image.analyzedScale)),
  });

  const regions = reconcile(segments, {
    width: doc.image.width,
    height: doc.image.height,
    analyzedScale: doc.image.analyzedScale,
    candidateLines,
  });
  const next: RegionSplitDoc = {
    ...doc, regions, candidateLines, updatedAt: new Date().toISOString(),
  };
  store.writeDoc(projectId, next);
  return next;
}

export async function renameRegionWithModel(
  deps: { store: ProjectStore; model: SegmentModel },
  projectId: string,
  regionId: string,
): Promise<RegionSplitDoc> {
  const { store, model } = deps;
  const doc = store.readDoc(projectId);
  const region = doc.regions.find(item => item.id === regionId);
  if (!region) throw new Error("region not found");
  const cropBase64 = await readImageCropForModel(store.imagePath(projectId), {
    left: region.bounds.x, top: region.bounds.y,
    width: region.bounds.w, height: region.bounds.h,
  });
  const naming = await model.nameRegion({ cropBase64 });
  return store.writeRegions(projectId, applyNaming(doc.regions, regionId, naming));
}
