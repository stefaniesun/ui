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
    repeat: { count: 5, templateId: "n2", pitch: 219.3, slotBy: "tool" },
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

  const listNode = (over: Partial<ElementNode> = {}): ElementNode => ({
    ...node, kind: "grid", displayName: "快捷功能菜单",
    repeat: { count: 5, templateId: "c1", pitch: 219.75, slot: { w: 141, h: 134 }, slotBy: "tool" },
    ...over,
  });

  it("shows the slot and the pitch for a list", () => {
    const wrapper = mount(ElementProperties, { props: { node: listNode() } });
    expect((wrapper.find('[data-test="slot-w"]').element as HTMLInputElement).value).toBe("141");
    expect((wrapper.find('[data-test="slot-h"]').element as HTMLInputElement).value).toBe("134");
    expect(wrapper.find('[data-test="list-pitch"]').text()).toContain("219.8");
  });

  it("emits set-slot when the slot changes", async () => {
    const wrapper = mount(ElementProperties, { props: { node: listNode() } });
    const input = wrapper.find('[data-test="slot-w"]');
    await input.setValue("150");
    await input.trigger("change");
    expect(wrapper.emitted("set-slot")![0]).toEqual(["n1", 150, 134]);
  });

  it("hides the slot row for a node that is not a list", () => {
    expect(mount(ElementProperties, { props: { node } })
      .find('[data-test="slot-w"]').exists()).toBe(false);
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

describe("ElementProperties nudge buttons", () => {
  const press = async (wrapper: ReturnType<typeof mount>, test: string) => {
    const button = wrapper.find(`[data-test="${test}"]`);
    await button.trigger("pointerdown");
    await button.trigger("pointerup");
  };

  it("moves the box one pixel per press", async () => {
    const wrapper = mount(ElementProperties, { props: { node } });
    await press(wrapper, "nudge-right");
    expect(wrapper.emitted("set-box")![0]).toEqual([
      "n1", { x: 37, y: 396, w: 1098, h: 222 },
    ]);
    await press(wrapper, "nudge-up");
    expect(wrapper.emitted("set-box")![1]).toEqual([
      "n1", { x: 36, y: 395, w: 1098, h: 222 },
    ]);
  });

  it("resizes the box one pixel per press", async () => {
    const wrapper = mount(ElementProperties, { props: { node } });
    await press(wrapper, "nudge-wider");
    expect(wrapper.emitted("set-box")![0]).toEqual([
      "n1", { x: 36, y: 396, w: 1099, h: 222 },
    ]);
    await press(wrapper, "nudge-shorter");
    expect(wrapper.emitted("set-box")![1]).toEqual([
      "n1", { x: 36, y: 396, w: 1098, h: 221 },
    ]);
  });

  // 每次都从 props 的当前值算起，所以父组件拒绝改动时不会累积漂移
  it("always nudges from the current node value", async () => {
    const wrapper = mount(ElementProperties, { props: { node } });
    await press(wrapper, "nudge-right");
    await press(wrapper, "nudge-right");
    const emitted = wrapper.emitted("set-box") as [string, Rect][];
    expect(emitted[0]![1].x).toBe(37);
    expect(emitted[1]![1].x).toBe(37);
  });

  it("does nothing without a selected node", () => {
    const wrapper = mount(ElementProperties, { props: { node: null } });
    expect(wrapper.find('[data-test="nudge-right"]').exists()).toBe(false);
  });
});

describe("ElementProperties border radius", () => {
  const card: ElementNode = { ...node, style: { background: "#ffffff", borderRadius: 34 } };

  it("shows a radius after the user has enabled it", () => {
    const wrapper = mount(ElementProperties, { props: { node: card } });
    expect((wrapper.find('[data-test="border-radius-toggle"]').element as HTMLInputElement).checked)
      .toBe(true);
    expect((wrapper.find('[data-test="property-radius"]').element as HTMLInputElement).value)
      .toBe("34");
  });

  it("enables a missing radius at eight pixels", async () => {
    const wrapper = mount(ElementProperties, { props: { node } });
    const toggle = wrapper.find('[data-test="border-radius-toggle"]');
    expect((toggle.element as HTMLInputElement).checked).toBe(false);
    expect(wrapper.find('[data-test="property-radius"]').exists()).toBe(false);
    await toggle.setValue(true);
    expect(wrapper.emitted("set-radius")![0]).toEqual(["n1", 8]);
  });

  it("disables a radius by setting it to zero", async () => {
    const wrapper = mount(ElementProperties, { props: { node: card } });
    await wrapper.find('[data-test="border-radius-toggle"]').setValue(false);
    expect(wrapper.emitted("set-radius")![0]).toEqual(["n1", 0]);
  });

  it("emits a new radius from the input", async () => {
    const wrapper = mount(ElementProperties, { props: { node: card } });
    const input = wrapper.find('[data-test="property-radius"]');
    await input.setValue("20");
    await input.trigger("change");
    expect(wrapper.emitted("set-radius")![0]).toEqual(["n1", 20]);
  });

  it("nudges the radius one pixel per press", async () => {
    const wrapper = mount(ElementProperties, { props: { node: card } });
    const plus = wrapper.find('[data-test="radius-plus"]');
    await plus.trigger("pointerdown");
    await plus.trigger("pointerup");
    expect(wrapper.emitted("set-radius")![0]).toEqual(["n1", 35]);
    const minus = wrapper.find('[data-test="radius-minus"]');
    await minus.trigger("pointerdown");
    await minus.trigger("pointerup");
    expect(wrapper.emitted("set-radius")![1]).toEqual(["n1", 33]);
  });

  it("offers the toggle only for images and components", () => {
    for (const kind of ["image", "component"] as const) {
      const wrapper = mount(ElementProperties, { props: { node: { ...node, kind } } });
      expect(wrapper.find('[data-test="border-radius-toggle"]').exists()).toBe(true);
    }
    for (const kind of ["grid", "text", "icon", "decoration"] as const) {
      const wrapper = mount(ElementProperties, { props: { node: { ...node, kind } } });
      expect(wrapper.find('[data-test="border-radius-toggle"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="property-radius"]').exists()).toBe(false);
    }
  });
});

describe("ElementProperties ink colour", () => {
  const label: ElementNode = {
    ...node, kind: "text", style: { color: "#191919" },
  };

  it("shows the measured colour", () => {
    const wrapper = mount(ElementProperties, { props: { node: label } });
    expect((wrapper.find('[data-test="property-color"]').element as HTMLInputElement).value)
      .toBe("#191919");
  });

  it("emits a new colour from the text field", async () => {
    const wrapper = mount(ElementProperties, { props: { node: label } });
    const input = wrapper.find('[data-test="property-color"]');
    await input.setValue("#0fb12c");
    await input.trigger("change");
    expect(wrapper.emitted("set-color")![0]).toEqual(["n1", "#0fb12c"]);
  });

  it("ignores a malformed colour", async () => {
    const wrapper = mount(ElementProperties, { props: { node: label } });
    const input = wrapper.find('[data-test="property-color"]');
    await input.setValue("绿色");
    await input.trigger("change");
    expect(wrapper.emitted("set-color")).toBeFalsy();
  });

  // 墨色属于内容；容器的颜色是背景色，另有一行
  it("hides the colour row on a container", () => {
    const wrapper = mount(ElementProperties, { props: { node } });
    expect(wrapper.find('[data-test="property-color"]').exists()).toBe(false);
  });

  it("shows the colour row on an icon and a decoration", () => {
    for (const kind of ["icon", "decoration"] as const) {
      const wrapper = mount(ElementProperties, { props: { node: { ...node, kind } } });
      expect(wrapper.find('[data-test="property-color"]').exists()).toBe(true);
    }
  });
});

describe("ElementProperties eyedropper", () => {
  const label: ElementNode = { ...node, kind: "text", style: { color: "#191919" } };

  it("offers an eyedropper next to the colour field", () => {
    const wrapper = mount(ElementProperties, { props: { node: label } });
    expect(wrapper.find('[data-test="pick-color"]').exists()).toBe(true);
  });

  it("emits toggle-picking when clicked", async () => {
    const wrapper = mount(ElementProperties, { props: { node: label } });
    await wrapper.find('[data-test="pick-color"]').trigger("click");
    expect(wrapper.emitted("toggle-picking")).toHaveLength(1);
  });

  it("marks the button active while picking", () => {
    const wrapper = mount(ElementProperties, { props: { node: label, picking: true } });
    expect(wrapper.find('[data-test="pick-color"]').classes()).toContain("on");
  });

  it("hides the eyedropper on a container", () => {
    const wrapper = mount(ElementProperties, { props: { node } });
    expect(wrapper.find('[data-test="pick-color"]').exists()).toBe(false);
  });
});

describe("ElementProperties font", () => {
  const label: ElementNode = {
    ...node, kind: "text", style: { fontSize: 29.8, fontWeight: 500 },
  };

  it("shows the fitted size and weight", () => {
    const wrapper = mount(ElementProperties, { props: { node: label } });
    expect((wrapper.find('[data-test="property-font-size"]').element as HTMLInputElement).value)
      .toBe("29.8");
    expect((wrapper.find('[data-test="property-font-weight"]').element as HTMLSelectElement).value)
      .toBe("500");
  });

  it("shows an empty size before it has been measured", () => {
    const wrapper = mount(ElementProperties, {
      props: { node: { ...node, kind: "text" as const } },
    });
    expect((wrapper.find('[data-test="property-font-size"]').element as HTMLInputElement).value)
      .toBe("");
  });

  it("emits a size change", async () => {
    const wrapper = mount(ElementProperties, { props: { node: label } });
    const input = wrapper.find('[data-test="property-font-size"]');
    await input.setValue("32");
    await input.trigger("change");
    expect(wrapper.emitted("set-font")![0]).toEqual(["n1", { fontSize: 32 }]);
  });

  it("emits a weight change", async () => {
    const wrapper = mount(ElementProperties, { props: { node: label } });
    await wrapper.find('[data-test="property-font-weight"]').setValue("700");
    expect(wrapper.emitted("set-font")![0]).toEqual(["n1", { fontWeight: 700 }]);
  });

  it("asks for a measurement", async () => {
    const wrapper = mount(ElementProperties, { props: { node: label } });
    await wrapper.find('[data-test="measure-font"]').trigger("click");
    expect(wrapper.emitted("measure-font")).toHaveLength(1);
  });

  // 把握不大时要说出来，而不是给个看起来很确定的数字
  it("surfaces the confidence note", () => {
    const wrapper = mount(ElementProperties, {
      props: { node: label, fontNote: "字重把握不大" },
    });
    expect(wrapper.find('[data-test="font-note"]').text()).toContain("把握不大");
  });

  // 字号字重属于文字；图标和容器没有这个概念
  it("hides the font rows on non text nodes", () => {
    for (const kind of ["icon", "image", "component"] as const) {
      const wrapper = mount(ElementProperties, { props: { node: { ...node, kind } } });
      expect(wrapper.find('[data-test="property-font-size"]').exists()).toBe(false);
    }
  });

  const textNode = (over: Partial<ElementNode>): ElementNode =>
    ({ ...node, kind: "text", displayName: "联系客服", ...over });

  it("blocks font measurement on a suspect box and says why", () => {
    const wrapper = mount(ElementProperties, {
      props: {
        node: textNode({
          textBox: { ok: false, bands: 2, glyphAspect: 0.9, reason: "multi-band" },
        }),
      },
    });
    expect(wrapper.find('[data-test="measure-font"]').attributes("disabled")).toBeDefined();
    expect(wrapper.find('[data-test="font-blocked"]').text()).toContain("这个框不止一行文字");
  });

  it("names the other reason", () => {
    const wrapper = mount(ElementProperties, {
      props: {
        node: textNode({
          textBox: { ok: false, bands: 1, glyphAspect: 2.4, reason: "wide-glyph" },
        }),
      },
    });
    expect(wrapper.find('[data-test="font-blocked"]').text()).toContain("不像字形");
  });

  it("allows font measurement on a box that passed", () => {
    const wrapper = mount(ElementProperties, {
      props: { node: textNode({ textBox: { ok: true, bands: 1, glyphAspect: 0.94 } }) },
    });
    expect(wrapper.find('[data-test="measure-font"]').attributes("disabled")).toBeUndefined();
    expect(wrapper.find('[data-test="font-blocked"]').exists()).toBe(false);
  });

  // 没检查过不等于有问题
  it("allows font measurement on an unchecked box", () => {
    const wrapper = mount(ElementProperties, { props: { node: textNode({}) } });
    expect(wrapper.find('[data-test="measure-font"]').attributes("disabled")).toBeUndefined();
  });
});
