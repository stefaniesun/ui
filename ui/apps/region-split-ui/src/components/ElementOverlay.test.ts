import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import ElementOverlay from "./ElementOverlay.vue";
import { createStore } from "../state.js";
import { makeDoc, makeFakeApi } from "../test-helpers.js";

describe("ElementOverlay", () => {
  beforeEach(() => { Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", { configurable: true, value: () => ({ left: 0, top: 0, width: 100, height: 200 }) }); });
  it("renders elements with conflict styling only on its overlay", async () => {
    const api = makeFakeApi(() => []); const store = createStore(api); await store.loadModelConfig();
    const document = makeDoc([]); document.analyzedAt = "now"; document.elements = [{ id: "e", regionId: "body", parentId: null, displayName: "按钮", type: "button", bounds: { x: 10, y: 20, w: 40, h: 20 }, confidence: 1, conflict: true, source: "ai" }];
    api.upload = async () => ({ projectId: "p1", doc: document }); await store.uploadImage(new File(["x"], "x.png"));
    const wrapper = mount(ElementOverlay, { props: { store, imageWidth: 100, imageHeight: 200, displayWidth: 100, displayHeight: 200 } });
    expect(wrapper.get('[data-element-id="e"]').classes()).toContain("conflict");
    await wrapper.get('[data-element-id="e"]').trigger("click");
  });
});
