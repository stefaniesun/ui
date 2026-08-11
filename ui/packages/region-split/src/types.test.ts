import { describe, expect, it } from "vitest";
import { checkInvariants, type Region } from "./types.js";

const image = { width: 375, height: 300 };
const r = (id: string, y: number, h: number): Region => ({
  id, displayName: id, type: "other", bounds: { x: 0, y, w: 375, h }, confidence: 0.9,
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
