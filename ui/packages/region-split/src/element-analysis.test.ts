import { describe, expect, it } from "vitest";
import { analyzeRegionElements, elementInputFingerprint, normalizeElementResponse } from "./element-analysis.js";
import type { RawElement } from "./model.js";
import type { Region } from "./types.js";
const region: Region = { id: "a", displayName: "A", type: "card", bounds: { x: 0, y: 100, w: 100, h: 100 }, confidence: 1, scrollX: false, scrollY: false };
const raw = (value: Partial<RawElement> = {}): RawElement => ({ id: "x", parentId: null, displayName: "X", type: "button", x: 8, y: 12, width: 40, height: 20, confidence: 0.9, ...value });
describe("element analysis", () => {
  it("converts crop coordinates to original coordinates", () => {
    expect(normalizeElementResponse(region, [raw()])[0]?.bounds).toEqual({ x: 8, y: 112, w: 40, h: 20 });
  });
  it("drops tiny elements after clipping", () => expect(normalizeElementResponse(region, [raw({ x: -5, width: 7 })])).toEqual([]));
  it("changes fingerprint with region input", () => expect(elementInputFingerprint(region, "v")).not.toBe(elementInputFingerprint({ ...region, displayName: "B" }, "v")));
  it("limits concurrency and isolates failures", async () => {
    let active = 0; let maximum = 0;
    const regions = Array.from({ length: 6 }, (_, index) => ({ ...region, id: String(index) }));
    const result = await analyzeRegionElements(regions, async item => { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 5)); active--; if (item.id === "2") throw new Error("bad"); return item.id; });
    expect(maximum).toBe(3); expect(result.get("2")?.ok).toBe(false); expect(result.get("3")?.ok).toBe(true);
  });
});
