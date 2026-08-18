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
  mount(CodeNode, { props: { projectId: "p1", region: region(0, 100), api, ...over } });

describe("CodeNode", () => {
  // 现在这个节点只在「区域详情」里点了「生成代码」后才会开出来，每个节点必定对应
  // 一个确定的区域——不再有"未选择"或"选了多个"的中间态，所以旧的两条提示文案
  // 断言（"选择一个区域" / "请选择单个区域"）已经不成立，替换成：节点一挂载
  // 就直接可以生成，不需要任何提示。
  it("starts generating immediately and shows an animated waiting state", async () => {
    let resolve!: (code: { html: string; css: string }) => void;
    const api = { getCode: vi.fn(() => new Promise<{ html: string; css: string }>((done) => { resolve = done; })) };
    const wrapper = mountNode({ region: region(0, 338) }, api);

    expect(api.getCode).toHaveBeenCalledTimes(1);
    expect(api.getCode).toHaveBeenCalledWith("p1", 0, 338);
    expect(wrapper.get('[data-test="code-loading"]').text()).toContain("正在生成代码");
    expect(wrapper.get('[data-test="generate-code"]').attributes("disabled")).toBeDefined();

    resolve({ html: '<section class="region"></section>', css: ".region {}" });
    await nextTick(); await nextTick();
    expect(wrapper.find('[data-test="code-loading"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="code-frame"]').attributes("srcdoc")).toContain('class="region"');
  });

  it("explains that the region has not been parsed yet", async () => {
    const wrapper = mountNode({ region: region(0, 338) }, stubApi(null));
    await nextTick(); await nextTick();
    expect(wrapper.find('[data-test="code-error"]').text()).toContain("先在区域详情里解析元素");
  });

  it("moves the overlay opacity", async () => {
    const wrapper = mountNode({ region: region(0, 338) }, stubApi({ html: "<section></section>", css: "" }));
    await nextTick(); await nextTick();
    await wrapper.find('[data-test="overlay-opacity"]').setValue("30");
    expect(wrapper.find('[data-test="code-frame"]').attributes("style")).toContain("0.3");
  });

  it("automatically regenerates after the region changes and ignores the old result", async () => {
    const resolvers: Array<(code: { html: string; css: string }) => void> = [];
    const api = { getCode: vi.fn(() => new Promise<{ html: string; css: string }>((done) => { resolvers.push(done); })) };
    const wrapper = mountNode({ region: region(0, 338) }, api);
    await wrapper.setProps({ region: region(400, 200) });
    expect(api.getCode).toHaveBeenNthCalledWith(2, "p1", 400, 200);

    resolvers[0]!({ html: "<section>old</section>", css: "" });
    await nextTick(); await nextTick();
    expect(wrapper.find('[data-test="code-frame"]').exists()).toBe(false);

    resolvers[1]!({ html: "<section>new</section>", css: "" });
    await nextTick(); await nextTick();
    expect(wrapper.get('[data-test="code-frame"]').attributes("srcdoc")).toContain("new");
  });
});
