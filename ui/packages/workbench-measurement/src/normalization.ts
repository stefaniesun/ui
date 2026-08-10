import sharp from "sharp";
import type { NormalizationInfo, Rect } from "@ui-rebuild/workbench-contracts";

export interface NormalizeOptions {
  outputPath: string;
  logicalWidth?: number;
  statusBarCrop?: Rect;
}

export async function normalizeReference(inputPath: string, options: NormalizeOptions): Promise<NormalizationInfo> {
  const metadata = await sharp(inputPath).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error(`Unable to read image dimensions: ${inputPath}`);
  }

  const crop = options.statusBarCrop;
  const physicalWidth = crop?.w ?? metadata.width;
  const physicalHeight = crop?.h ?? metadata.height;
  const logicalWidth = options.logicalWidth ?? physicalWidth;
  const scale = physicalWidth / logicalWidth;
  const logicalHeight = physicalHeight / scale;

  let pipeline = sharp(inputPath).rotate();
  if (crop) {
    pipeline = pipeline.extract({ left: crop.x, top: crop.y, width: crop.w, height: crop.h });
  }
  if (scale !== 1) {
    pipeline = pipeline.resize({ width: Math.round(logicalWidth), height: Math.round(logicalHeight) });
  }
  await pipeline.png().toFile(options.outputPath);

  return {
    referenceImage: options.outputPath,
    physicalSize: { w: physicalWidth, h: physicalHeight },
    scale,
    logicalSize: { w: logicalWidth, h: logicalHeight },
    statusBarCrop: crop,
    source: "tool",
    confidence: 1,
    reviewed: false,
  };
}
