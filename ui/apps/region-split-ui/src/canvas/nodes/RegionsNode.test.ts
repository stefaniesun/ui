import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { StoreApi } from "../../api.js";
import { createStore } from "../../state.js";
import { makeDoc, makeFakeApi, makeRegion } from "../../test-helpers.js";
import RegionsNode from "./RegionsNode.vue";

const file = new File(["image"], "screen.png", { type: "image/png" });

async function mountNode(overrides: Partial<StoreApi> = {}) {
  const api = makeFakeApi(() => [makeRegion("a", 0, 600)], [], overrides);
  const store = createStore(api);
  await store.loadModelConfig();
  const wrapper = mount(RegionsNode, {
    props: { store, hoveredId: null, showCandidateLines: true, showPanels: true },
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

describe("RegionsNode upload and analysis orchestration", () => {
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

  it("stops pointer and click events but lets wheel reach canvas zoom", async () => {
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
      props: { store, hoveredId: null, showCandidateLines: true, showPanels: true },
      attachTo: host,
    });

    await wrapper.get(".regions-node").trigger("pointerdown");
    await wrapper.get(".regions-node").trigger("click");
    await wrapper.get(".regions-node").trigger("wheel");

    expect(onPointerdown).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
    expect(onWheel).toHaveBeenCalledTimes(1);
    wrapper.unmount();
    host.remove();
  });
});
