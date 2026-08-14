import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ElementProperties from "./ElementProperties.vue";
import type { ElementNode, Rect } from "@region-split/core/browser";

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

  // 测量会出错，所以位置尺寸必须能人工微调
  it("shows the geometry in editable inputs", () => {
    const wrapper = mount(ElementProperties, { props: { node } });
    expect((wrapper.find('[data-test="property-x"]').element as HTMLInputElement).value)
      .toBe("36");
    expect((wrapper.find('[data-test="property-h"]').element as HTMLInputElement).value)
      .toBe("222");
  });

  it("emits the whole box when one axis changes", async () => {
    const wrapper = mount(ElementProperties, { props: { node } });
    const input = wrapper.find('[data-test="property-y"]');
    await input.setValue("400");
    await input.trigger("change");
    expect(wrapper.emitted("set-box")![0]).toEqual([
      "n1", { x: 36, y: 400, w: 1098, h: 222 },
    ]);
  });

  // 清空输入框后不能停在非法状态：要么不提交，要么提交一个有限数交给
  // clampBox 收拢；无论哪条路，框里都得回到一个有效数字。
  it("never leaves the box in an invalid state", async () => {
    const wrapper = mount(ElementProperties, { props: { node } });
    const input = wrapper.find('[data-test="property-w"]');
    await input.setValue("");
    await input.trigger("change");
    const emitted = wrapper.emitted("set-box") as [string, Rect][] | undefined;
    if (emitted) {
      expect(Number.isFinite(emitted[0]![1].w)).toBe(true);
    }
    expect((input.element as HTMLInputElement).value).not.toBe("");
  });

  // 改动被 clampBox 拒绝时属性原样不动，输入框必须跟着回弹而不是留着脏值
  it("snaps the input back when the node does not change", async () => {
    const wrapper = mount(ElementProperties, { props: { node } });
    const input = wrapper.find('[data-test="property-x"]');
    await input.setValue("-9999");
    await input.trigger("change");
    // 父组件没有改 node，草稿要回到真实值
    await wrapper.setProps({ node: { ...node } });
    expect((input.element as HTMLInputElement).value).toBe("36");
  });

  it("follows the node when it really changes", async () => {
    const wrapper = mount(ElementProperties, { props: { node } });
    await wrapper.setProps({ node: { ...node, box: { x: 99, y: 88, w: 77, h: 66 } } });
    expect((wrapper.find('[data-test="property-x"]').element as HTMLInputElement).value)
      .toBe("99");
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

describe("ElementProperties box snap back", () => {
  // 钳制后的结果可能与原值相同（已经贴着父边还想再往左），
  // 这时 props 不变，输入框必须自己回弹而不是留着越界值
  it("snaps back when the clamped result equals the current value", async () => {
    const wrapper = mount(ElementProperties, { props: { node } });
    const input = wrapper.find('[data-test="property-x"]');
    await input.setValue("-9999");
    await input.trigger("change");
    expect(wrapper.emitted("set-box")).toBeTruthy();
    await nextTick();
    await nextTick();
    expect((input.element as HTMLInputElement).value).toBe("36");
  });
});
