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

describe("ElementProperties layout fields", () => {
  const container: ElementNode = {
    ...node,
    kind: "grid",
    layout: { direction: "row", gap: 98, padding: { top: 0, right: 42, bottom: 0, left: 38 } },
    repeat: { count: 5, templateId: "n2", pitch: 219.3 },
  };

  it("shows the cut direction and gap", () => {
    const text = mount(ElementProperties, { props: { node: container } }).text();
    expect(text).toContain("横排");
    expect(text).toContain("gap 98");
  });

  it("shows the padding in css order", () => {
    const wrapper = mount(ElementProperties, { props: { node: container } });
    expect(wrapper.find('[data-test="property-padding"]').text().split(/\s+/))
      .toEqual(["0", "42", "0", "38"]);
  });

  it("shows the repeat count and pitch", () => {
    const wrapper = mount(ElementProperties, { props: { node: container } });
    expect(wrapper.find('[data-test="property-repeat"]').text()).toContain("×5");
    expect(wrapper.find('[data-test="property-repeat"]').text()).toContain("219");
  });

  it("hides layout fields on a node that was never cut", () => {
    const wrapper = mount(ElementProperties, { props: { node } });
    expect(wrapper.find('[data-test="property-layout"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="property-repeat"]').exists()).toBe(false);
  });

  it("toggles scroll on a container", async () => {
    const wrapper = mount(ElementProperties, { props: { node: container } });
    await wrapper.find('[data-test="property-scroll-x"]').trigger("click");
    expect(wrapper.emitted("set-scroll")![0]).toEqual(["n1", "x", true]);
  });

  // 滚动是容器的属性，叶子上没有意义
  it("hides the scroll toggles on a leaf", () => {
    const wrapper = mount(ElementProperties, {
      props: { node: { ...node, kind: "image" as const } },
    });
    expect(wrapper.find('[data-test="property-scroll-x"]').exists()).toBe(false);
  });
});
