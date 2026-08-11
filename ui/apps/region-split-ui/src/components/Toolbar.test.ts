import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import Toolbar from "./Toolbar.vue";
import { createStore } from "../state.js";
import { makeFakeApi, makeRegion } from "../test-helpers.js";

const initial = () => [makeRegion("a", 0, 200), makeRegion("b", 200, 200), makeRegion("c", 400, 200)];

async function mounted() {
  const store = createStore(makeFakeApi(initial));
  await store.load("p1");
  await store.loadModelConfig();
  return { store, wrapper: mount(Toolbar, { props: { store } }) };
}

describe("Toolbar", () => {
  it("shows single-selection actions and hides merge", async () => {
    const { store, wrapper } = await mounted();
    store.select("a", false);
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=split]").exists()).toBe(true);
    expect(wrapper.find("[data-test=merge]").exists()).toBe(false);
  });

  it("shows merge for multi-selection and disables it when not adjacent", async () => {
    const { store, wrapper } = await mounted();
    store.select("a", false);
    store.select("c", true);
    await wrapper.vm.$nextTick();
    const merge = wrapper.find("[data-test=merge]");
    expect(merge.exists()).toBe(true);
    expect(merge.attributes("disabled")).toBeDefined();
    store.select("b", true);
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=merge]").attributes("disabled")).toBeUndefined();
  });

  it("nudges the boundary from the arrow buttons", async () => {
    const { store, wrapper } = await mounted();
    store.select("a", false);
    await wrapper.vm.$nextTick();
    await wrapper.find("[data-test=nudge-down]").trigger("click");
    expect(store.regions.value[0]!.bounds.h).toBe(201);
    await wrapper.find("[data-test=nudge-up]").trigger("click");
    expect(store.regions.value[0]!.bounds.h).toBe(200);
  });

  it("disables the arrows on the last region", async () => {
    const { store, wrapper } = await mounted();
    store.select("c", false);
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=nudge-down]").attributes("disabled")).toBeDefined();
  });

  it("shows the selected geometry in the status line", async () => {
    const { store, wrapper } = await mounted();
    store.select("b", false);
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=status]").text()).toContain("y 200 → 400");
    expect(wrapper.find("[data-test=status]").text()).toContain("h 200");
  });

  it("asks for confirmation before re-analyzing", async () => {
    const { wrapper } = await mounted();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await wrapper.find("[data-test=analyze]").trigger("click");
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("switches to the split hint while in split mode", async () => {
    const { store, wrapper } = await mounted();
    store.select("a", false);
    store.beginSplit();
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=cancel-split]").exists()).toBe(true);
    expect(wrapper.find("[data-test=split]").exists()).toBe(false);
  });

  it("disables undo until something happened", async () => {
    const { store, wrapper } = await mounted();
    expect(wrapper.find("[data-test=undo]").attributes("disabled")).toBeDefined();
    store.select("a", false);
    store.rename("a", "顶部");
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=undo]").attributes("disabled")).toBeUndefined();
  });

  it("warns and blocks analysis when the model is not configured", async () => {
    const store = createStore(makeFakeApi(initial));
    await store.load("p1");
    const wrapper = mount(Toolbar, { props: { store } });
    expect(wrapper.find("[data-test=model-warning]").exists()).toBe(true);
    expect(wrapper.find("[data-test=analyze]").attributes("disabled")).toBeDefined();
  });

  it("opens the model config dialog", async () => {
    const { store, wrapper } = await mounted();
    await wrapper.find("[data-test=model-config]").trigger("click");
    expect(store.configDialogOpen.value).toBe(true);
  });

  // ⑦ 高度 < 16px 拆不出两个 >= 8px 的块，拆分按钮该禁用，和 [▲][▼] 的禁用处理保持一致
  it("disables split when the selected region is too short to produce two valid halves", async () => {
    const store = createStore(makeFakeApi(() => [makeRegion("a", 0, 10), makeRegion("b", 10, 300)]));
    await store.load("p1");
    const wrapper = mount(Toolbar, { props: { store } });
    store.select("a", false);
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=split]").attributes("disabled")).toBeDefined();
  });

  it("keeps split enabled once the region is tall enough", async () => {
    const { store, wrapper } = await mounted();
    store.select("a", false);
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=split]").attributes("disabled")).toBeUndefined();
  });

  // ③ busy 是个进行中的状态，之前没有任何界面消费它——分析/上传期间应该显示进行中，
  // 并禁用一切会改动区域的操作。
  describe("busy state", () => {
    it("shows a busy indicator and disables mutating actions while an operation is in flight", async () => {
      const { store, wrapper } = await mounted();
      store.select("a", false);
      await wrapper.vm.$nextTick();

      store.busy.value = true;
      await wrapper.vm.$nextTick();

      expect(wrapper.find("[data-test=busy]").exists()).toBe(true);
      expect(wrapper.find("[data-test=nudge-up]").attributes("disabled")).toBeDefined();
      expect(wrapper.find("[data-test=nudge-down]").attributes("disabled")).toBeDefined();
      expect(wrapper.find("[data-test=split]").attributes("disabled")).toBeDefined();
      expect(wrapper.find("[data-test=rename]").attributes("disabled")).toBeDefined();
      expect(wrapper.find("[data-test=ai-rename]").attributes("disabled")).toBeDefined();
      expect(wrapper.find("[data-test=analyze]").attributes("disabled")).toBeDefined();
      expect(wrapper.find("[data-test=file]").attributes("disabled")).toBeDefined();
    });

    it("disables merge while busy even when the selection is mergeable", async () => {
      const { store, wrapper } = await mounted();
      store.select("a", false);
      store.select("b", true);
      await wrapper.vm.$nextTick();
      expect(wrapper.find("[data-test=merge]").attributes("disabled")).toBeUndefined();

      store.busy.value = true;
      await wrapper.vm.$nextTick();
      expect(wrapper.find("[data-test=merge]").attributes("disabled")).toBeDefined();
    });

    it("hides the busy indicator once the operation finishes", async () => {
      const { store, wrapper } = await mounted();
      store.busy.value = true;
      await wrapper.vm.$nextTick();
      expect(wrapper.find("[data-test=busy]").exists()).toBe(true);
      store.busy.value = false;
      await wrapper.vm.$nextTick();
      expect(wrapper.find("[data-test=busy]").exists()).toBe(false);
    });
  });

  // ⑤ 长按 [▲][▼] 要连续触发：首次延迟 400ms，之后每 60ms 一次。单击（不经过长按）
  // 仍然只调整一次，不能因为加了长按逻辑就意外触发两次。
  describe("nudge button press-and-hold", () => {
    it("repeats the nudge while held down, after an initial 400ms delay, then every 60ms", async () => {
      vi.useFakeTimers();
      const { store, wrapper } = await mounted();
      store.select("a", false);
      await wrapper.vm.$nextTick();
      const button = wrapper.find("[data-test=nudge-down]");

      await button.trigger("mousedown");
      expect(store.regions.value[0]!.bounds.h).toBe(200);

      await vi.advanceTimersByTimeAsync(399);
      expect(store.regions.value[0]!.bounds.h).toBe(200);
      await vi.advanceTimersByTimeAsync(1);
      expect(store.regions.value[0]!.bounds.h).toBe(201);

      await vi.advanceTimersByTimeAsync(60);
      expect(store.regions.value[0]!.bounds.h).toBe(202);
      await vi.advanceTimersByTimeAsync(180);
      expect(store.regions.value[0]!.bounds.h).toBe(205);

      await button.trigger("mouseup");
      await vi.advanceTimersByTimeAsync(300);
      expect(store.regions.value[0]!.bounds.h).toBe(205);
      vi.useRealTimers();
    });

    it("stops repeating on mouseleave too", async () => {
      vi.useFakeTimers();
      const { store, wrapper } = await mounted();
      store.select("a", false);
      await wrapper.vm.$nextTick();
      const button = wrapper.find("[data-test=nudge-down]");

      await button.trigger("mousedown");
      await vi.advanceTimersByTimeAsync(400);
      expect(store.regions.value[0]!.bounds.h).toBe(201);
      await button.trigger("mouseleave");
      await vi.advanceTimersByTimeAsync(300);
      expect(store.regions.value[0]!.bounds.h).toBe(201);
      vi.useRealTimers();
    });

    it("still nudges exactly once for a quick click that never reaches the hold delay", async () => {
      vi.useFakeTimers();
      const { store, wrapper } = await mounted();
      store.select("a", false);
      await wrapper.vm.$nextTick();
      const button = wrapper.find("[data-test=nudge-down]");

      await button.trigger("mousedown");
      await button.trigger("mouseup");
      await button.trigger("click");

      expect(store.regions.value[0]!.bounds.h).toBe(201);
      vi.useRealTimers();
    });

    it("suppresses the trailing click event that follows a long press so it isn't double-counted", async () => {
      vi.useFakeTimers();
      const { store, wrapper } = await mounted();
      store.select("a", false);
      await wrapper.vm.$nextTick();
      const button = wrapper.find("[data-test=nudge-down]");

      await button.trigger("mousedown");
      await vi.advanceTimersByTimeAsync(400);
      expect(store.regions.value[0]!.bounds.h).toBe(201);
      await button.trigger("mouseup");
      // 真实浏览器里 mouseup 后必然还会补发一次 click；长按期间已经调整过了，
      // 这次尾随的 click 不该再额外调整一次。
      await button.trigger("click");
      expect(store.regions.value[0]!.bounds.h).toBe(201);
      vi.useRealTimers();
    });
  });
});
