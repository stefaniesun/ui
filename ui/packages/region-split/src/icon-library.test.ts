import { describe, expect, it } from "vitest";
import { iconById, iconToSvg, searchIcons } from "./icon-library.js";

describe("searchIcons", () => {
  it("searches the local MDI set without its prefix", () => {
    const candidates = searchIcons("home", 8);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]?.id).toBe("mdi:home");
    expect(candidates.every(candidate => candidate.id.startsWith("mdi:"))).toBe(true);
  });

  it("orders exact matches before prefix and substring matches", () => {
    const ids = searchIcons("account", 500).map(candidate => candidate.id);
    expect(ids[0]).toBe("mdi:account");
    expect(ids.findIndex(id => id === "mdi:account-box")).toBeLessThan(
      ids.findIndex(id => id === "mdi:shield-account"),
    );
  });

  it("resolves aliases and renders a standalone SVG", () => {
    const icon = iconById("mdi:home");
    expect(icon).not.toBeNull();
    expect(iconToSvg(icon!)).toMatch(/^<svg[^>]+viewBox="0 0 24 24"/);
  });
});
