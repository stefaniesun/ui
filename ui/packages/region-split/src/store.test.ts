import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectStore } from "./store.js";
import { fullPageRegions } from "./reconcile.js";
import { regionKey, type ElementNode, type ElementTree } from "./element-types.js";
import type { RegionSplitDoc } from "./types.js";

const freshStore = () => new ProjectStore(mkdtempSync(join(tmpdir(), "rs-")));
const doc = (): RegionSplitDoc => ({
  schemaVersion: "1",
  image: { fileName: "image.png", width: 375, height: 600, analyzedScale: 1, removedChrome: [] },
  regions: fullPageRegions({ width: 375, height: 600 }),
  candidateLines: [],
  panels: [],
  updatedAt: new Date().toISOString(),
});

describe("ProjectStore", () => {
  it("round-trips a document", () => {
    const store = freshStore();
    store.writeDoc("p1", doc());
    expect(store.readDoc("p1").regions).toHaveLength(1);
    expect(store.exists("p1")).toBe(true);
  });

  it("throws when the project is missing", () => {
    expect(() => freshStore().readDoc("nope")).toThrow(/project not found/);
  });

  it("rejects writes that violate invariants and keeps the old file", () => {
    const store = freshStore();
    store.writeDoc("p1", doc());
    const broken = doc();
    broken.regions = [{
      id: "x", displayName: "x", type: "other",
      bounds: { x: 0, y: 0, w: 375, h: 100 }, confidence: 1,
      scrollX: false, scrollY: false,
    }];
    expect(() => store.writeDoc("p1", broken)).toThrow(/invariant violated/);
    expect(store.readDoc("p1").regions[0]!.bounds.h).toBe(600);
  });

  it("writeRegions refreshes updatedAt and validates", () => {
    const store = freshStore();
    store.writeDoc("p1", { ...doc(), updatedAt: "2020-01-01T00:00:00.000Z" });
    const next = store.writeRegions("p1", [
      { id: "a", displayName: "上", type: "card", bounds: { x: 0, y: 0, w: 375, h: 200 }, confidence: 1, scrollX: false, scrollY: false },
      { id: "b", displayName: "下", type: "card", bounds: { x: 0, y: 200, w: 375, h: 400 }, confidence: 1, scrollX: false, scrollY: false },
    ]);
    expect(next.regions).toHaveLength(2);
    expect(next.updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
  });

  it("rejects project ids that escape the root", () => {
    const store = freshStore();
    expect(() => store.projectDir("../evil")).toThrow(/invalid project id/);
    expect(() => store.projectDir("a/b")).toThrow(/invalid project id/);
  });

  it("keeps candidate lines when only regions are written", () => {
    const store = freshStore();
    store.writeDoc("p1", { ...doc(), candidateLines: [{ y: 120, strength: 0.8 }] });
    const next = store.writeRegions("p1", [
      { id: "a", displayName: "上", type: "card", bounds: { x: 0, y: 0, w: 375, h: 200 }, confidence: 1, scrollX: false, scrollY: false },
      { id: "b", displayName: "下", type: "card", bounds: { x: 0, y: 200, w: 375, h: 400 }, confidence: 1, scrollX: false, scrollY: false },
    ]);
    expect(next.candidateLines).toEqual([{ y: 120, strength: 0.8 }]);
  });

  it("generates dated project ids", () => {
    expect(freshStore().newProjectId()).toMatch(/^\d{8}-[a-z0-9]{6}$/);
  });

  it("rejects fractional bounds even when they are internally consistent", () => {
    const store = freshStore();
    store.writeDoc("p1", doc());
    // y:0,h:100.5 与 y:100.5,h:499.5 相加仍自洽，能骗过 checkInvariants，
    // 但落盘后会在 analyze.ts 的 sharp.extract 中因非整数 top/height 抛错。
    expect(() => store.writeRegions("p1", [
      { id: "a", displayName: "上", type: "card", bounds: { x: 0, y: 0, w: 375, h: 100.5 }, confidence: 1, scrollX: false, scrollY: false },
      { id: "b", displayName: "下", type: "card", bounds: { x: 0, y: 100.5, w: 375, h: 499.5 }, confidence: 1, scrollX: false, scrollY: false },
    ])).toThrow();
  });
});

describe("element trees", () => {
  const region = { x: 0, y: 100, w: 375, h: 200 };
  const seeded = () => {
    const store = freshStore();
    store.writeDoc("p1", doc());
    return store;
  };
  const tree = (nodes: ElementNode[]): ElementTree =>
    ({ regionKey: regionKey(region), detectedAt: "2026-08-13T00:00:00.000Z", nodes });
  const root: ElementNode = {
    id: "n1", parentId: null, box: { x: 0, y: 100, w: 375, h: 200 },
    kind: "component", displayName: "根", style: {}, uniformity: 1,
    source: "auto", classification: "tool",
    scrollX: false, scrollY: false, positioning: "flow",
  };

  it("returns null before anything has been detected", () => {
    expect(seeded().readElementTree("p1", regionKey(region))).toBeNull();
  });

  it("round trips a tree", () => {
    const store = seeded();
    store.writeElementTree("p1", tree([root]), region);
    expect(store.readElementTree("p1", regionKey(region))!.nodes).toHaveLength(1);
  });

  it("replaces the tree for the same region key", () => {
    const store = seeded();
    store.writeElementTree("p1", tree([root]), region);
    store.writeElementTree("p1", tree([{ ...root, displayName: "改过" }]), region);
    const stored = store.readElements("p1");
    expect(stored.trees).toHaveLength(1);
    expect(stored.trees[0]!.nodes[0]!.displayName).toBe("改过");
  });

  it("keeps trees for different regions side by side", () => {
    const store = seeded();
    const other = { x: 0, y: 300, w: 375, h: 100 };
    store.writeElementTree("p1", tree([root]), region);
    store.writeElementTree("p1", {
      regionKey: regionKey(other), detectedAt: "2026-08-13T00:00:00.000Z",
      nodes: [{ ...root, box: { x: 0, y: 300, w: 375, h: 100 } }],
    }, other);
    expect(store.readElements("p1").trees).toHaveLength(2);
  });

  it("refuses a tree that violates an invariant", () => {
    const store = seeded();
    expect(() => store.writeElementTree(
      "p1", tree([{ ...root, box: { x: 0, y: 100, w: 375, h: 900 } }]), region,
    )).toThrow(/invariant/);
  });
});
