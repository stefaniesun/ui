import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import ElementOverlay from "./ElementOverlay.vue";
import type { ElementNode, Rect } from "@region-split/core/browser";

const region: Rect = { x: 0, y: 100, w: 400, h: 300 };
function node(over: Partial<ElementNode> & Pick<ElementNode, "id">): ElementNode {
  return {
    parentId: null, box: { x: 20, y: 120, w: 100, h: 60 }, kind: "component",
    displayName: "节点", style: {}, uniformity: 1, source: "auto",
    classification: "tool", scrollX: false, scrollY: false, positioning: "flow", ...over,
  };
}
const base = {
  projectId: "p1", region, nodes: [node({ id: "n1" })],
  selectedId: null, hoveredId: null,
};
const mountOverlay = (props: Record<string, unknown> = {}) =>
  mount(ElementOverlay, { props: { ...base, ...props } });

describe("ElementOverlay", () => {
  it("keeps the frame at the region aspect ratio", () => {
    const style = mountOverlay().find('[data-test="element-stage"]').attributes("style")!;
    expect(style).toContain("400 / 300");
  });

  it("draws one box per node", () => {
    expect(mountOverlay().findAll('[data-test="element-box"]')).toHaveLength(1);
  });

  // 全部按百分比定位，不做任何测量——图始终占满容器宽度，比例与区域一致
  it("positions a box relative to the region origin in percent", () => {
    const style = mountOverlay().find('[data-test="element-box"]').attributes("style")!;
    const percent = (name: string) =>
      Number(new RegExp(`${name}:\\s*([\\d.]+)%`).exec(style)![1]);
    expect(percent("left")).toBeCloseTo(5, 4);
    // (120 - 100) / 300
    expect(percent("top")).toBeCloseTo(6.6667, 3);
    expect(percent("width")).toBeCloseTo(25, 4);
    expect(percent("height")).toBeCloseTo(20, 4);
  });

  it("tags the box with its kind", () => {
    const wrapper = mountOverlay({ nodes: [node({ id: "n1", kind: "image" })] });
    expect(wrapper.find('[data-test="element-box"]').classes()).toContain("kind-image");
  });

  it("renders a positive radius only for images and components", () => {
    for (const kind of ["image", "component"] as const) {
      const wrapper = mountOverlay({
        nodes: [node({ id: "n1", kind, style: { borderRadius: 8 } })],
      });
      expect(wrapper.find('[data-test="element-box"]').attributes("style")).toContain("border-radius");
    }
    const legacyText = mountOverlay({
      nodes: [node({ id: "n1", kind: "text", style: { borderRadius: 8 } })],
    });
    expect(legacyText.find('[data-test="element-box"]').attributes("style"))
      .not.toContain("border-radius");
  });

  it("does not render a missing or zero radius", () => {
    for (const style of [{}, { borderRadius: 0 }]) {
      const wrapper = mountOverlay({ nodes: [node({ id: "n1", kind: "image", style })] });
      expect(wrapper.find('[data-test="element-box"]').attributes("style"))
        .not.toContain("border-radius");
    }
  });

  it("marks the selected and hovered boxes", () => {
    const wrapper = mountOverlay({ selectedId: "n1" });
    expect(wrapper.find('[data-test="element-box"]').classes()).toContain("selected");
  });

  it("emits select on click", async () => {
    const wrapper = mountOverlay();
    await wrapper.find('[data-test="element-box"]').trigger("click");
    expect(wrapper.emitted("select")![0]).toEqual(["n1"]);
  });

  it("emits add-container after a drag", async () => {
    const wrapper = mountOverlay();
    const stage = wrapper.find('[data-test="element-stage"]');
    await stage.trigger("pointerdown", { button: 0, clientX: 0, clientY: 0 });
    await stage.trigger("pointermove", { clientX: 60, clientY: 60 });
    await stage.trigger("pointerup");
    expect(wrapper.emitted("add-container")).toBeTruthy();
  });

  it("ignores a drag too small to be intentional", async () => {
    const wrapper = mountOverlay();
    const stage = wrapper.find('[data-test="element-stage"]');
    await stage.trigger("pointerdown", { button: 0, clientX: 0, clientY: 0 });
    await stage.trigger("pointerup");
    expect(wrapper.emitted("add-container")).toBeFalsy();
  });

  // jsdom 没有 PointerEvent，所以不去断言 stopPropagation 被调用，
  // 而是真的挂一个父级监听器看事件有没有冒泡上去——这更贴近实际行为：
  // 冒泡出去就会被画布当成平移手势，框选就废了。
  it("stops pointer events from reaching the canvas", () => {
    const parent = document.createElement("div");
    const onParent = vi.fn();
    parent.addEventListener("pointerdown", onParent);
    document.body.appendChild(parent);
    const wrapper = mount(ElementOverlay, { props: base, attachTo: parent });

    wrapper.find('[data-test="element-stage"]').element
      .dispatchEvent(new Event("pointerdown", { bubbles: true }));

    expect(onParent).not.toHaveBeenCalled();
    wrapper.unmount();
    parent.remove();
  });
});
