import { describe, expect, it } from "vitest";
import { fullPageRegions, initialRegionsFromCandidateLines, reconcile } from "./reconcile.js";
import { checkInvariants, type RawSegment } from "./types.js";

const image = { width: 375, height: 600 };
const seg = (id: string, yStart: number, yEnd: number): RawSegment => ({
  id, displayName: `名-${id}`, type: "card", yStart, yEnd, confidence: 0.9, scrollX: false, scrollY: false,
});

describe("reconcile", () => {
  it("falls back to a single full-page region when there are no segments", () => {
    const out = reconcile([], { ...image, analyzedScale: 1 });
    expect(out).toHaveLength(1);
    expect(out[0]!).toMatchObject({ id: "region-1", displayName: "整页", type: "other" });
    expect(out[0]!.bounds).toEqual({ x: 0, y: 0, w: 375, h: 600 });
    expect(checkInvariants(out, image)).toEqual([]);
  });

  it("makes segments contiguous and clamps the ends", () => {
    const out = reconcile([seg("a", 10, 190), seg("b", 200, 400), seg("c", 400, 550)],
      { ...image, analyzedScale: 1 });
    expect(out.map(r => [r.bounds.y, r.bounds.h])).toEqual([[0, 200], [200, 200], [400, 200]]);
    expect(checkInvariants(out, image)).toEqual([]);
  });

  it("scales analyzed coordinates back to original pixels", () => {
    const out = reconcile([seg("a", 0, 100), seg("b", 100, 300)],
      { ...image, analyzedScale: 0.5 });
    expect(out.map(r => [r.bounds.y, r.bounds.h])).toEqual([[0, 200], [200, 400]]);
  });

  it("snaps boundaries to the strongest nearby candidate line", () => {
    const out = reconcile([seg("a", 0, 200), seg("b", 200, 600)], {
      ...image, analyzedScale: 1,
      candidateLines: [{ y: 208, strength: 0.4 }, { y: 206, strength: 0.9 }, { y: 400, strength: 1 }],
    });
    expect(out[0]!.bounds.h).toBe(206);
  });

  it("ignores candidate lines outside the snap threshold", () => {
    const out = reconcile([seg("a", 0, 200), seg("b", 200, 600)], {
      ...image, analyzedScale: 1, candidateLines: [{ y: 240, strength: 1 }],
    });
    expect(out[0]!.bounds.h).toBe(200);
  });

  it("drops boundaries that would create a too-short region and merges into the previous segment", () => {
    const out = reconcile([seg("a", 0, 100), seg("b", 100, 104), seg("c", 104, 600)],
      { ...image, analyzedScale: 1 });
    expect(out).toHaveLength(2);
    expect(out[0]!.id).toBe("a");
    expect(out.map(r => [r.bounds.y, r.bounds.h])).toEqual([[0, 100], [100, 500]]);
    expect(checkInvariants(out, image)).toEqual([]);
  });

  it("de-duplicates ids", () => {
    const out = reconcile([seg("dup", 0, 300), seg("dup", 300, 600)], { ...image, analyzedScale: 1 });
    expect(out.map(r => r.id)).toEqual(["dup", "dup-2"]);
  });
});

describe("initialRegionsFromCandidateLines", () => {
  it("uses the strongest well-spaced lines and covers the whole image", () => {
    const out = initialRegionsFromCandidateLines(image, [
      { y: 120, strength: 0.7 },
      { y: 130, strength: 0.95 }, // 与 120 太近，保留更强的 130
      { y: 300, strength: 0.8 },
      { y: 590, strength: 1 }, // 太靠近底部
    ]);
    expect(out.map(region => [region.bounds.y, region.bounds.h])).toEqual([
      [0, 130], [130, 170], [300, 300],
    ]);
    expect(checkInvariants(out, image)).toEqual([]);
  });

  it("limits noisy candidates to ten regions", () => {
    const tallImage = { width: 375, height: 2000 };
    const candidates = Array.from({ length: 15 }, (_, index) => ({
      y: 150 + index * 120,
      strength: 1 - index * 0.01,
    }));
    const out = initialRegionsFromCandidateLines(tallImage, candidates);
    expect(out).toHaveLength(10);
    expect(checkInvariants(out, tallImage)).toEqual([]);
  });

  it("falls back to the full page without usable candidate lines", () => {
    const out = initialRegionsFromCandidateLines(image, [{ y: 5, strength: 1 }]);
    expect(out).toEqual(fullPageRegions(image));
  });
});

describe("fullPageRegions", () => {
  it("covers the whole image", () => {
    expect(checkInvariants(fullPageRegions(image), image)).toEqual([]);
  });
});
