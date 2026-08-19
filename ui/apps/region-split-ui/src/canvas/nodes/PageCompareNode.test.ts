import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import PageCompareNode from "./PageCompareNode.vue";

const payload = {
  html: '<section class="region"><img src="assets/a.png"></section>',
  css: ".region { background: #fff; }",
  assets: [{ path: "assets/a.png", contentBase64: "AAAA" }],
};
const stubApi = (result: typeof payload | Error = payload) => ({
  getPageCode: vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  }),
});
const mountNode = (api = stubApi()) => mount(PageCompareNode, {
  props: { projectId: "p1", api, imageSize: { w: 1170, h: 2532 } },
});

describe("PageCompareNode", () => {
  it("offers to build the comparison before anything is loaded", () => {
    expect(mountNode().find('[data-test="build-page"]').exists()).toBe(true);
  });
  it("renders the page over the original at the image aspect ratio", async () => {
    const api = stubApi();
    const wrapper = mountNode(api);
    await wrapper.find('[data-test="build-page"]').trigger("click");
    await nextTick(); await nextTick();
    expect(api.getPageCode).toHaveBeenCalledWith("p1");
    expect(wrapper.find('[data-test="page-stack"]').attributes("style")).toContain("1170 / 2532");
    expect(wrapper.find('[data-test="page-frame"]').attributes("srcdoc")).toContain("data:image/png;base64,AAAA");
  });
  it("moves the overlay opacity", async () => {
    const wrapper = mountNode();
    await wrapper.find('[data-test="build-page"]').trigger("click");
    await nextTick(); await nextTick();
    await wrapper.find('[data-test="page-opacity"]').setValue("30");
    expect(wrapper.find('[data-test="page-frame"]').attributes("style")).toContain("0.3");
  });
  it("explains that some region has not been parsed", async () => {
    const wrapper = mountNode(stubApi(new Error("region not parsed")));
    await wrapper.find('[data-test="build-page"]').trigger("click");
    await nextTick(); await nextTick();
    expect(wrapper.find('[data-test="page-error"]').text()).toContain("还有区域没有解析");
  });
});
