import { describe, expect, it } from "vitest";
import { rectContains, rectIntersects, unionRects } from "./geometry.js";

describe("geometry", () => {
  it("detects overlap but not touching edges", () => {
    expect(rectIntersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(rectIntersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
  });

  it("contains rectangles inclusively", () => {
    expect(rectContains({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 })).toBe(true);
    expect(rectContains({ x: 0, y: 0, w: 10, h: 10 }, { x: 1, y: 1, w: 10, h: 10 })).toBe(false);
  });

  it("unions rectangles into their bounding box", () => {
    expect(unionRects([{ x: 0, y: 0, w: 2, h: 2 }, { x: 4, y: 4, w: 2, h: 2 }]))
      .toEqual({ x: 0, y: 0, w: 6, h: 6 });
  });

  it("rejects an empty union", () => {
    expect(() => unionRects([])).toThrow("empty input");
  });
});
