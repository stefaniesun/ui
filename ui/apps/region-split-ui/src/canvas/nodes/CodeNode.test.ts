import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import CodeNode from "./CodeNode.vue";
import type { Region } from "@region-split/core/browser";

const region = (y: number, h: number): Region => ({
  id: `r-${y}`, displayName: "账户顶部", type: "other", bounds: { x: 0, y, w: 1170, h },
  confidence: 1, scrollX: false, scrollY: false,
});
const stubApi = (code: { html: string; css: string } | null = null) => ({
  getCode: vi.fn(async () => {
    if (!code) throw new Error("region not parsed");
    return code;
  }),
});
const mountNode = (over: Record<string, unknown> = {}, api = stubApi()) =>
  mount(CodeNode, { props: { projectId: "p1", selectedRegions: [], api, ...over } });

describe("CodeNode", () => {
  it("asks for a selection when nothing is selected", () => expect(mountNode().text()).toContain("选择一个区域"));
  it("asks for a single selection when several are selected", () => {
    expect(mountNode({ selectedRegions: [region(0, 100), region(100, 100)] }).text()).toContain("请选择单个区域");
  });
  it("generates on demand and renders the result in an iframe", async () => {
    const api = stubApi({ html: '<section class="region"></section>', css: ".region {}" });
    const wrapper = mountNode({ selectedRegions: [region(0, 338)] }, api);
    await wrapper.find('[data-test="generate-code"]').trigger("click"); await nextTick(); await nextTick();
    expect(api.getCode).toHaveBeenCalledWith("p1", 0, 338);
    expect(wrapper.find('[data-test="code-frame"]').attributes("srcdoc")).toContain('class="region"');
  });
  it("explains that the region has not been parsed yet", async () => {
    const wrapper = mountNode({ selectedRegions: [region(0, 338)] }, stubApi(null));
    await wrapper.find('[data-test="generate-code"]').trigger("click"); await nextTick(); await nextTick();
    expect(wrapper.find('[data-test="code-error"]').text()).toContain("先在区域详情里解析元素");
  });
  it("moves the overlay opacity", async () => {
    const wrapper = mountNode({ selectedRegions: [region(0, 338)] }, stubApi({ html: "<section></section>", css: "" }));
    await wrapper.find('[data-test="generate-code"]').trigger("click"); await nextTick(); await nextTick();
    await wrapper.find('[data-test="overlay-opacity"]').setValue("30");
    expect(wrapper.find('[data-test="code-frame"]').attributes("style")).toContain("0.3");
  });
  it("drops the previous output when the region changes", async () => {
    const wrapper = mountNode({ selectedRegions: [region(0, 338)] }, stubApi({ html: "<section></section>", css: "" }));
    await wrapper.find('[data-test="generate-code"]').trigger("click"); await nextTick(); await nextTick();
    await wrapper.setProps({ selectedRegions: [region(400, 200)] }); await nextTick();
    expect(wrapper.find('[data-test="code-frame"]').exists()).toBe(false);
  });
});
