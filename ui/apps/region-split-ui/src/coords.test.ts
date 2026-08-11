import { describe, expect, it } from "vitest";
import { snapToCandidates, toImageY } from "./coords.js";

describe("toImageY", () => {
  it("converts a client y into image pixels", () => {
    expect(toImageY(320, 100, 0.5)).toBe(440);
    expect(toImageY(150, 100, 1)).toBe(50);
  });
});

describe("snapToCandidates", () => {
  const lines = [{ y: 100, strength: 0.5 }, { y: 104, strength: 0.9 }, { y: 400, strength: 1 }];
  it("snaps to the strongest line inside the threshold", () => {
    expect(snapToCandidates(101, lines, 12)).toEqual({ y: 104, snapped: true });
  });
  it("keeps the value when nothing is close enough", () => {
    expect(snapToCandidates(200, lines, 12)).toEqual({ y: 200, snapped: false });
  });
  it("prefers the nearer line when strengths tie", () => {
    const tied = [{ y: 90, strength: 0.7 }, { y: 98, strength: 0.7 }];
    expect(snapToCandidates(100, tied, 12)).toEqual({ y: 98, snapped: true });
  });
});
