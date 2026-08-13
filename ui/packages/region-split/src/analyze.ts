import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { preprocessScreenshot } from "./preprocess.js";
import { applyNaming } from "./operations.js";
import { initialRegionsFromCandidateLines, reconcile } from "./reconcile.js";
import type { SegmentModel } from "./model.js";
import { analyzeOneRegionElements, analyzeRegionElements, elementInputFingerprint } from "./element-analysis.js";
import type { ProjectStore } from "./store.js";
import type { Panel } from "./panels.js";
import type { CandidateLine, RegionSplitDoc } from "./types.js";

export type DetectSurface =
  (analyzedPath: string) => Promise<{ candidateLines: CandidateLine[]; panels: Panel[] }>;

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
  deps: { store: ProjectStore; detectSurface?: DetectSurface },
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

  // 预处理：抹掉手机系统外壳，得到与原图**同分辨率**的干净图。
  // 原图保留不动（它是像素比对的事实基准），后续一切——分析图、界面显示、
  // 区域裁剪——都基于清理后的图，这样模型不会把状态栏当成一个设计模块。
  const preprocessed = await preprocessScreenshot(input.buffer);
  writeFileSync(store.cleanImagePath(projectId), preprocessed.png);

  const analyzedScale = meta.height > MAX_ANALYZED_HEIGHT ? MAX_ANALYZED_HEIGHT / meta.height : 1;
  if (analyzedScale < 1) {
    await sharp(preprocessed.png)
      .resize(Math.round(meta.width * analyzedScale), MAX_ANALYZED_HEIGHT)
      .png().toFile(store.analyzedImagePath(projectId));
  } else {
    writeFileSync(store.analyzedImagePath(projectId), preprocessed.png);
  }

  // 候选线是纯图像分析，不需要模型，所以上传时就算好——
  // 这样即使还没配模型，人工拆分也能吸附到真实分割位置。
  const surface = deps.detectSurface
    ? await deps.detectSurface(store.analyzedImagePath(projectId))
    : { candidateLines: [], panels: [] };
  const toOriginal = (v: number) => Math.round(v / analyzedScale);
  const candidateLines: CandidateLine[] = surface.candidateLines.map(line => ({
    y: toOriginal(line.y), strength: line.strength,
  }));
  const panels: Panel[] = surface.panels.map(panel => ({
    top: toOriginal(panel.top), bottom: toOriginal(panel.bottom),
  }));

  const doc: RegionSplitDoc = {
    schemaVersion: "2",
    revision: 0,
    image: {
      fileName: input.fileName, width: meta.width, height: meta.height, analyzedScale,
      removedChrome: preprocessed.removed.map(band => ({ edge: band.edge, height: band.height })),
    },
    regions: initialRegionsFromCandidateLines(
      { width: meta.width, height: meta.height },
      candidateLines,
    ),
    elements: [],
    elementAnalysis: {},
    candidateLines,
    panels,
    updatedAt: new Date().toISOString(),
  };
  store.writeDoc(projectId, doc);
  return { projectId, doc };
}

/**
 * 保证项目有清理图。预处理是上传时做的，所以在这个功能上线之前建的项目没有
 * `image.clean.png`——那些项目不该因此取不到图或让模型看到状态栏，这里按需补齐：
 * 从原图重新预处理，并把分析图一并按同样的 analyzedScale 重做。
 * 幂等：已经有清理图就直接返回。
 */
export async function ensureCleanImage(store: ProjectStore, projectId: string): Promise<void> {
  if (existsSync(store.cleanImagePath(projectId))) return;
  const original = store.imagePath(projectId);
  if (!existsSync(original)) return;

  const preprocessed = await preprocessScreenshot(readFileSync(original));
  writeFileSync(store.cleanImagePath(projectId), preprocessed.png);

  const doc = store.readDoc(projectId);
  const scale = doc.image.analyzedScale;
  if (scale < 1) {
    await sharp(preprocessed.png)
      .resize(Math.round(doc.image.width * scale), Math.round(doc.image.height * scale))
      .png().toFile(store.analyzedImagePath(projectId));
  } else {
    writeFileSync(store.analyzedImagePath(projectId), preprocessed.png);
  }
  store.writeDoc(projectId, {
    ...doc,
    image: {
      ...doc.image,
      removedChrome: preprocessed.removed.map(band => ({ edge: band.edge, height: band.height })),
    },
  });
}

