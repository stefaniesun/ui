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
});
