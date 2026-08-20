import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "../../api.js";
import { createStore } from "../../state.js";
import { makeDoc, makeFakeApi, makeRegion } from "../../test-helpers.js";
import RegionsNode from "./RegionsNode.vue";

const file = new File(["image"], "screen.png", { type: "image/png" });
let resizeCallback: ResizeObserverCallback;
const observe = vi.fn();
const disconnect = vi.fn();

beforeEach(() => {
  observe.mockClear();
  disconnect.mockClear();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) {
      resizeCallback = callback;
    }
    observe = observe;
    disconnect = disconnect;
    unobserve = vi.fn();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function mountNode(overrides: Partial<StoreApi> = {}) {
  const api = makeFakeApi(() => [makeRegion("a", 0, 600)], [], overrides);
  const store = createStore(api);
  await store.loadModelConfig();
  const wrapper = mount(RegionsNode, {
    props: { store, hoveredId: null, showPanels: true },
  });
  return { api, store, wrapper };
}

async function chooseFile(wrapper: ReturnType<typeof mount>) {
  Object.defineProperty(wrapper.get("input[type=file]").element, "files", {
    configurable: true,
    value: [file],
  });
  await wrapper.get("input[type=file]").trigger("change");
  await flushPromises();
  await nextTick();
}

async function showAnalyzedResult(
  store: ReturnType<typeof createStore>,
  wrapper: ReturnType<typeof mount>,
  regions = [
    makeRegion("a", 0, 200),
    makeRegion("b", 200, 200),
    makeRegion("c", 400, 200),
  ],
) {
  store.projectId.value = "p1";
  store.doc.value = makeDoc(regions, [], true);
  store.regions.value = regions;
  await nextTick();
  const image = wrapper.get('[data-test="original-image"]').element;
  Object.defineProperty(image, "clientHeight", { configurable: true, value: 600 });
  image.dispatchEvent(new Event("load"));
  await nextTick();
}

describe("RegionsNode upload and analysis orchestration", () => {
  it("shows analysis completion and non-blocking todos", async () => {
    const api = makeFakeApi(() => []);
    vi.mocked(api.getAnalysisStats).mockResolvedValue({
      totalRegions: 2, parsedRegions: 1, totalIcons: 3,
      libraryIcons: 1, cropIcons: 1, unresolvedIcons: 1,
      textWithoutSize: 0, fontStackChosen: false,
      allPassed: false, todos: ["解析区域 底部", "确认图标 搜索"],
    });
    const store = createStore(api);
    store.doc.value = makeDoc([], [], true);
    store.projectId.value = "p1";
    const wrapper = mount(RegionsNode, { props: { store, hoveredId: null, showPanels: false } });
    await flushPromises();
    expect(wrapper.get('[data-test="analysis-stats"]').text()).toContain("区域 1/2");
    expect(wrapper.get('[data-test="analysis-stats"]').text()).toContain("SVG 1");
    expect(wrapper.get('[data-test="analysis-todos"]').text()).toContain("确认图标 搜索");
  });

  it("shows Windows by default without persisting until the user selects", async () => {
    const api = makeFakeApi(() => []);
    const store = createStore(api);
    store.doc.value = makeDoc([], [], true);
    store.projectId.value = "p1";
    const wrapper = mount(RegionsNode, { props: { store, hoveredId: null, showPanels: false } });
    const select = wrapper.get('[data-test="font-stack"]');
    expect((select.element as HTMLSelectElement).value).toBe('Arial, "Microsoft YaHei", sans-serif');
    expect(vi.mocked(api.putFontStack)).not.toHaveBeenCalled();
    await select.setValue('Roboto, "Noto Sans CJK SC", "Source Han Sans SC", sans-serif');
    expect(vi.mocked(api.putFontStack)).toHaveBeenCalledWith("p1", 'Roboto, "Noto Sans CJK SC", "Source Han Sans SC", sans-serif');
  });

  it("emits the page comparison action after analysis", async () => {
    const { store, wrapper } = await mountNode();
    await showAnalyzedResult(store, wrapper);
    await wrapper.get('[data-test="open-page-compare"]').trigger("click");
    expect(wrapper.emitted("openPageCompare")).toHaveLength(1);
  });
  it("blocks upload when the AI model is not configured and reports its config path", async () => {
    const upload = vi.fn();
    const analyze = vi.fn();
    const { wrapper } = await mountNode({
      upload,
      analyze,
      getModelConfig: vi.fn(async () => ({
        baseUrl: "", model: "", hasApiKey: false, configPath: "D:/workspace/ui/region-split.config.json",
      })),
    });

    await chooseFile(wrapper);

    expect(upload).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
    expect(wrapper.emitted("error")?.[0]?.[0]).toMatchObject({
      title: "AI 模型未配置",
      configPath: "D:/workspace/ui/region-split.config.json",
      retryable: false,
    });
  });

  it("reports upload failures instead of failing silently", async () => {
    const { wrapper } = await mountNode({
      upload: vi.fn(async () => { throw new Error("unsupported image"); }),
    });

    await chooseFile(wrapper);

    expect(wrapper.emitted("error")?.at(-1)?.[0]).toMatchObject({
      title: "图片上传失败",
      message: "unsupported image",
      retryable: false,
    });
  });

  it("refreshes model configuration without uploading", async () => {
    const getModelConfig = vi.fn(async () => ({
      baseUrl: "", model: "", hasApiKey: false, configPath: "config.json",
    }));
    const upload = vi.fn();
    const { wrapper } = await mountNode({ getModelConfig, upload });

    await wrapper.get('[data-test="refresh-model-config"]').trigger("click");

    expect(getModelConfig).toHaveBeenCalledTimes(2);
    expect(upload).not.toHaveBeenCalled();
  });

  it("uploads then analyzes exactly once and emits uploaded", async () => {
    const order: string[] = [];
    const upload = vi.fn(async () => {
      order.push("upload");
      return { projectId: "p1", doc: makeDoc([makeRegion("initial", 0, 600)]) };
    });
    const analyze = vi.fn(async () => {
      order.push("analyze");
      return { doc: makeDoc([makeRegion("final", 0, 600)], [], true) };
    });
    const { wrapper } = await mountNode({ upload, analyze });

    await chooseFile(wrapper);

    expect(order).toEqual(["upload", "analyze"]);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("uploaded")).toHaveLength(1);
    expect(wrapper.find('[data-test="analysis-result"]').exists()).toBe(true);
    expect(wrapper.find(".comparison-images").exists()).toBe(true);
    expect(wrapper.find('[data-test="original-image"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="analysis-image"]').exists()).toBe(true);
    expect(wrapper.get(".analysis-panel").attributes("data-no-canvas-pan")).toBe("");
    expect(wrapper.find(".region-list-column").exists()).toBe(true);
  });

  it("uses one zero-gap size for both complete images", async () => {
    const { wrapper } = await mountNode();
    await chooseFile(wrapper);

    const comparison = wrapper.get(".comparison-images");
    const original = wrapper.get('[data-test="original-image"]');
    const analysis = wrapper.get('[data-test="analysis-image"]');
    expect(comparison.attributes("style")).toContain("--image-aspect: 375 / 600");
    expect(original.classes()).toContain("comparison-image");
    expect(analysis.classes()).toContain("comparison-image");
  });

  it("extends each internal region boundary 32px into the original image", async () => {
    const { store, wrapper } = await mountNode();
    await showAnalyzedResult(store, wrapper);

    const layer = wrapper.get('[data-test="boundary-guides"]');
    const guides = wrapper.findAll('[data-test="boundary-guide"]');

    expect(guides).toHaveLength(2);
    expect(layer.attributes("style")).toContain("height: 600px");
    expect(guides[0]!.attributes("style")).toContain("top: 200px");
    expect(guides[1]!.attributes("style")).toContain("top: 400px");
    expect(guides.every(guide => guide.attributes("style")?.includes("width: 32px"))).toBe(true);
    expect(guides.some(guide => guide.attributes("style")?.includes("top: 0px"))).toBe(false);
    expect(guides.some(guide => guide.attributes("style")?.includes("top: 600px"))).toBe(false);
    expect(layer.attributes("style")).toContain("left: calc(50% - 32px)");
    expect(layer.attributes("style")).toContain("pointer-events: none");
    expect(guides.every(guide => guide.attributes("style")?.includes("pointer-events: none"))).toBe(true);

    const comparisonStyle = wrapper.get(".comparison-images").attributes("style");
    expect(comparisonStyle).toContain("grid-template-columns: repeat(2, minmax(0, 430px))");
    expect(comparisonStyle).toContain("gap: 0px");
  });

  it("hides boundary guides when an analyzed multi-region image is not measured", async () => {
    const { store, wrapper } = await mountNode();
    const regions = [makeRegion("a", 0, 300), makeRegion("b", 300, 300)];
    store.projectId.value = "p1";
    store.doc.value = makeDoc(regions, [], true);
    store.regions.value = regions;
    await nextTick();

    expect(wrapper.find('[data-test="boundary-guides"]').exists()).toBe(false);
  });

  it("hides boundary guides for unanalysed or single-region results", async () => {
    const { store, wrapper } = await mountNode();
    const regions = [makeRegion("a", 0, 300), makeRegion("b", 300, 300)];
    store.projectId.value = "p1";
    store.doc.value = makeDoc(regions, [], true);
    store.regions.value = regions;
    await nextTick();
    const image = wrapper.get('[data-test="original-image"]').element;
    Object.defineProperty(image, "clientHeight", { configurable: true, value: 600 });
    image.dispatchEvent(new Event("load"));
    await nextTick();
    expect(wrapper.find('[data-test="boundary-guides"]').exists()).toBe(true);

    store.doc.value = makeDoc(regions);
    await nextTick();
    expect(wrapper.find('[data-test="boundary-guides"]').exists()).toBe(false);

    const oneRegion = [makeRegion("a", 0, 600)];
    store.doc.value = makeDoc(oneRegion, [], true);
    store.regions.value = oneRegion;
    await nextTick();
    expect(wrapper.find('[data-test="boundary-guides"]').exists()).toBe(false);
  });

  it("hides existing guides while analysis is busy or has failed", async () => {
    const { store, wrapper } = await mountNode();
    await showAnalyzedResult(store, wrapper);
    expect(wrapper.find('[data-test="boundary-guides"]').exists()).toBe(true);

    store.busyLabel.value = "AI 分析中…";
    await nextTick();
    expect(wrapper.find('[data-test="boundary-guides"]').exists()).toBe(false);

    store.busyLabel.value = "";
    (wrapper.vm as unknown as { markAnalysisFailed: () => void }).markAnalysisFailed();
    await nextTick();
    expect(wrapper.find('[data-test="boundary-guides"]').exists()).toBe(false);
  });

  it("updates guide positions after boundary and image-size changes", async () => {
    const { store, wrapper } = await mountNode();
    await showAnalyzedResult(store, wrapper);

    store.regions.value = [
      makeRegion("a", 0, 180),
      makeRegion("b", 180, 220),
      makeRegion("c", 400, 200),
    ];
    await nextTick();
    expect(wrapper.findAll('[data-test="boundary-guide"]')[0]!.attributes("style"))
      .toContain("top: 180px");

    const image = wrapper.get('[data-test="original-image"]').element;
    Object.defineProperty(image, "clientHeight", { configurable: true, value: 300 });
    resizeCallback([], {} as ResizeObserver);
    await nextTick();

    const guides = wrapper.findAll('[data-test="boundary-guide"]');
    expect(guides[0]!.attributes("style")).toContain("top: 90px");
    expect(guides[1]!.attributes("style")).toContain("top: 200px");
  });

  it("observes image size and disconnects on unmount", async () => {
    const { store, wrapper } = await mountNode();
    await showAnalyzedResult(store, wrapper);

    const image = wrapper.get('[data-test="original-image"]').element;
    expect(observe).toHaveBeenCalledWith(image);
    expect(wrapper.get('[data-test="boundary-guides"]').attributes("aria-hidden")).toBe("true");

    const callsBeforeUnmount = disconnect.mock.calls.length;
    wrapper.unmount();
    expect(disconnect).toHaveBeenCalledTimes(callsBeforeUnmount + 1);
  });

  it("ignores duplicate uploads while busy", async () => {
    let resolveUpload!: (value: { projectId: string; doc: ReturnType<typeof makeDoc> }) => void;
    const upload: StoreApi["upload"] = vi.fn(() => new Promise<Awaited<ReturnType<StoreApi["upload"]>>>((resolve) => {
      resolveUpload = resolve;
    }));
    const { wrapper } = await mountNode({ upload });

    const first = chooseFile(wrapper);
    await nextTick();
    await chooseFile(wrapper);
    expect(upload).toHaveBeenCalledTimes(1);

    resolveUpload({ projectId: "p1", doc: makeDoc([makeRegion("a", 0, 600)]) });
    await first;
  });

  it("hides old interactive results while re-analyzing and after re-analysis fails", async () => {
    let rejectAnalysis!: (reason: Error) => void;
    const analyze: StoreApi["analyze"] = vi.fn(() => new Promise<Awaited<ReturnType<StoreApi["analyze"]>>>((_, reject) => {
      rejectAnalysis = reject;
    }));
    const { store, wrapper } = await mountNode({ analyze });
    store.projectId.value = "p1";
    store.doc.value = makeDoc([makeRegion("old", 0, 600)], [], true);
    store.regions.value = store.doc.value.regions;
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-test="analysis-result"]').exists()).toBe(true);

    const retry = (wrapper.vm as unknown as { retryAnalysis: () => Promise<void> }).retryAnalysis();
    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-test="analysis-result"]').exists()).toBe(false);
    expect(wrapper.find(".action-bar").exists()).toBe(false);
    expect(wrapper.find(".list").exists()).toBe(false);

    rejectAnalysis(new Error("retry failed"));
    await retry;
    await nextTick();
    expect(wrapper.find('[data-test="analysis-failed"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="analysis-result"]').exists()).toBe(false);
  });

  it("keeps the original image locked after failure and retries analysis", async () => {
    const analyze = vi.fn()
      .mockRejectedValueOnce(new Error("model unavailable"))
      .mockResolvedValueOnce({ doc: makeDoc([makeRegion("final", 0, 600)], [], true) });
    const { wrapper } = await mountNode({ analyze });

    await chooseFile(wrapper);

    expect(wrapper.find('[data-test="original-image"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="analysis-failed"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="analysis-result"]').exists()).toBe(false);
    expect(wrapper.emitted("error")?.at(-1)?.[0]).toMatchObject({
      title: "AI 区域分析失败",
      retryable: true,
    });

    await (wrapper.vm as unknown as { retryAnalysis: () => Promise<void> }).retryAnalysis();
    await nextTick();

    expect(analyze).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-test="analysis-result"]').exists()).toBe(true);
  });

  it("checks model configuration again before retrying", async () => {
    const analyze = vi.fn().mockRejectedValue(new Error("model unavailable"));
    const { store, wrapper } = await mountNode({ analyze });
    await chooseFile(wrapper);
    store.modelConfig.value = {
      baseUrl: "", model: "", hasApiKey: false, configPath: "config.json",
    };

    await (wrapper.vm as unknown as { retryAnalysis: () => Promise<void> }).retryAnalysis();

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("error")?.at(-1)?.[0]).toMatchObject({
      title: "AI 模型未配置",
      configPath: "config.json",
      retryable: false,
    });
  });

  it("lets pointer and wheel reach the canvas while stopping clicks", async () => {
    const onPointerdown = vi.fn();
    const onClick = vi.fn();
    const onWheel = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    host.addEventListener("pointerdown", onPointerdown);
    host.addEventListener("click", onClick);
    host.addEventListener("wheel", onWheel);
    const api = makeFakeApi(() => [makeRegion("a", 0, 600)]);
    const store = createStore(api);
    await store.loadModelConfig();
    const wrapper = mount(RegionsNode, {
      props: { store, hoveredId: null, showPanels: true },
      attachTo: host,
    });

    await wrapper.get(".regions-node").trigger("pointerdown");
    await wrapper.get(".regions-node").trigger("click");
    await wrapper.get(".regions-node").trigger("wheel");

    expect(onPointerdown).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
    expect(onWheel).toHaveBeenCalledTimes(1);
    wrapper.unmount();
    host.remove();
  });
});
