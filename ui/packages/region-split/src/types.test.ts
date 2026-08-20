import { describe, expect, it } from "vitest";
import { checkInvariants, rectSchema, type Region } from "./types.js";

const image = { width: 375, height: 300 };
const r = (id: string, y: number, h: number): Region => ({
  id, displayName: id, bounds: { x: 0, y, w: 375, h }, confidence: 0.9, scrollX: false, scrollY: false,
});

describe("RegionSplitDoc fontStack", () => {
  it("keeps an optional selected font stack", async () => {
    const { regionSplitDocSchema } = await import("./types.js");
    const parsed = regionSplitDocSchema.parse({
      schemaVersion: "1",
      image: { fileName: "screen.png", width: 375, height: 300, analyzedScale: 1 },
      regions: [r("a", 0, 300)], candidateLines: [], panels: [],
      fontStack: "Arial, sans-serif", updatedAt: "2026-08-20T00:00:00.000Z",
    });
    expect(parsed.fontStack).toBe("Arial, sans-serif");
  });
});

describe("checkInvariants", () => {
  it("accepts a contiguous full-cover set", () => {
    expect(checkInvariants([r("a", 0, 100), r("b", 100, 200)], image)).toEqual([]);
  });
  it("rejects empty regions", () => {
    expect(checkInvariants([], image).map(v => v.code)).toEqual(["empty"]);
  });
  it("rejects a gap between regions", () => {
    const codes = checkInvariants([r("a", 0, 90), r("b", 100, 200)], image).map(v => v.code);
    expect(codes).toContain("gap-or-overlap");
  });
  it("rejects when first region does not start at 0", () => {
    const codes = checkInvariants([r("a", 10, 90), r("b", 100, 200)], image).map(v => v.code);
    expect(codes).toContain("first-not-zero");
  });
  it("rejects when last region does not reach image bottom", () => {
    const codes = checkInvariants([r("a", 0, 100), r("b", 100, 150)], image).map(v => v.code);
    expect(codes).toContain("last-not-bottom");
  });
  it("rejects regions shorter than the minimum height", () => {
    const codes = checkInvariants([r("a", 0, 4), r("b", 4, 296)], image).map(v => v.code);
    expect(codes).toContain("too-short");
  });
  it("rejects wrong x or width", () => {
    const bad = { ...r("a", 0, 100), bounds: { x: 5, y: 0, w: 370, h: 100 } };
    const codes = checkInvariants([bad, r("b", 100, 200)], image).map(v => v.code);
    expect(codes).toContain("bad-x-or-width");
  });
  it("rejects duplicate ids", () => {
    const codes = checkInvariants([r("a", 0, 100), r("a", 100, 200)], image).map(v => v.code);
    expect(codes).toContain("duplicate-id");
  });
});

describe("rectSchema", () => {
  it("accepts integer bounds", () => {
    expect(rectSchema.safeParse({ x: 0, y: 100, w: 375, h: 100 }).success).toBe(true);
  });

  it("rejects fractional coordinates even when they are self-consistent", () => {
    // 两个相邻矩形 {y:0,h:100.5} 和 {y:100.5,...} 相加仍自洽，能骗过 checkInvariants，
    // 但 sharp.extract 不接受小数 top/height，会在 analyze 阶段抛错。
    expect(rectSchema.safeParse({ x: 0, y: 0, w: 375, h: 100.5 }).success).toBe(false);
    expect(rectSchema.safeParse({ x: 0, y: 100.5, w: 375, h: 200 }).success).toBe(false);
    expect(rectSchema.safeParse({ x: 0.5, y: 0, w: 375, h: 100 }).success).toBe(false);
    expect(rectSchema.safeParse({ x: 0, y: 0, w: 375.5, h: 100 }).success).toBe(false);
  });
});
