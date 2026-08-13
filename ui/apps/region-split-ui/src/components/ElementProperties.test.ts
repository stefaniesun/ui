import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ElementProperties from "./ElementProperties.vue";
import type { ElementNode } from "@region-split/core/browser";

const node: ElementNode = {
  id: "n1", parentId: null, box: { x: 36, y: 396, w: 1098, h: 222 },
  kind: "component", displayName: "卡券资产", style: { background: "#ffffff" },
  uniformity: 0.93, source: "auto", classification: "tool",
  scrollX: false, scrollY: false, positioning: "flow",
};

describe("ElementProperties", () => {
  it("prompts when nothing is selected", () => {
    expect(mount(ElementProperties, { props: { node: null } }).text())
      .toContain("选择一个元素查看属性");
  });

  it("shows the measured geometry", () => {
    const text = mount(ElementProperties, { props: { node } }).text();
    expect(text).toContain("36, 396");
    expect(text).toContain("1098×222");
  });

  it("shows the background and uniformity", () => {
    const text = mount(ElementProperties, { props: { node } }).text();
    expect(text).toContain("#ffffff");
    expect(text).toContain("0.93");
  });

  it("emits rename when the name input changes", async () => {
    const wrapper = mount(ElementProperties, { props: { node } });
    const input = wrapper.find('[data-test="property-name"]');
    await input.setValue("资产卡片");
    await input.trigger("change");
    expect(wrapper.emitted("rename")![0]).toEqual(["n1", "资产卡片"]);
  });

  it("emits set-kind when the kind select changes", async () => {
    const wrapper = mount(ElementProperties, { props: { node } });
    await wrapper.find('[data-test="property-kind"]').setValue("grid");
    expect(wrapper.emitted("set-kind")![0]).toEqual(["n1", "grid"]);
  });

  // 位置尺寸是测量结果，不接受人工改
  it("renders geometry as read only text, not an input", () => {
    const wrapper = mount(ElementProperties, { props: { node } });
    expect(wrapper.find('[data-test="property-box"]').element.tagName).toBe("CODE");
  });

  it("shows a dash when the node has no background", () => {
    const wrapper = mount(ElementProperties, {
      props: { node: { ...node, style: {}, kind: "image" as const, uniformity: 0.02 } },
    });
    expect(wrapper.text()).toContain("—");
    expect(wrapper.text()).toContain("0.02");
  });
});
