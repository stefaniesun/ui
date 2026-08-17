import { describe, expect, it } from "vitest";
import {
  DEFAULT_NODE_POSITIONS,
  bezierPath,
  clampZoom,
  fitBounds,
  loadNodePositions,
  portAnchors,
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

describe("端口与连线", () => {
  it("defaults the code node to the right of the detail node", () => {
    expect(DEFAULT_NODE_POSITIONS.code.x).toBeGreaterThan(DEFAULT_NODE_POSITIONS.detail.x);
  });
  it("anchors ports on the node edges at the header line", () => {
    const [first] = portAnchors(
      { workspace: { x: 0, y: 0 }, detail: { x: 500, y: 40 }, code: { x: 1000, y: 80 } },
      { workspace: 400, detail: 300, code: 300 },
    );
    expect(first).toEqual({ from: { x: 400, y: 21 }, to: { x: 500, y: 61 } });
  });
  it("links workspace to detail and detail to code", () => {
    expect(portAnchors(
      { workspace: { x: 0, y: 0 }, detail: { x: 500, y: 0 }, code: { x: 1000, y: 0 } },
      { workspace: 400, detail: 300, code: 300 },
    )).toHaveLength(2);
  });
  it("draws cubic curves with horizontal handles", () => {
    expect(bezierPath({ x: 0, y: 0 }, { x: 200, y: 100 })).toBe("M 0 0 C 100 0, 100 100, 200 100");
    expect(bezierPath({ x: 0, y: 0 }, { x: 20, y: 0 })).toBe("M 0 0 C 60 0, -40 0, 20 0");
  });
});

describe("three node positions", () => {
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
    expect(loaded.code).toEqual(DEFAULT_NODE_POSITIONS.code);
  });

  it("round trips all node positions", () => {
    const written: Record<string, string> = {};
    const positions = { workspace: { x: 1, y: 2 }, detail: { x: 3, y: 4 }, code: { x: 5, y: 6 } };
    saveNodePositions({ setItem: (k, v) => { written[k] = v; } }, "nodes", positions);
    const loaded = loadNodePositions(
      { getItem: (k: string) => written[k] ?? null }, "nodes", DEFAULT_NODE_POSITIONS);
    expect(loaded).toEqual(positions);
  });
});
