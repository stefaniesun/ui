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
    const good = { getItem: () => JSON.stringify({ workspace: { x: 10, y: 20 } }) };
    expect(loadNodePositions(good, "nodes", DEFAULT_NODE_POSITIONS).workspace).toEqual({ x: 10, y: 20 });
    const bad = { getItem: () => "{" };
    expect(loadNodePositions(bad, "nodes", DEFAULT_NODE_POSITIONS)).toEqual(DEFAULT_NODE_POSITIONS);
  });

  it("ignores storage write failures", () => {
    expect(() => saveNodePositions({ setItem: () => { throw new Error("quota"); } }, "nodes", DEFAULT_NODE_POSITIONS))
      .not.toThrow();
  });
});

describe("two node positions", () => {
  it("places the detail node to the right of the workspace", () => {
    expect(DEFAULT_NODE_POSITIONS.detail.x)
      .toBeGreaterThan(DEFAULT_NODE_POSITIONS.workspace.x);
  });

  // 旧的 v2 存档只有 workspace，必须能正常载入并给新节点用缺省位置，
  // 所以不需要提升 storage key 的版本号——升了反而会丢掉用户摆好的位置
  it("falls back for a node missing from an older payload", () => {
    const storage = { getItem: () => JSON.stringify({ workspace: { x: 5, y: 6 } }) };
    const loaded = loadNodePositions(storage, "nodes", DEFAULT_NODE_POSITIONS);
    expect(loaded.workspace).toEqual({ x: 5, y: 6 });
    expect(loaded.detail).toEqual(DEFAULT_NODE_POSITIONS.detail);
  });

  it("round trips both node positions", () => {
    const written: Record<string, string> = {};
    const positions = { workspace: { x: 1, y: 2 }, detail: { x: 3, y: 4 } };
    saveNodePositions({ setItem: (k, v) => { written[k] = v; } }, "nodes", positions);
    const loaded = loadNodePositions(
      { getItem: (k: string) => written[k] ?? null }, "nodes", DEFAULT_NODE_POSITIONS);
    expect(loaded).toEqual(positions);
  });
});