export async function analyzeProject(
  deps: {
    store: ProjectStore;
    model: SegmentModel;
    detectSurface?: DetectSurface;
  },
  projectId: string,
): Promise<RegionSplitDoc> {
  const { store, model } = deps;
  await ensureCleanImage(store, projectId);
  const doc = store.readDoc(projectId);
  const analyzedPath = store.analyzedImagePath(projectId);
  const image = await readImageForModel(analyzedPath);

  // detectLines 返回分析图坐标，这里统一换算成原图坐标后再往下传。
  // 不传 detectLines 时沿用上传时已算好的候选线（已是原图坐标），不要覆盖成空——
  // 否则会丢失候选线，导致拆分吸附失效，还会白白重跑一遍整图 rowStats。
  const scale = doc.image.analyzedScale;
  const fresh = deps.detectSurface ? await deps.detectSurface(analyzedPath) : null;
  const candidateLines: CandidateLine[] = fresh
    ? fresh.candidateLines.map(line => ({ y: Math.round(line.y / scale), strength: line.strength }))
    : doc.candidateLines;
  const panels: Panel[] = fresh
    ? fresh.panels.map(panel => ({
        top: Math.round(panel.top / scale), bottom: Math.round(panel.bottom / scale),
      }))
    : doc.panels;

  const segments = await model.segment({
    imageBase64: image.base64,
    width: image.width,
    height: image.height,
    candidateYs: candidateLines.map(line => Math.round(line.y * scale)),
    panels: panels.map(panel => ({
      top: Math.round(panel.top * scale), bottom: Math.round(panel.bottom * scale),
    })),
  });

  const regions = reconcile(segments, {
    width: doc.image.width,
    height: doc.image.height,
    analyzedScale: doc.image.analyzedScale,
    candidateLines,
  });
  const imageVersion = `${doc.image.width}x${doc.image.height}:${doc.image.removedChrome.length}`;
  const analyzed = await analyzeRegionElements(regions, region => analyzeOneRegionElements(store, projectId, region, model));
  const elements = regions.flatMap(region => {
    const result = analyzed.get(region.id);
    return result?.ok ? result.value : [];
  });
  const elementAnalysis = Object.fromEntries(regions.map(region => {
    const result = analyzed.get(region.id);
    return [region.id, result?.ok
      ? { status: "ready" as const, analyzedAt: new Date().toISOString(), inputFingerprint: elementInputFingerprint(region, imageVersion) }
      : { status: "failed" as const, error: result?.error ?? "element analysis failed", inputFingerprint: elementInputFingerprint(region, imageVersion) }];
  }));
  const now = new Date().toISOString();
  const next: RegionSplitDoc = {
    ...doc, regions, elements, elementAnalysis, candidateLines, panels, analyzedAt: now, updatedAt: now,
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
  await ensureCleanImage(store, projectId);
  const doc = store.readDoc(projectId);
  const region = doc.regions.find(item => item.id === regionId);
  if (!region) throw new Error("region not found");
  // 用清理后的图裁剪：模型不该再看到状态栏图标
  const cropBase64 = await readImageCropForModel(store.cleanImagePath(projectId), {
    left: region.bounds.x, top: region.bounds.y,
    width: region.bounds.w, height: region.bounds.h,
  });
  const naming = await model.nameRegion({ cropBase64 });
  return store.writeRegions(projectId, applyNaming(doc.regions, regionId, naming));
}
