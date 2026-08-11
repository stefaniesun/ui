import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { applyNaming } from "./operations.js";
import { fullPageRegions, reconcile } from "./reconcile.js";
import type { SegmentModel } from "./model.js";
import type { ProjectStore } from "./store.js";
import type { CandidateLine, RegionSplitDoc } from "./types.js";

export const MAX_ANALYZED_HEIGHT = 2000;

export async function createProject(
  deps: { store: ProjectStore },
  input: { fileName: string; buffer: Buffer },
): Promise<{ projectId: string; doc: RegionSplitDoc }> {
  const { store } = deps;
  const projectId = store.newProjectId();
  mkdirSync(store.projectDir(projectId), { recursive: true });

  const image = sharp(input.buffer);
  const meta = await image.metadata();
  if (!meta.width || !meta.height) throw new Error("cannot read image size");
  await sharp(input.buffer).png().toFile(store.imagePath(projectId));

  const analyzedScale = meta.height > MAX_ANALYZED_HEIGHT ? MAX_ANALYZED_HEIGHT / meta.height : 1;
  if (analyzedScale < 1) {
    await sharp(input.buffer)
      .resize(Math.round(meta.width * analyzedScale), MAX_ANALYZED_HEIGHT)
      .png().toFile(store.analyzedImagePath(projectId));
  } else {
    writeFileSync(store.analyzedImagePath(projectId), readFileSync(store.imagePath(projectId)));
  }

  const doc: RegionSplitDoc = {
    schemaVersion: "1",
    image: { fileName: input.fileName, width: meta.width, height: meta.height, analyzedScale },
    regions: fullPageRegions({ width: meta.width, height: meta.height }),
    candidateLines: [],
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
  const analyzedMeta = await sharp(analyzedPath).metadata();

  // detectLines 返回分析图坐标，这里统一换算成原图坐标后再往下传
  const analyzedLines = deps.detectLines ? await deps.detectLines(analyzedPath) : [];
  const candidateLines: CandidateLine[] = analyzedLines.map(line => ({
    y: Math.round(line.y / doc.image.analyzedScale),
    strength: line.strength,
  }));

  const segments = await model.segment({
    imageBase64: readFileSync(analyzedPath).toString("base64"),
    width: analyzedMeta.width ?? 0,
    height: analyzedMeta.height ?? 0,
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
  const crop = await sharp(store.imagePath(projectId))
    .extract({
      left: region.bounds.x, top: region.bounds.y,
      width: region.bounds.w, height: region.bounds.h,
    })
    .png().toBuffer();
  const naming = await model.nameRegion({ cropBase64: crop.toString("base64") });
  return store.writeRegions(projectId, applyNaming(doc.regions, regionId, naming));
}
