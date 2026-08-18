import { describe, expect, it } from "vitest";
import { REGION_COLORS, regionColor, regionSoftColor } from "./region-visual.js";

describe("region visual colors", () => {
  it("returns a stable color for one id", () => {
    expect(regionColor("hero")).toBe(regionColor("hero"));
  });

  it("gives common neighboring ids different colors", () => {
    expect(new Set(["r1", "r2", "r3", "r4"].map(regionColor)).size).toBe(4);
  });

  it("returns the theme accent for an empty id", () => {
    expect(regionColor("")).toBe("var(--accent)");
  });

  it("builds a transparent fill from the assigned palette entry", () => {
    expect(regionSoftColor("hero")).toMatch(/^#[0-9a-f]{8}$/i);
    expect(REGION_COLORS.length).toBeGreaterThanOrEqual(12);
  });
});
