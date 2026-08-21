import type { PageOutline } from "@region-split/core/browser";
import { describe, expect, it, vi } from "vitest";
import type { StoreApi } from "./api";
import { createPageOutlineState } from "./page-outline-state";

const makeFakeApi = (): StoreApi => ({
  upload: vi.fn(), getProject: vi.fn(), putRegions: vi.fn(), analyze: vi.fn(), renameAi: vi.fn(),
  getModelConfig: vi.fn(), getElements: vi.fn(), getParsedRegions: vi.fn(), putFontStack: vi.fn(),
  searchIcons: vi.fn(), getAnalysisStats: vi.fn(), getPageCode: vi.fn(), getPageOutline: vi.fn(),
  detectAllElements: vi.fn(), patchPageElement: vi.fn(), detectElements: vi.fn(), putElements: vi.fn(),
});

const outline: PageOutline = {
  image: { fileName: "page.png", width: 375, height: 800 }, designWidth: 375,
  regions: [], suspiciousCount: 0,
  elements: [{
    id: "0-800::title", localId: "title", regionKey: "0-800", regionName: "页面", parentHint: null,
    outlineNumber: "1.1", depth: 0, suspicious: false, box: { x: 10, y: 10, w: 100, h: 30 }, kind: "text",
    displayName: "标题", text: "旧", style: {}, uniformity: 1, source: "auto", classification: "tool",
    scrollX: false, scrollY: false, positioning: "flow",
  }],
};

describe("page outline state", () => {
  it("runs all regions, reports progress and loads the outline", async () => {
    const api = makeFakeApi();
    vi.mocked(api.detectAllElements).mockResolvedValue({ total: 3, completed: 2, skipped: 1, failed: 0, failedRegionKeys: [] });
    vi.mocked(api.getPageOutline).mockResolvedValue(outline);
    const state = createPageOutlineState(api);
    await state.analyzeAll("p1");
    expect(api.detectAllElements).toHaveBeenCalledWith("p1", false);
    expect(state.progressText.value).toBe("已完成 3/3");
    expect(state.outline.value).toEqual(outline);
  });

  it("loads the current outline before waiting for unfinished regions", async () => {
    const api = makeFakeApi();
    let finishDetection!: (result: { total: number; completed: number; skipped: number; failed: number; failedRegionKeys: string[] }) => void;
    vi.mocked(api.detectAllElements).mockImplementation(() => new Promise(resolve => { finishDetection = resolve; }));
    vi.mocked(api.getPageOutline).mockResolvedValue(outline);
    const state = createPageOutlineState(api);

    const running = state.analyzeAll("p1");
    await vi.waitFor(() => expect(state.outline.value).toEqual(outline));
    expect(state.busy.value).toBe(true);

    finishDetection({ total: 3, completed: 2, skipped: 1, failed: 0, failedRegionKeys: [] });
    await running;
  });

  it("can retry failed regions and rolls a rejected patch back", async () => {
    const api = makeFakeApi();
    vi.mocked(api.detectAllElements).mockResolvedValue({ total: 3, completed: 1, skipped: 2, failed: 0, failedRegionKeys: [] });
    vi.mocked(api.getPageOutline).mockResolvedValue(outline);
    const state = createPageOutlineState(api);
    await state.analyzeAll("p1", true);
    expect(api.detectAllElements).toHaveBeenCalledWith("p1", true);
    state.outline.value = outline;
    vi.mocked(api.patchPageElement).mockRejectedValue(new Error("保存失败"));
    await expect(state.patch("p1", "0-800::title", { text: "新" })).rejects.toThrow("保存失败");
    expect(state.outline.value?.elements[0]?.text).toBe("旧");
    expect(state.error.value).toBe("保存失败");
  });
});
