import { MIN_REGION_HEIGHT, type Region, type RegionType } from "./types.js";

const PLACEHOLDER_NAME = "未命名区域";

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Finds the first free `<id>-2`, `<id>-3`, ... suffix (never returns `id` itself unsuffixed). */
function uniqueSuffixedId(id: string, taken: Set<string>): string {
  for (let n = 2; ; n++) {
    const candidate = `${id}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function withBounds(region: Region, y: number, h: number): Region {
  return { ...region, bounds: { ...region.bounds, y, h } };
}

export function canAdjustBoundary(regions: Region[], index: number): boolean {
  return index >= 0 && index < regions.length - 1;
}

export function adjustBoundary(regions: Region[], index: number, delta: number): Region[] {
  if (!canAdjustBoundary(regions, index)) return regions;
  const cur = regions[index]!;
  const next = regions[index + 1]!;
  const minDelta = MIN_REGION_HEIGHT - cur.bounds.h;
  const maxDelta = next.bounds.h - MIN_REGION_HEIGHT;
  const applied = Math.max(minDelta, Math.min(maxDelta, delta));
  if (applied === 0) return regions;
  const out = regions.slice();
  out[index] = withBounds(cur, cur.bounds.y, cur.bounds.h + applied);
  out[index + 1] = withBounds(next, next.bounds.y + applied, next.bounds.h - applied);
  return out;
}

export function canSplitAt(regions: Region[], index: number, y: number): boolean {
  const region = regions[index];
  if (!region) return false;
  const top = y - region.bounds.y;
  const bottom = region.bounds.y + region.bounds.h - y;
  return top >= MIN_REGION_HEIGHT && bottom >= MIN_REGION_HEIGHT;
}

export function splitRegion(regions: Region[], index: number, y: number): Region[] {
  if (!canSplitAt(regions, index, y)) return regions;
  const region = regions[index]!;
  const taken = new Set(regions.map(item => item.id));
  const lower: Region = {
    id: uniqueSuffixedId(region.id, taken),
    displayName: PLACEHOLDER_NAME,
    type: "other",
    bounds: { x: region.bounds.x, y, w: region.bounds.w, h: region.bounds.y + region.bounds.h - y },
    confidence: 0,
  };
  const out = regions.slice();
  out.splice(index, 1, withBounds(region, region.bounds.y, y - region.bounds.y), lower);
  return out;
}

export function areAdjacent(regions: Region[], ids: string[]): boolean {
  if (ids.length < 2) return false;
  const indexes = ids.map(id => regions.findIndex(region => region.id === id));
  if (indexes.some(i => i < 0)) return false;
  const sorted = indexes.slice().sort((a, b) => a - b);
  return sorted.every((value, i) => i === 0 || value === sorted[i - 1]! + 1);
}

export function mergeRegions(regions: Region[], ids: string[]): Region[] {
  if (!areAdjacent(regions, ids)) return regions;
  const indexes = ids.map(id => regions.findIndex(region => region.id === id)).sort((a, b) => a - b);
  const start = indexes[0]!;
  const end = indexes[indexes.length - 1]!;
  const head = regions[start]!;
  const tail = regions[end]!;
  const merged: Region = {
    id: head.id,
    displayName: PLACEHOLDER_NAME,
    type: "other",
    bounds: {
      x: head.bounds.x, y: head.bounds.y, w: head.bounds.w,
      h: tail.bounds.y + tail.bounds.h - head.bounds.y,
    },
    confidence: 0,
  };
  const out = regions.slice();
  out.splice(start, end - start + 1, merged);
  return out;
}

export function renameRegion(regions: Region[], id: string, displayName: string): Region[] {
  return regions.map(region => (region.id === id ? { ...region, displayName } : region));
}

export function applyNaming(
  regions: Region[],
  id: string,
  naming: { displayName: string; id: string; type: RegionType },
): Region[] {
  const taken = new Set(regions.filter(region => region.id !== id).map(region => region.id));
  const nextId = uniqueId(naming.id, taken);
  return regions.map(region =>
    region.id === id
      ? { ...region, id: nextId, displayName: naming.displayName, type: naming.type }
      : region);
}
