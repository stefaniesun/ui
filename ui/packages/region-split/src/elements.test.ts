import { describe, expect, it } from "vitest";
import {
  addElement, changeElementType, deleteElementTree, moveElementTree,
  reconcileElementsWithRegions, renameElement, reparentElement, resizeElement,
} from "./elements.js";
import type { ElementNode, RegionSplitDoc } from "./types.js";

const element = (id: string, parentId: string | null, x: number, y: number, w: number, h: number): ElementNode => ({
  id, parentId, regionId: "a", displayName: id, type: parentId ? "text" : "container",
  bounds: { x, y, w, h }, confidence: 0.9, conflict: false, source: "ai",
});
const doc = (): RegionSplitDoc => ({
  schemaVersion: "2", revision: 0,
  image: { fileName: "x.png", width: 100, height: 200, analyzedScale: 1, removedChrome: [] },
  regions: [
    { id: "a", displayName: "A", type: "card", bounds: { x: 0, y: 0, w: 100, h: 100 }, confidence: 1, scrollX: false, scrollY: false },
    { id: "b", displayName: "B", type: "card", bounds: { x: 0, y: 100, w: 100, h: 100 }, confidence: 1, scrollX: false, scrollY: false },
  ],
  elements: [element("card", null, 10, 20, 60, 60), element("title", "card", 20, 30, 30, 10)],
  elementAnalysis: {}, candidateLines: [], panels: [], updatedAt: "now",
});
const byId = (value: RegionSplitDoc, id: string) => value.elements.find(item => item.id === id)!;

describe("element tree operations", () => {
  it("moves a parent and descendants together", () => {
    const result = moveElementTree(doc(), "card", 5, 7);
    expect(byId(result, "card").bounds).toMatchObject({ x: 15, y: 27 });
    expect(byId(result, "title").bounds).toMatchObject({ x: 25, y: 37 });
  });
  it("rejects shrinking a parent across a child", () => {
    expect(() => resizeElement(doc(), "card", { x: 10, y: 20, w: 20, h: 20 })).toThrow();
  });
  it("deletes the complete subtree", () => {
    expect(deleteElementTree(doc(), "card").elements).toEqual([]);
  });
  it("rejects a reparenting cycle", () => {
    expect(() => reparentElement(doc(), "card", "title")).toThrow();
  });
  it("supports add, rename, type and resize", () => {
    const added = addElement(doc(), element("new", null, 1, 1, 10, 10));
    const renamed = renameElement(added, "new", "按钮");
    const typed = changeElementType(renamed, "new", "button");
    const resized = resizeElement(typed, "new", { x: 2, y: 2, w: 12, h: 12 });
    expect(byId(resized, "new")).toMatchObject({ displayName: "按钮", type: "button", bounds: { x: 2, y: 2, w: 12, h: 12 } });
  });
  it("reassigns contained elements and marks boundary crossings", () => {
    const elements = [element("contained", null, 10, 110, 20, 20), element("crossing", null, 10, 90, 20, 20)];
    const result = reconcileElementsWithRegions(elements, doc().regions, doc().image);
    expect(result[0]).toMatchObject({ regionId: "b", conflict: false });
    expect(result[1]).toMatchObject({ regionId: "a", conflict: true });
  });
});
