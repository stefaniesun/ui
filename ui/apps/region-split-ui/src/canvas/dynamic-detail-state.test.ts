import { describe, expect, it } from "vitest";
import {
  centerNodeViewport,
  detailNodeId,
  loadDetailPositions,
  nextDetailPosition,
  saveDetailPositions,
  screenPointToWorld,
} from "./dynamic-detail-state.js";

describe("dynamic detail state", () => {
  it("builds stable detail ids", () => {
    expect(detailNodeId("hero")).toBe("detail:hero");
  });

  it("converts a row anchor into world coordinates", () => {
    expect(screenPointToWorld(
      { x: 530, y: 340 },
      { left: 10, top: 20 },
      { x: 100, y: 40, zoom: 2 },
    )).toEqual({ x: 210, y: 140 });
  });

  it("ignores malformed and unknown persisted positions", () => {
    const storage = {
      getItem: () => JSON.stringify({
        kept: { x: 3, y: 4 },
        gone: { x: 8, y: 9 },
        bad: { x: "x", y: 1 },
      }),
    };
    expect(loadDetailPositions(storage, "key", new Set(["kept", "bad"])))
      .toEqual({ kept: { x: 3, y: 4 } });
    expect(loadDetailPositions({ getItem: () => "{" }, "key", new Set(["kept"]))).toEqual({});
  });

  it("ignores storage write failures", () => {
    expect(() => saveDetailPositions(
      { setItem: () => { throw new Error("quota"); } },
      "key",
      { hero: { x: 1, y: 2 } },
    )).not.toThrow();
  });

  it("places details to the right and wraps into another column", () => {
    const workspace = { x: 120, y: 80, width: 1105, height: 700 };
    const size = { width: 760, height: 600 };
    expect(nextDetailPosition(workspace, [], size, 1500)).toEqual({ x: 1345, y: 80 });
    expect(nextDetailPosition(
      workspace,
      [{ x: 1345, y: 80, width: 760, height: 600 }],
      size,
      1200,
    )).toEqual({ x: 2185, y: 80 });
  });

  it("centers a node without changing zoom", () => {
    expect(centerNodeViewport(
      { x: 1000, y: 500, width: 760, height: 600 },
      { width: 1200, height: 800 },
      0.8,
    )).toEqual({ x: -504, y: -240, zoom: 0.8 });
  });
});
