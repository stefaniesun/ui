import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIEW,
  fitView,
  keepViewportCenter,
  revealRect,
  zoomAt,
} from "./infinite-canvas-view.js";

describe("infinite canvas view math", () => {
  it("fits and centers the whole stage with padding", () => {
    const view = fitView({ width: 1200, height: 800 }, { width: 1000, height: 600 }, 40);
    expect(view.scale).toBeCloseTo(1.12);
    expect(view.x).toBeCloseTo(40);
    expect(view.y).toBeCloseTo(64);
  });

  it("clamps a fitted view to the supported zoom range", () => {
    expect(fitView({ width: 5000, height: 5000 }, { width: 100, height: 100 }, 0)).toEqual({
      scale: 4,
      x: 2300,
      y: 2300,
    });
    expect(fitView({ width: 100, height: 100 }, { width: 5000, height: 5000 }, 0)).toEqual({
      scale: 0.2,
      x: -450,
      y: -450,
    });
  });

  it("falls back to the default view when dimensions are invalid", () => {
    expect(fitView({ width: 0, height: 600 }, { width: 1000, height: 600 }, 40)).toEqual(DEFAULT_VIEW);
    expect(fitView({ width: 1200, height: 800 }, { width: Number.NaN, height: 600 }, 40)).toEqual(DEFAULT_VIEW);
  });

  it("zooms around a viewport anchor", () => {
    expect(zoomAt({ scale: 1, x: 100, y: 50 }, 2, { x: 300, y: 250 })).toEqual({
      scale: 2,
      x: -100,
      y: -150,
    });
  });

  it("clamps zoom and falls back safely for non-finite input", () => {
    expect(zoomAt(DEFAULT_VIEW, 10, { x: 0, y: 0 }).scale).toBe(4);
    expect(zoomAt(DEFAULT_VIEW, 0.01, { x: 0, y: 0 }).scale).toBe(0.2);
    expect(zoomAt(DEFAULT_VIEW, Number.NaN, { x: 10, y: 10 })).toEqual(DEFAULT_VIEW);
    expect(zoomAt({ scale: 1, x: Number.NaN, y: 0 }, 2, { x: 10, y: 10 })).toEqual(DEFAULT_VIEW);
  });

  it("keeps the same stage point under the viewport center after resizing", () => {
    expect(keepViewportCenter(
      { scale: 1, x: 100, y: 50 },
      { width: 800, height: 600 },
      { width: 1000, height: 700 },
    )).toEqual({ scale: 1, x: 200, y: 100 });
  });

  it("moves only enough to reveal a hidden target while preserving scale", () => {
    expect(revealRect(
      { scale: 2, x: -100, y: -100 },
      { width: 600, height: 400 },
      { x: 400, y: 250, width: 100, height: 50 },
      24,
    )).toEqual({ scale: 2, x: -424, y: -224 });
  });

  it("does not move an already visible target", () => {
    const view = { scale: 1, x: 20, y: 30 };
    expect(revealRect(view, { width: 800, height: 600 }, { x: 100, y: 100, width: 80, height: 40 }, 24)).toEqual(view);
  });

  it("falls back from an invalid view without preserving non-finite coordinates", () => {
    expect(revealRect(
      { scale: 1, x: Number.NaN, y: 0 },
      { width: 800, height: 600 },
      { x: 100, y: 100, width: 80, height: 40 },
      24,
    )).toEqual(DEFAULT_VIEW);
  });

  it("stably centers a target that cannot fit inside the padded viewport", () => {
    const viewport = { width: 600, height: 400 };
    const target = { x: 0, y: 0, width: 1000, height: 600 };
    const revealed = revealRect(DEFAULT_VIEW, viewport, target, 24);
    expect(revealed).toEqual({ scale: 1, x: -200, y: -100 });
    expect(revealRect(revealed, viewport, target, 24)).toEqual(revealed);
  });
});
