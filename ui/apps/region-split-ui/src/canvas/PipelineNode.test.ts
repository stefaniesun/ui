import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PipelineNode from "./PipelineNode.vue";

describe("PipelineNode", () => {
  it("emits close without starting drag", async () => {
    const wrapper = mount(PipelineNode, {
      props: {
        nodeId: "detail:r1",
        title: "区域详情",
        position: { x: 0, y: 0 },
        closable: true,
      },
    });
    await wrapper.get('[data-test="close-node"]').trigger("pointerdown");
    await wrapper.get('[data-test="close-node"]').trigger("click");
    expect(wrapper.emitted("close")).toEqual([["detail:r1"]]);
    expect(wrapper.emitted("dragStart")).toBeUndefined();
  });

  it("applies an accent color to the node and input port", () => {
    const wrapper = mount(PipelineNode, {
      props: {
        nodeId: "detail:r1",
        title: "区域详情",
        position: { x: 0, y: 0 },
        accentColor: "#ff5d7d",
        input: true,
        status: "active",
      },
    });
    expect(wrapper.attributes("style")).toContain("--node-accent: #ff5d7d");
    const expected = document.createElement("span");
    expected.style.borderColor = "#ff5d7d";
    expect((wrapper.get(".input-port").element as HTMLElement).style.borderColor)
      .toBe(expected.style.borderColor);
    expect((wrapper.get(".status-dot").element as HTMLElement).style.backgroundColor)
      .toBe(expected.style.borderColor);
  });

  it("renders focus highlight", () => {
    const wrapper = mount(PipelineNode, {
      props: {
        nodeId: "detail:r1",
        title: "区域详情",
        position: { x: 0, y: 0 },
        highlighted: true,
      },
    });
    expect(wrapper.classes()).toContain("is-highlighted");
  });

  it("uses explicit frame dimensions", () => {
    const wrapper = mount(PipelineNode, {
      props: { nodeId: "detail:r1", title: "区域详情", position: { x: 0, y: 0 }, width: 960, height: 620 },
    });
    expect(wrapper.attributes("style")).toContain("width: 960px");
    expect(wrapper.attributes("style")).toContain("height: 620px");
  });

  it("renders three frame resize handles and emits their direction", async () => {
    const wrapper = mount(PipelineNode, {
      props: {
        nodeId: "detail:r1", title: "区域详情", position: { x: 0, y: 0 },
        width: 960, height: 620, resizable: true,
      },
    });

    expect(wrapper.findAll('[data-test^="node-resize-"]')).toHaveLength(3);
    await wrapper.get('[data-test="node-resize-right"]').trigger("pointerdown");
    await wrapper.get('[data-test="node-resize-bottom"]').trigger("pointerdown");
    await wrapper.get('[data-test="node-resize-corner"]').trigger("pointerdown");
    expect(wrapper.emitted("resizeStart")?.map(event => event.slice(1))).toEqual([
      ["detail:r1", "right"], ["detail:r1", "bottom"], ["detail:r1", "corner"],
    ]);
  });
});
