import { describe, expect, it } from "vitest";
import {
  checkDocumentInvariants, checkInvariants, normalizeRegionSplitDoc,
  rectSchema, regionSplitDocSchema, type ElementNode, type Region, type RegionSplitDoc,
} from "./types.js";

const image = { width: 375, height: 300 };
const r = (id: string, y: number, h: number): Region => ({
  id, displayName: id, type: "other", bounds: { x: 0, y, w: 375, h }, confidence: 0.9, scrollX: false, scrollY: false,
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

const baseDoc = (): RegionSplitDoc => ({
  schemaVersion: "2", revision: 0,
  image: { fileName: "x.png", width: 375, height: 300, analyzedScale: 1, removedChrome: [] },
  regions: [r("a", 0, 300)], elements: [], elementAnalysis: {}, candidateLines: [], panels: [], updatedAt: "now",
});
const element = (id: string, parentId: string | null): ElementNode => ({
  id, parentId, regionId: "a", displayName: id, type: "container",
  bounds: { x: 0, y: 0, w: 100, h: 100 }, confidence: 1, conflict: false, source: "ai",
});

describe("region split document elements", () => {
  it("loads a v1 document with empty element defaults", () => {
    const { revision: _revision, elements: _elements, elementAnalysis: _analysis, ...rest } = baseDoc();
    const parsed = regionSplitDocSchema.parse({ ...rest, schemaVersion: "1" });
    expect(parsed.revision).toBe(0);
    expect(parsed.elements).toEqual([]);
    expect(parsed.elementAnalysis).toEqual({});
  });
  it("rejects duplicate element ids and cyclic parents", () => {
    const document = baseDoc();
    document.elements = [element("a", "b"), element("b", "a")];
    expect(checkDocumentInvariants(document).map(item => item.code)).toContain("element-parent-cycle");
  });
  it("normalizes persisted analyzing state to failed", () => {
    const document = baseDoc();
    document.elementAnalysis = { a: { status: "analyzing" } };
    expect(normalizeRegionSplitDoc(document).elementAnalysis.a?.status).toBe("failed");
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
