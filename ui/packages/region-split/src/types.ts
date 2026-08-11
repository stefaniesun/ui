import { z } from "zod";

export const MIN_REGION_HEIGHT = 8;

export const regionTypes = [
  "status-bar", "nav-bar", "banner", "card", "grid", "list",
  "form", "tabs", "text-block", "action-bar", "tab-bar", "other",
] as const;
export type RegionType = (typeof regionTypes)[number];

export interface Rect { x: number; y: number; w: number; h: number }

export const rectSchema = z.object({
  x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive(),
});

export const regionSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  type: z.enum(regionTypes),
  bounds: rectSchema,
  confidence: z.number().min(0).max(1),
});
export type Region = z.infer<typeof regionSchema>;

export const candidateLineSchema = z.object({
  y: z.number(),          // 原图坐标
  strength: z.number().min(0).max(1),
});
export type CandidateLine = z.infer<typeof candidateLineSchema>;

export const regionSplitDocSchema = z.object({
  schemaVersion: z.string(),
  image: z.object({
    fileName: z.string(),
    width: z.number().positive(),
    height: z.number().positive(),
    analyzedScale: z.number().positive(),
  }),
  regions: z.array(regionSchema),
  candidateLines: z.array(candidateLineSchema).default([]),
  updatedAt: z.string(),
});
export type RegionSplitDoc = z.infer<typeof regionSplitDocSchema>;

export interface RawSegment {
  displayName: string;
  id: string;
  type: RegionType;
  yStart: number;   // 分析图坐标
  yEnd: number;     // 分析图坐标
  confidence: number;
}

export interface InvariantViolation { code: string; message: string }

export function checkInvariants(
  regions: Region[],
  image: { width: number; height: number },
): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  if (regions.length === 0) {
    return [{ code: "empty", message: "regions must not be empty" }];
  }
  const first = regions[0]!;
  const last = regions[regions.length - 1]!;
  if (first.bounds.y !== 0) {
    out.push({ code: "first-not-zero", message: `first region starts at ${first.bounds.y}, expected 0` });
  }
  if (last.bounds.y + last.bounds.h !== image.height) {
    out.push({
      code: "last-not-bottom",
      message: `last region ends at ${last.bounds.y + last.bounds.h}, expected ${image.height}`,
    });
  }
  for (let i = 1; i < regions.length; i++) {
    const prev = regions[i - 1]!;
    const cur = regions[i]!;
    if (cur.bounds.y < prev.bounds.y) {
      out.push({ code: "not-ascending", message: `region ${cur.id} is out of order` });
    } else if (prev.bounds.y + prev.bounds.h !== cur.bounds.y) {
      out.push({
        code: "gap-or-overlap",
        message: `region ${prev.id} ends at ${prev.bounds.y + prev.bounds.h} but ${cur.id} starts at ${cur.bounds.y}`,
      });
    }
  }
  for (const region of regions) {
    if (region.bounds.h < MIN_REGION_HEIGHT) {
      out.push({ code: "too-short", message: `region ${region.id} height ${region.bounds.h} < ${MIN_REGION_HEIGHT}` });
    }
    if (region.bounds.x !== 0 || region.bounds.w !== image.width) {
      out.push({ code: "bad-x-or-width", message: `region ${region.id} must span full width` });
    }
  }
  const seen = new Set<string>();
  for (const region of regions) {
    if (seen.has(region.id)) {
      out.push({ code: "duplicate-id", message: `duplicate region id ${region.id}` });
    }
    seen.add(region.id);
  }
  return out;
}
