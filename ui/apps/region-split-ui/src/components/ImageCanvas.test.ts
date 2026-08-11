import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ImageCanvas from "./ImageCanvas.vue";
import { createStore } from "../state.js";
import { makeFakeApi, makeRegion } from "../test-helpers.js";

const initial = () => [makeRegion("a", 0, 200), makeRegion("b", 200, 400)];

async function mounted() {
  const store = createStore(makeFakeApi(initial));
  await store.load("p1");
  return { store, wrapper: mount(ImageCanvas, { props: { store } }) };
}

describe("ImageCanvas", () => {
  it("renders one overlay per region with its label", async () => {
    const { wrapper } = await mounted();
    const overlays = wrapper.findAll("[data-region-id]");
    expect(overlays).toHaveLength(2);
    expect(overlays[0]!.attributes("data-region-id")).toBe("a");
    expect(overlays[1]!.text()).toContain("名-b");
  });

  it("selects on click and adds to the selection with ctrl-click", async () => {
    const { store, wrapper } = await mounted();
    await wrapper.findAll("[data-region-id]")[0]!.trigger("click");
    expect(store.selectedIds.value).toEqual(["a"]);
    await wrapper.findAll("[data-region-id]")[1]!.trigger("click", { ctrlKey: true });
    expect(store.selectedIds.value).toEqual(["a", "b"]);
  });

  it("marks the selected overlay", async () => {
    const { store, wrapper } = await mounted();
    store.select("b", false);
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll("[data-region-id]")[1]!.classes()).toContain("selected");
  });

  it("clears the selection when the backdrop is clicked", async () => {
    const { store, wrapper } = await mounted();
    store.select("a", false);
    await wrapper.find("[data-test=backdrop]").trigger("click");
    expect(store.selectedIds.value).toEqual([]);
  });

  it("emits hover on mouseenter/mouseleave and highlights the hovered overlay distinctly from selection", async () => {
    const { wrapper } = await mounted();
    const overlays = wrapper.findAll("[data-region-id]");
    await overlays[0]!.trigger("mouseenter");
    expect(wrapper.emitted("hover")?.at(-1)).toEqual(["a"]);
    await wrapper.setProps({ hoveredId: "a" });
    expect(wrapper.findAll("[data-region-id]")[0]!.classes()).toContain("hovered");
    expect(wrapper.findAll("[data-region-id]")[0]!.classes()).not.toContain("selected");
    await overlays[0]!.trigger("mouseleave");
    expect(wrapper.emitted("hover")?.at(-1)).toEqual([null]);
  });
});

async function mountedForSplit() {
  const store = createStore(makeFakeApi(initial, [{ y: 260, strength: 0.9 }]));
  await store.load("p1");
  const wrapper = mount(ImageCanvas, { props: { store } });
  store.select("b", false);
  store.beginSplit();
  await wrapper.vm.$nextTick();
  return { store, wrapper };
}

describe("ImageCanvas split mode", () => {
  it("shows no split line outside split mode", async () => {
    const { wrapper } = await mounted();
    expect(wrapper.find("[data-test=split-line]").exists()).toBe(false);
  });

  it("tracks the pointer and reports both halves", async () => {
    const { wrapper } = await mountedForSplit();
    await wrapper.find("[data-test=stage]").trigger("mousemove", { clientY: 300 });
    expect(wrapper.find("[data-test=split-line]").exists()).toBe(true);
    expect(wrapper.find("[data-test=split-info]").text()).toContain("上 100");
    expect(wrapper.find("[data-test=split-info]").text()).toContain("下 300");
  });

  it("snaps onto a nearby candidate line", async () => {
    const { wrapper } = await mountedForSplit();
    await wrapper.find("[data-test=stage]").trigger("mousemove", { clientY: 255 });
    expect(wrapper.find("[data-test=split-line]").classes()).toContain("snapped");
    expect(wrapper.find("[data-test=split-info]").text()).toContain("y 260");
  });

  it("marks positions too close to an edge as invalid and ignores the click", async () => {
    const { store, wrapper } = await mountedForSplit();
    const stage = wrapper.find("[data-test=stage]");
    await stage.trigger("mousemove", { clientY: 203 });
    expect(wrapper.find("[data-test=split-line]").classes()).toContain("invalid");
    await stage.trigger("click");
    expect(store.regions.value).toHaveLength(2);
    expect(store.mode.value).toBe("split");
  });

  it("commits the split on a valid click", async () => {
    const { store, wrapper } = await mountedForSplit();
    const stage = wrapper.find("[data-test=stage]");
    await stage.trigger("mousemove", { clientY: 300 });
    await stage.trigger("click");
    expect(store.regions.value.map(r => r.id)).toEqual(["a", "b", "b-2"]);
    expect(store.mode.value).toBe("idle");
  });
});
