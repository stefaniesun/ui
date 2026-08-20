import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "region-split:detail-layout";

async function loadModule() {
  vi.resetModules();
  return import("./region-detail-layout.js");
}

describe("region detail layout", () => {
  beforeEach(() => localStorage.clear());

  it("uses the narrower AI default proportions", async () => {
    const { regionDetailLayout } = await loadModule();
    expect(regionDetailLayout.value).toEqual({ tree: 40, ai: 20 });
  });

  it("migrates valid saved proportions and ignores obsolete image height", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ image: 58, tree: 41, ai: 19 }));
    const loaded = await loadModule();
    expect(loaded.regionDetailLayout.value).toEqual({ tree: 41, ai: 19 });

    localStorage.setItem(STORAGE_KEY, "not-json");
    const invalid = await loadModule();
    expect(invalid.regionDetailLayout.value).toEqual({ tree: 40, ai: 20 });
  });

  it("clamps AI to 15–30 and keeps tree and property at least 15 percent", async () => {
    const { regionDetailLayout, setRegionDetailLayout } = await loadModule();
    setRegionDetailLayout({ ai: 50, tree: 80 });
    expect(regionDetailLayout.value).toEqual({ ai: 30, tree: 55 });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(regionDetailLayout.value);
  });

  it("resets the shared proportions", async () => {
    const { regionDetailLayout, setRegionDetailLayout, resetRegionDetailLayout } = await loadModule();
    setRegionDetailLayout({ tree: 30, ai: 25 });
    resetRegionDetailLayout();
    expect(regionDetailLayout.value).toEqual({ tree: 40, ai: 20 });
  });
});
