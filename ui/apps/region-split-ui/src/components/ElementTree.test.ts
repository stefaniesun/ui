import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ElementTree from "./ElementTree.vue";
import type { ElementNode } from "@region-split/core/browser";

function node(over: Partial<ElementNode> & Pick<ElementNode, "id">): ElementNode {
  return {
    parentId: null, box: { x: 0, y: 0, w: 100, h: 100 }, kind: "component",
    displayName: "节点", style: {}, uniformity: 1, source: "auto",
    classification: "tool", scrollX: false, scrollY: false, positioning: "flow", ...over,
  };
}
const nodes = [
  node({ id: "n1", displayName: "卡片" }),
  node({ id: "n2", parentId: "n1", displayName: "文字", kind: "text" }),
];
const mountTree = (props: Record<string, unknown> = {}) =>
  mount(ElementTree, { props: { nodes, selectedId: null, hoveredId: null, ...props } });

describe("ElementTree", () => {
  it("renders one row per node", () => {
    const wrapper = mountTree();
    expect(wrapper.findAll('[data-test="element-row"]')).toHaveLength(2);
    expect(wrapper.text()).toContain("卡片");
    expect(wrapper.text()).toContain("文字");
  });

  it("shows dot-separated hierarchy numbers without changing nodes", () => {
    const input = [
      node({ id: "n1", displayName: "卡片" }),
      node({ id: "n2", parentId: "n1", displayName: "文字", kind: "text" }),
      node({ id: "n3", parentId: "n2", displayName: "深层", kind: "icon" }),
      node({ id: "n4", displayName: "另一个根" }),
      node({ id: "n5", parentId: "n4", displayName: "子节点", kind: "image" }),
    ];
    const interleaved = [input[3]!, input[1]!, input[0]!, input[4]!, input[2]!];
    const snapshot = structuredClone(interleaved);
    const wrapper = mountTree({ nodes: interleaved });
    expect(wrapper.findAll('[data-test="element-number"]').map((item) => item.text()))
      .toEqual(["1", "1.1", "2", "2.1", "2.1.1"]);
    expect(wrapper.findAll('[data-test="element-name"]').map((item) => item.text()))
      .toEqual(["另一个根", "子节点", "卡片", "文字", "深层"]);
    expect(interleaved).toEqual(snapshot);
  });

  it("indents children below their parent", () => {
    const rows = mountTree().findAll('[data-test="element-row"]');
    expect(rows[0]!.attributes("style")).toContain("--depth: 0");
    expect(rows[1]!.attributes("style")).toContain("--depth: 1");
  });

  it("shows a placeholder when nothing is parsed", () => {
    expect(mountTree({ nodes: [] }).text()).toContain("尚未解析");
  });

  it("emits select when a row is clicked", async () => {
    const wrapper = mountTree();
    await wrapper.findAll('[data-test="element-row"]')[1]!.trigger("click");
    expect(wrapper.emitted("select")![0]).toEqual(["n2"]);
  });

  it("emits hover on enter and leave", async () => {
    const wrapper = mountTree();
    const row = wrapper.findAll('[data-test="element-row"]')[0]!;
    await row.trigger("mouseenter");
    await row.trigger("mouseleave");
    expect(wrapper.emitted("hover")).toEqual([["n1"], [null]]);
  });

  it("shows the remove button only on the selected row", async () => {
    const wrapper = mountTree({ selectedId: "n2" });
    expect(wrapper.findAll('[data-test="element-remove"]')).toHaveLength(1);
    await wrapper.find('[data-test="element-remove"]').trigger("click");
    expect(wrapper.emitted("remove")![0]).toEqual(["n2"]);
  });

  it("emits rename on double click", async () => {
    const wrapper = mountTree();
    await wrapper.findAll('[data-test="element-name"]')[0]!.trigger("dblclick");
    expect(wrapper.emitted("rename")![0]).toEqual(["n1"]);
  });

  it("marks an uncertain node", () => {
    const wrapper = mountTree({ nodes: [node({ id: "n1", classification: "uncertain" })] });
    expect(wrapper.find('[data-test="element-row"]').classes()).toContain("uncertain");
  });

  it("flags a text node whose box failed the check", () => {
    const wrapper = mountTree({
      nodes: [node({
        id: "n1", kind: "text",
        textBox: { ok: false, bands: 2, glyphAspect: 0.9, reason: "multi-band" },
      })],
    });
    expect(wrapper.find('[data-test="text-box-suspect"]').exists()).toBe(true);
  });

  it("does not flag a text node that passed", () => {
    const wrapper = mountTree({
      nodes: [node({ id: "n1", kind: "text", textBox: { ok: true, bands: 1, glyphAspect: 0.94 } })],
    });
    expect(wrapper.find('[data-test="text-box-suspect"]').exists()).toBe(false);
  });

  // 没检查过不等于有问题，不能标
  it("does not flag an unchecked node", () => {
    const wrapper = mountTree({ nodes: [node({ id: "n1", kind: "text" })] });
    expect(wrapper.find('[data-test="text-box-suspect"]').exists()).toBe(false);
  });

  // setKind 会清掉 textBox，这条路径基本走不到，但保险起见：
  // 一个已经改成非文字 kind 的节点不该再顶着旧的存疑徽标
  it("does not flag a node whose kind is no longer text", () => {
    const wrapper = mountTree({
      nodes: [node({
        id: "n1", kind: "icon",
        textBox: { ok: false, bands: 2, glyphAspect: 0.9, reason: "multi-band" },
      })],
    });
    expect(wrapper.find('[data-test="text-box-suspect"]').exists()).toBe(false);
  });
});

describe("ElementTree layout badges", () => {
  it("shows direction, gap and repeat on a container row", () => {
    const wrapper = mountTree({
      nodes: [node({
        id: "n1", kind: "grid",
        layout: { direction: "row", gap: 98, padding: { top: 0, right: 0, bottom: 0, left: 0 } },
        repeat: { count: 5, templateId: "n2", pitch: 220, slotBy: "tool" },
      })],
    });
    expect(wrapper.find('[data-test="element-repeat"]').text()).toBe("×5");
    expect(wrapper.find('[data-test="element-layout"]').text()).toBe("→98");
  });

  it("shows a scroll badge", () => {
    const wrapper = mountTree({ nodes: [node({ id: "n1", scrollX: true })] });
    expect(wrapper.text()).toContain("↔");
  });

  it("shows no badges on a plain leaf", () => {
    const wrapper = mountTree({ nodes: [node({ id: "n1", kind: "text" })] });
    expect(wrapper.find('[data-test="element-layout"]').exists()).toBe(false);
  });

  it("calls a repeat container a list with its count", () => {
    const wrapper = mountTree({
      nodes: [node({
        id: "n1", kind: "grid", displayName: "快捷功能菜单",
        repeat: { count: 5, templateId: "n2", pitch: 219.75, slot: { w: 141, h: 134 }, slotBy: "tool" },
      })],
    });
    expect(wrapper.find('[data-test="list-badge"]').text()).toBe("列表 ×5");
  });

  it("leaves an ordinary container alone", () => {
    expect(mountTree({ nodes: [node({ id: "n1", kind: "component" })] })
      .find('[data-test="list-badge"]').exists()).toBe(false);
  });
});
