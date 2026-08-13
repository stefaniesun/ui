import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { createStore } from "../state.js";
import { makeDoc, makeFakeApi, makeRegion } from "../test-helpers.js";
import type { ElementNode } from "@region-split/core/browser";
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

  it("selects a region and adds another with ctrl-click", async () => {
    const { store, wrapper } = await mounted();
    await wrapper.findAll(".overlay")[0]!.trigger("click");
    await wrapper.findAll(".overlay")[1]!.trigger("click", { ctrlKey: true });
    expect(store.selectedIds.value).toEqual(["a", "b"]);
  });

  it("renders and selects element overlays inside the canvas", async () => {
    const { store, wrapper } = await mounted();
    store.elements.value = [{ id: "el-1", regionId: "a", parentId: null, displayName: "按钮", type: "button", bounds: { x: 20, y: 30, w: 100, h: 60 }, confidence: 1, conflict: false, source: "manual" } satisfies ElementNode];
    store.doc.value = { ...store.doc.value!, elements: store.elements.value };
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-element-id="el-1"]').exists()).toBe(true);
    await wrapper.get('[data-element-id="el-1"]').trigger("pointerdown", { clientX: 20, clientY: 30 });
    expect(store.selectedElementId.value).toBe("el-1");
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
    await wrapper.findAll(".overlay")[1]!.trigger("click", { ctrlKey: true });
    expect(store.selectedIds.value).toEqual(["a"]);
  });
});
