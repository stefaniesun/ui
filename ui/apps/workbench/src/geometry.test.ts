import { describe, expect, it } from "vitest";
import { dragRect, screenToLogical } from "./geometry.js";
describe("canvas geometry", () => {
  it("maps CSS-scaled coordinates to logical pixels", () => expect(screenToLogical(110, 220, { left: 10, top: 20, width: 187.5 } as DOMRect, 375)).toEqual({ x: 200, y: 400 }));
  it("normalizes reverse drags", () => expect(dragRect({ x: 20, y: 30 }, { x: 5, y: 10 })).toEqual({ x: 5, y: 10, w: 15, h: 20 }));
});
