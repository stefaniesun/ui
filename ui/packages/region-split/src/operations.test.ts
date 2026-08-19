import { describe, expect, it } from "vitest";
import {
  adjustBoundary, applyNaming, areAdjacent, canAdjustBoundary,
  canSplitAt, mergeRegions, renameRegion, splitRegion,
} from "./operations.js";
import type { Region } from "./types.js";

const r = (id: string, y: number, h: number): Region => ({
  id, displayName: `名-${id}`, bounds: { x: 0, y, w: 375, h }, confidence: 0.9, scrollX: false, scrollY: false,
});
const base = () => [r("a", 0, 100), r("b", 100, 100), r("c", 200, 100)];

describe("adjustBoundary", () => {
  it("moves the boundary and compensates the next region", () => {
    const out = adjustBoundary(base(), 0, 10);
    expect(out[0]!.bounds).toEqual({ x: 0, y: 0, w: 375, h: 110 });
    expect(out[1]!.bounds).toEqual({ x: 0, y: 110, w: 375, h: 90 });
    expect(out[2]!.bounds).toEqual({ x: 0, y: 200, w: 375, h: 100 });
  });
  it("clamps so neither side drops below the minimum height", () => {
    const out = adjustBoundary(base(), 0, 500);
    expect(out[0]!.bounds.h).toBe(192);
    expect(out[1]!.bounds.h).toBe(8);
  });
  it("returns input unchanged for the last region", () => {
    const input = base();
    expect(adjustBoundary(input, 2, 10)).toEqual(input);
    expect(canAdjustBoundary(input, 2)).toBe(false);
    expect(canAdjustBoundary(input, 1)).toBe(true);
  });
});

describe("splitRegion", () => {
  it("splits into two regions with a placeholder lower block", () => {
    const out = splitRegion(base(), 1, 150);
    expect(out).toHaveLength(4);
    expect(out[1]!).toMatchObject({ id: "b", displayName: "名-b" });
    expect(out[1]!.bounds).toEqual({ x: 0, y: 100, w: 375, h: 50 });
    expect(out[2]!).toMatchObject({ id: "b-2", displayName: "未命名区域", confidence: 0 });
    expect(out[2]!.bounds).toEqual({ x: 0, y: 150, w: 375, h: 50 });
  });
  it("avoids colliding with an existing id", () => {
    const regions = [r("a", 0, 100), r("a-2", 100, 200)];
    const out = splitRegion(regions, 0, 50);
    expect(out[1]!.id).toBe("a-3");
  });
  it("refuses splits that would create a too-short side", () => {
    const input = base();
    expect(canSplitAt(input, 1, 104)).toBe(false);
    expect(splitRegion(input, 1, 104)).toEqual(input);
    expect(canSplitAt(input, 1, 150)).toBe(true);
  });
});

describe("mergeRegions", () => {
  it("merges adjacent regions into one placeholder region", () => {
    const out = mergeRegions(base(), ["b", "c"]);
    expect(out).toHaveLength(2);
    expect(out[1]!).toMatchObject({ id: "b", displayName: "未命名区域", confidence: 0 });
    expect(out[1]!.bounds).toEqual({ x: 0, y: 100, w: 375, h: 200 });
  });
  it("ignores non-adjacent selections", () => {
    const input = base();
    expect(mergeRegions(input, ["a", "c"])).toEqual(input);
    expect(areAdjacent(input, ["a", "c"])).toBe(false);
    expect(areAdjacent(input, ["c", "b"])).toBe(true);
    expect(areAdjacent(input, ["a"])).toBe(false);
  });
});

describe("renameRegion and applyNaming", () => {
  it("renames only the display name", () => {
    const out = renameRegion(base(), "b", "会员卡");
    expect(out[1]!).toMatchObject({ id: "b", displayName: "会员卡" });
  });
  it("applies model naming and de-duplicates the id", () => {
    const out = applyNaming(base(), "b", { displayName: "权益表", id: "a" });
    expect(out[1]!).toMatchObject({ id: "a-2", displayName: "权益表" });
  });
  it("returns the same array reference when the rename target is missing", () => {
    const input = base();
    expect(renameRegion(input, "missing", "会员卡")).toBe(input);
  });
  it("returns the same array reference when the naming target is missing", () => {
    const input = base();
    expect(applyNaming(input, "missing", { displayName: "权益表", id: "a" })).toBe(input);
  });
});
