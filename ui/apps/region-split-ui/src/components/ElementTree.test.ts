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
});
