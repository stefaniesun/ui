import { describe, expect, it } from "vitest";
import {
  DEFAULT_NODE_POSITIONS,
  clampZoom,
  fitBounds,
  loadNodePositions,
  saveNodePositions,
  zoomAtPoint,
} from "./canvas-state.js";

describe("canvas state", () => {
  it("clamps zoom to the supported range", () => {
    expect(clampZoom(0.01)).toBe(0.2);
    expect(clampZoom(4)).toBe(3);
    expect(clampZoom(1.25)).toBe(1.25);
  });

  it("keeps the flow point under the cursor while zooming", () => {
    expect(zoomAtPoint({ x: 100, y: 50, zoom: 1 }, 2, { x: 300, y: 250 }))
      .toEqual({ x: -100, y: -150, zoom: 2 });
  });

  it("fits bounds into the available viewport", () => {
    expect(fitBounds({ x: 100, y: 50, width: 1000, height: 500 }, { width: 800, height: 600 }, 50))
      .toEqual({ x: -20, y: 90, zoom: 0.7 });
  });

  it("loads persisted positions and safely falls back on malformed storage", () => {
    const good = { getItem: () => JSON.stringify({ source: { x: 10, y: 20 } }) };
    expect(loadNodePositions(good, "nodes", DEFAULT_NODE_POSITIONS).source).toEqual({ x: 10, y: 20 });
    const bad = { getItem: () => "{" };
    expect(loadNodePositions(bad, "nodes", DEFAULT_NODE_POSITIONS)).toEqual(DEFAULT_NODE_POSITIONS);
  });

  it("ignores storage write failures", () => {
    expect(() => saveNodePositions({ setItem: () => { throw new Error("quota"); } }, "nodes", DEFAULT_NODE_POSITIONS))
      .not.toThrow();
  });
});
