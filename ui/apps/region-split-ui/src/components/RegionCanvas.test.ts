import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { createStore } from "../state.js";
import { makeDoc, makeFakeApi, makeRegion } from "../test-helpers.js";
import RegionCanvas from "./RegionCanvas.vue";

async function mounted() {
  const store = createStore(makeFakeApi(() => [
    makeRegion("a", 0, 300), makeRegion("b", 300, 300),
  ]));
  await store.load("p1");
  store.doc.value = makeDoc(store.regions.value, [{ y: 150, strength: 1 }], true);
  const wrapper = mount(RegionCanvas, {
    props: { store, hoveredId: null, showCandidateLines: true, showPanels: true },
  });
  return { store, wrapper };
}

describe("RegionCanvas", () => {
  it("renders the analysis image flush inside the shared aspect-ratio stage", async () => {
    const { wrapper } = await mounted();
    expect(wrapper.find(".stage").exists()).toBe(true);
    expect(wrapper.get('[data-test="analysis-image"]').classes()).toContain("comparison-image");
    expect(wrapper.findAll(".overlay")).toHaveLength(2);
  });

  it("selects a region and adds another with ctrl-click", async () => {
    const { store, wrapper } = await mounted();
    await wrapper.findAll(".overlay")[0]!.trigger("click");
    await wrapper.findAll(".overlay")[1]!.trigger("click", { ctrlKey: true });
    expect(store.selectedIds.value).toEqual(["a", "b"]);
  });

  it("does not change selection through overlays while splitting", async () => {
    const { store, wrapper } = await mounted();
    store.select("a", false);
    store.beginSplit();
    await wrapper.findAll(".overlay")[1]!.trigger("click", { ctrlKey: true });
    expect(store.selectedIds.value).toEqual(["a"]);
  });
});
