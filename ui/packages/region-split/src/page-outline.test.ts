import { describe, expect, it } from "vitest";
import type { ElementNode, ElementTree } from "./element-types.js";
import { buildPageOutline, isSuspiciousElement, pageElementId, parsePageElementId, patchElementTree } from "./page-outline.js";
import type { RegionSplitDoc } from "./types.js";

const baseNode = (overrides: Partial<ElementNode> = {}): ElementNode => ({
  id: "same", parentId: null, box: { x: 10, y: 10, w: 40, h: 20 }, kind: "text",
  displayName: "标题", text: "旧文字", style: { color: "#111111", fontSize: 14 }, uniformity: 1,
  source: "auto", classification: "tool", scrollX: false, scrollY: false, positioning: "flow", ...overrides,
});
const doc: RegionSplitDoc = {
  schemaVersion: "1", image: { fileName: "page.png", width: 375, height: 400, analyzedScale: 1, removedChrome: [] },
  regions: [
    { id: "a", displayName: "顶部", bounds: { x: 0, y: 0, w: 375, h: 200 }, confidence: 1, scrollX: false, scrollY: false },
    { id: "b", displayName: "底部", bounds: { x: 0, y: 200, w: 375, h: 200 }, confidence: 1, scrollX: false, scrollY: false },
  ], candidateLines: [], panels: [], updatedAt: "now",
};
const tree = (regionKey: string, nodes: ElementNode[]): ElementTree => ({ regionKey, detectedAt: "now", nodes });

describe("whole-page outline", () => {
  it("prefixes duplicate local ids and parent hints with stable region keys", () => {
    const outline = buildPageOutline(doc, [
      tree("0-200", [baseNode(), baseNode({ id: "child", parentId: "same" })]),
      tree("200-400", [baseNode()]),
    ]);
    expect(outline.elements.map(node => node.id)).toEqual(["0-200::same", "0-200::child", "200-400::same"]);
    expect(outline.elements[1]?.parentHint).toBe("0-200::same");
    expect(outline.elements.map(node => node.outlineNumber)).toEqual(["1.1", "1.1.1", "2.1"]);
    expect(outline.elements.map(node => node.depth)).toEqual([0, 1, 0]);
    expect(outline.elements[0]).toMatchObject({ text: "旧文字", style: { color: "#111111", fontSize: 14 }, box: { x: 10, y: 10, w: 40, h: 20 } });
  });

  it("lists missing and failed regions while preserving parsed regions", () => {
    const outline = buildPageOutline(doc, [tree("0-200", [baseNode()])], { "200-400": "model offline" });
    expect(outline.regions.map(region => [region.regionKey, region.status])).toEqual([["0-200", "parsed"], ["200-400", "failed"]]);
    expect(outline.regions[1]?.error).toBe("model offline");
  });

  it("marks only explicit uncertainty, invalid text boxes and ambiguous icons suspicious", () => {
    expect(isSuspiciousElement(baseNode())).toBe(false);
    expect(isSuspiciousElement(baseNode({ classification: "uncertain" }))).toBe(true);
    expect(isSuspiciousElement(baseNode({ textBox: { ok: false, bands: 2, glyphAspect: 1, reason: "multi-band" } }))).toBe(true);
    expect(isSuspiciousElement(baseNode({ kind: "icon", iconDecision: { kind: "ambiguous", query: "chat", candidates: [] } }))).toBe(true);
  });

  it("round-trips global ids and patches only classification, text and box", () => {
    expect(parsePageElementId(pageElementId("0-200", "title"))).toEqual({ regionKey: "0-200", localId: "title" });
    const original = tree("0-200", [baseNode({ id: "title", textBox: { ok: true, bands: 1, glyphAspect: 1 } })]);
    const patched = patchElementTree(original, doc.regions[0]!.bounds, "title", {
      kind: "image", text: "新文字", box: { x: 12, y: 14, w: 50, h: 24 },
    });
    expect(patched.nodes[0]).toMatchObject({ kind: "image", classification: "human", text: "新文字", box: { x: 12, y: 14, w: 50, h: 24 } });
    expect(patched.nodes[0]?.textBox).toBeUndefined();
  });
});
