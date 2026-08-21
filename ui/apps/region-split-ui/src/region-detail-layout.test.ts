import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "region-split:detail-layout";

async function loadModule() {
  vi.resetModules();
  return import("./region-detail-layout.js");
}

describe("region detail layout", () => {
  beforeEach(() => localStorage.clear());

  it("creates an independent draft from the default template", async () => {
    const { createRegionDetailLayout, DEFAULT_REGION_DETAIL_LAYOUT } = await loadModule();
    const first = createRegionDetailLayout(localStorage);
    const second = createRegionDetailLayout(localStorage);
    expect(first).toEqual({ width: 1280, height: 600, tree: 40, ai: 20, inspectorHeight: 240 });
    expect(first).not.toBe(second);
    first.tree = 31;
    expect(second).toEqual(DEFAULT_REGION_DETAIL_LAYOUT);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("migrates valid old proportions and fills new size fields", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ image: 58, tree: 41, ai: 19 }));
    const { createRegionDetailLayout } = await loadModule();
    expect(createRegionDetailLayout(localStorage)).toEqual({
      width: 1280, height: 600, tree: 41, ai: 19, inspectorHeight: 240,
    });
  });

  it("clamps frame, columns, and inspector dimensions", async () => {
    const { normalizeRegionDetailLayout } = await loadModule();
    expect(normalizeRegionDetailLayout({ width: 200, height: 100, tree: 90, ai: 50, inspectorHeight: 20 }))
      .toEqual({ width: 760, height: 480, tree: 55, ai: 30, inspectorHeight: 160 });
  });

  it("only persists when explicitly saved and new drafts use the saved template", async () => {
    const { createRegionDetailLayout, saveRegionDetailLayout } = await loadModule();
    const existing = createRegionDetailLayout(localStorage);
    existing.width = 1450;
    existing.height = 720;
    existing.tree = 35;
    existing.ai = 25;
    existing.inspectorHeight = 280;
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    saveRegionDetailLayout(localStorage, existing);
    const fresh = createRegionDetailLayout(localStorage);
    expect(fresh).toEqual(existing);
    existing.tree = 30;
    expect(fresh.tree).toBe(35);
  });
});
