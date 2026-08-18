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
});
