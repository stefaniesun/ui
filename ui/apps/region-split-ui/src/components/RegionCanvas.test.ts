import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { createStore } from "../state.js";
import { regionColor, regionSoftColor } from "../region-visual.js";
import { makeDoc, makeFakeApi, makeRegion } from "../test-helpers.js";
import RegionCanvas from "./RegionCanvas.vue";

async function mounted() {
  const store = createStore(makeFakeApi(() => [
    makeRegion("a", 0, 300), makeRegion("b", 300, 300),
  ]));
  await store.load("p1");
  store.doc.value = makeDoc(store.regions.value, [{ y: 150, strength: 1 }], true);
  const wrapper = mount(RegionCanvas, {
    props: { store, hoveredId: null, showPanels: true },
  });
  return { store, wrapper };
}

describe("RegionCanvas", () => {
  it("renders the analysis image without candidate split lines", async () => {
    const { wrapper } = await mounted();
    expect(wrapper.find(".stage").exists()).toBe(true);
    expect(wrapper.get('[data-test="analysis-image"]').classes()).toContain("comparison-image");
    expect(wrapper.findAll(".overlay")).toHaveLength(2);
    expect(wrapper.findAll(".candidate-line")).toHaveLength(0);
  });

  it("assigns each region its stable border and fill colors", async () => {
    const { wrapper } = await mounted();
    const boxes = wrapper.findAll(".overlay");
    expect(boxes[0]!.attributes("style")).toContain(`--region-color: ${regionColor("a")}`);
    expect(boxes[0]!.attributes("style")).toContain(`--region-soft-color: ${regionSoftColor("a")}`);
    expect(boxes[1]!.attributes("style")).toContain(`--region-color: ${regionColor("b")}`);
  });

  it("selects a region and adds another with ctrl-click", async () => {
    const { store, wrapper } = await mounted();
    await wrapper.findAll(".overlay")[0]!.trigger("click");
    await wrapper.findAll(".overlay")[1]!.trigger("click", { ctrlKey: true });
    expect(store.selectedIds.value).toEqual(["a", "b"]);
  });

  it("hides candidate lines while keeping candidate snapping in split mode", async () => {
    const { store, wrapper } = await mounted();
    store.select("a", false);
    store.beginSplit();
    const stage = wrapper.get(".stage");
    Object.defineProperty(stage.element, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ top: 0, height: 600, left: 0, width: 375, right: 375, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }),
    });

    await stage.trigger("mousemove", { clientY: 151 });

    expect(wrapper.findAll(".candidate-line")).toHaveLength(0);
    expect(wrapper.get(".split-line").attributes("style")).toContain("top: 150px");
    expect(stage.classes()).toContain("splitting");
    await stage.trigger("click", { clientY: 151 });
    expect(store.regions.value).toHaveLength(3);
    expect(store.selectedIds.value).toEqual(["a-2"]);
  });
});
