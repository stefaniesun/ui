import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import type { RawElement, SegmentModel } from "./model.js";
import type { ProjectStore } from "./store.js";
import { checkDocumentInvariants, type ElementNode, type Region, type RegionSplitDoc } from "./types.js";

export function elementInputFingerprint(region: Region, imageVersion: string): string {
  return createHash("sha256").update(JSON.stringify({ bounds: region.bounds, name: region.displayName, type: region.type, imageVersion })).digest("hex");
}

export function normalizeElementResponse(region: Region, raw: RawElement[]): ElementNode[] {
  const byRawId = new Map<string, string>();
  for (const item of raw) {
    if (byRawId.has(item.id)) throw new Error("duplicate model element id");
    byRawId.set(item.id, `element-${randomUUID()}`);
  }
  const elements = raw.flatMap<ElementNode>(item => {
    const x = Math.max(0, Math.round(item.x)); const y = Math.max(0, Math.round(item.y));
    const right = Math.min(region.bounds.w, Math.round(item.x + item.width));
    const bottom = Math.min(region.bounds.h, Math.round(item.y + item.height));
    const w = right - x; const h = bottom - y;
    if (w < 4 || h < 4) return [];
    if (item.parentId && !byRawId.has(item.parentId)) throw new Error("invalid model element parent");
    return [{ id: byRawId.get(item.id)!, parentId: item.parentId ? byRawId.get(item.parentId)! : null,
      regionId: region.id, displayName: item.displayName, type: item.type,
      bounds: { x: region.bounds.x + x, y: region.bounds.y + y, w, h },
      confidence: item.confidence, conflict: false, source: "ai" }];
  });
  const temporary: RegionSplitDoc = {
    schemaVersion: "2", revision: 0,
    image: { fileName: "crop", width: region.bounds.x + region.bounds.w, height: region.bounds.y + region.bounds.h, analyzedScale: 1, removedChrome: [] },
    regions: [region], elements, elementAnalysis: {}, candidateLines: [], panels: [], updatedAt: "",
  };
  const elementViolations = checkDocumentInvariants(temporary).filter(item => item.code.startsWith("element") || item.code.startsWith("child") || item.code.startsWith("duplicate") || item.code.startsWith("fractional") || item.code.startsWith("invalid-element"));
  if (elementViolations.length) throw new Error(elementViolations.map(item => item.code).join(", "));
  return elements;
}

export async function analyzeRegionElements<T>(regions: Region[], worker: (region: Region) => Promise<T>, concurrency = 3): Promise<Map<string, { ok: true; value: T } | { ok: false; error: string }>> {
  const output = new Map<string, { ok: true; value: T } | { ok: false; error: string }>();
  let cursor = 0;
  const run = async (): Promise<void> => {
    while (cursor < regions.length) {
      const region = regions[cursor++]!;
      try { output.set(region.id, { ok: true, value: await worker(region) }); }
      catch (error) { output.set(region.id, { ok: false, error: error instanceof Error ? error.message.replace(/[A-Z]:\\[^\s]+/gi, "[path]") : "element analysis failed" }); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, regions.length) }, run));
  return output;
}

export async function analyzeOneRegionElements(store: ProjectStore, projectId: string, region: Region, model: SegmentModel): Promise<ElementNode[]> {
  const crop = await sharp(readFileSync(store.cleanImagePath(projectId))).extract({
    left: region.bounds.x, top: region.bounds.y, width: region.bounds.w, height: region.bounds.h,
  }).png().toBuffer();
  const raw = await model.analyzeElements({ cropBase64: crop.toString("base64"), width: region.bounds.w, height: region.bounds.h, regionName: region.displayName, regionType: region.type });
  return normalizeElementResponse(region, raw);
}
