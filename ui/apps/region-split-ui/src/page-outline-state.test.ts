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

const region = (regionKey: string, status: "parsed" | "missing" | "failed") => ({
  regionKey, displayName: `区域 ${regionKey}`, status,
  bounds: { x: 0, y: 0, w: 375, h: 100 },
});
const outlineWith = (regions: PageOutline["regions"]): PageOutline => ({ ...outline, regions });

describe("page outline state", () => {
  // 整轮要一分多钟（实测单区域约 7 秒）。一个请求跑完只能在结束时报进度，
  // 那段时间界面一动不动，看起来像卡死——所以逐区域跑，每完成一个就刷新。
  it("detects one region at a time and skips the parsed ones", async () => {
    const api = makeFakeApi();
    vi.mocked(api.getPageOutline).mockResolvedValue(
      outlineWith([region("0-100", "parsed"), region("100-200", "missing"), region("200-300", "missing")]));
    const state = createPageOutlineState(api);

    await state.analyzeAll("p1");

    expect(api.detectAllElements).not.toHaveBeenCalled();
    expect(api.detectElements).toHaveBeenCalledTimes(2);
    expect(state.progress.value).toMatchObject({ total: 3, completed: 2, skipped: 1, failed: 0 });
  });

  // 刷新轮廓的次数说明进度是逐步可见的，而不是最后一次性出现
  it("refreshes the outline after every region", async () => {
    const api = makeFakeApi();
    vi.mocked(api.getPageOutline).mockResolvedValue(
      outlineWith([region("0-100", "missing"), region("100-200", "missing")]));
    const state = createPageOutlineState(api);

    await state.analyzeAll("p1");

    // 开跑前一次，之后每个区域各一次
    expect(vi.mocked(api.getPageOutline).mock.calls.length).toBe(3);
    expect(state.outline.value?.elements[0]?.text).toBe("旧");
  });

  // 单个区域失败不该中断整轮：其余照常跑完，失败的那块单独标出来
  it("keeps going when one region fails", async () => {
    const api = makeFakeApi();
    vi.mocked(api.getPageOutline).mockResolvedValue(
      outlineWith([region("0-100", "missing"), region("100-200", "missing")]));
    vi.mocked(api.detectElements)
      .mockRejectedValueOnce(new Error("模型超时"))
      .mockResolvedValueOnce({ tree: {} as never });
    const state = createPageOutlineState(api);

    await state.analyzeAll("p1");

    expect(api.detectElements).toHaveBeenCalledTimes(2);
    expect(state.progress.value).toMatchObject({ completed: 1, failed: 1, failedRegionKeys: ["0-100"] });
    expect(state.busy.value).toBe(false);
  });

  // 正常跑只补未解析的；重跑要把失败的那些也带上
  it("retries the failed regions too", async () => {
    const api = makeFakeApi();
    vi.mocked(api.getPageOutline).mockResolvedValue(
      outlineWith([region("0-100", "parsed"), region("100-200", "failed")]));
    const state = createPageOutlineState(api);

    await state.analyzeAll("p1");
    expect(api.detectElements).not.toHaveBeenCalled();

    await state.analyzeAll("p1", true);
    expect(api.detectElements).toHaveBeenCalledTimes(1);
  });

  it("serializes consecutive patches so an older response cannot overwrite a newer one", async () => {
    const api = makeFakeApi();
    const state = createPageOutlineState(api);
    state.outline.value = outline;
    let finishFirst!: (value: PageOutline) => void;
    const first = new Promise<PageOutline>(resolve => { finishFirst = resolve; });
    vi.mocked(api.patchPageElement)
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({ ...outline, elements: outline.elements.map(element => ({ ...element, text: "最新" })) });

    const older = state.patch("p1", "0-800::title", { text: "较早" });
    const newer = state.patch("p1", "0-800::title", { text: "最新" });
    await Promise.resolve();
    expect(api.patchPageElement).toHaveBeenCalledTimes(1);
    finishFirst({ ...outline, elements: outline.elements.map(element => ({ ...element, text: "较早" })) });
    await older;
    await newer;
    expect(api.patchPageElement).toHaveBeenCalledTimes(2);
    expect(state.outline.value?.elements[0]?.text).toBe("最新");
  });

  it("rolls a rejected patch back", async () => {
    const api = makeFakeApi();
    vi.mocked(api.getPageOutline).mockResolvedValue(outline);
    const state = createPageOutlineState(api);
    state.outline.value = outline;
    vi.mocked(api.patchPageElement).mockRejectedValue(new Error("保存失败"));

    await expect(state.patch("p1", "0-800::title", { text: "新" })).rejects.toThrow("保存失败");

    expect(state.outline.value?.elements[0]?.text).toBe("旧");
    expect(state.error.value).toBe("保存失败");
  });
});
