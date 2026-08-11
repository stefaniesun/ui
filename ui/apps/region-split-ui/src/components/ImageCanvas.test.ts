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
