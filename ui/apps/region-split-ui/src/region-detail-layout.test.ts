import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "region-split:detail-layout";

async function loadModule() {
  vi.resetModules();
  return import("./region-detail-layout.js");
}

describe("region detail layout", () => {
  beforeEach(() => localStorage.clear());

  it("uses the agreed default proportions", async () => {
    const { regionDetailLayout } = await loadModule();
    expect(regionDetailLayout.value).toEqual({ image: 65, tree: 36, ai: 28 });
  });

  it("loads valid saved proportions and ignores invalid data", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ image: 58, tree: 31, ai: 26 }));
    const loaded = await loadModule();
    expect(loaded.regionDetailLayout.value).toEqual({ image: 58, tree: 31, ai: 26 });

    localStorage.setItem(STORAGE_KEY, "not-json");
    const invalid = await loadModule();
    expect(invalid.regionDetailLayout.value).toEqual({ image: 65, tree: 36, ai: 28 });
  });

  it("clamps values and keeps tree and property at least 15 percent", async () => {
    const { regionDetailLayout, setRegionDetailLayout } = await loadModule();
    setRegionDetailLayout({ image: 90, ai: 50, tree: 80 });
    expect(regionDetailLayout.value).toEqual({ image: 80, ai: 45, tree: 40 });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(regionDetailLayout.value);
  });

  it("resets the shared proportions", async () => {
    const { regionDetailLayout, setRegionDetailLayout, resetRegionDetailLayout } = await loadModule();
    setRegionDetailLayout({ image: 52, tree: 30, ai: 25 });
    resetRegionDetailLayout();
    expect(regionDetailLayout.value).toEqual({ image: 65, tree: 36, ai: 28 });
  });
});
