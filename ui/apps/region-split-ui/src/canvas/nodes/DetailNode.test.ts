import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import DetailNode from "./DetailNode.vue";
import { createElementStore } from "../../element-state.js";
import type { StoreApi } from "../../api.js";
import type { ElementTree, Region } from "@region-split/core/browser";

function stubApi(tree: ElementTree | null = null): StoreApi {
  return {
    upload: vi.fn(), getProject: vi.fn(), putRegions: vi.fn(), analyze: vi.fn(),
    renameAi: vi.fn(), getModelConfig: vi.fn(),
    getElements: vi.fn(async () => ({ tree })),
    detectElements: vi.fn(async () => ({ tree: tree ?? emptyTree() })),
    putElements: vi.fn(),
  } as unknown as StoreApi;
}
const emptyTree = (): ElementTree =>
  ({ regionKey: "0-300", detectedAt: "2026-08-13T00:00:00.000Z", nodes: [] });

const region = (id: string, y: number, h: number): Region => ({
  id, displayName: `名-${id}`, type: "other", bounds: { x: 0, y, w: 400, h },
  confidence: 1, scrollX: false, scrollY: false,
});

const mountNode = (over: Record<string, unknown> = {}, tree: ElementTree | null = null) =>
  mount(DetailNode, {
    props: {
      projectId: "p1", selectedRegions: [], elementStore: createElementStore(stubApi(tree)),
      ...over,
    },
    global: { stubs: { ElementOverlay: true, ElementTree: true, ElementProperties: true } },
  });

describe("DetailNode", () => {
  it("asks for a selection when nothing is selected", () => {
    expect(mountNode().text()).toContain("选择一个区域查看详情");
  });

  it("asks for a single selection when several are selected", () => {
    const wrapper = mountNode({ selectedRegions: [region("a", 0, 100), region("b", 100, 100)] });
    expect(wrapper.text()).toContain("请选择单个区域");
    expect(wrapper.find('[data-test="detect-elements"]').exists()).toBe(false);
  });

  it("offers detection for a single region", () => {
    const wrapper = mountNode({ selectedRegions: [region("a", 0, 300)] });
    expect(wrapper.find('[data-test="detect-elements"]').text()).toBe("解析元素");
  });

  it("shows the region name and size", () => {
    const wrapper = mountNode({ selectedRegions: [region("a", 0, 300)] });
    expect(wrapper.text()).toContain("名-a");
    expect(wrapper.text()).toContain("400×300");
  });

  // 上下结构：图在上、树与属性在下
  it("stacks the image above the inspector", () => {
    const wrapper = mountNode({ selectedRegions: [region("a", 0, 300)] });
    expect(wrapper.find('[data-test="detail-image"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="detail-inspector"]').exists()).toBe(true);
  });

  it("hides the empty notice before anything is parsed", () => {
    const wrapper = mountNode({ selectedRegions: [region("a", 0, 300)] });
    expect(wrapper.find('[data-test="empty-result"]').exists()).toBe(false);
  });

  // 阶段一检不出小元素是正常的，界面必须说清楚，否则看起来像坏了
  it("explains an empty result after parsing", async () => {
    const store = createElementStore(stubApi(emptyTree()));
    const wrapper = mount(DetailNode, {
      props: {
        projectId: "p1", selectedRegions: [region("a", 0, 300)], elementStore: store,
      },
      global: { stubs: { ElementOverlay: true, ElementTree: true, ElementProperties: true } },
    });
    await store.detect("p1", { x: 0, y: 0, w: 400, h: 300 });
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-test="empty-result"]').text()).toContain("未检出顶层容器");
  });

  // jsdom 没有 PointerEvent，所以挂一个父级监听器看事件有没有冒泡上去——
  // 冒泡出去就会被画布当成平移手势。
  it("stops pointer events from reaching the canvas", () => {
    const parent = document.createElement("div");
    const onParent = vi.fn();
    parent.addEventListener("pointerdown", onParent);
    document.body.appendChild(parent);
    const wrapper = mount(DetailNode, {
      props: {
        projectId: "p1", selectedRegions: [region("a", 0, 300)],
        elementStore: createElementStore(stubApi()),
      },
      global: { stubs: { ElementOverlay: true, ElementTree: true, ElementProperties: true } },
      attachTo: parent,
    });

    wrapper.find(".detail-node").element
      .dispatchEvent(new Event("pointerdown", { bubbles: true }));

    expect(onParent).not.toHaveBeenCalled();
    wrapper.unmount();
    parent.remove();
  });
});

describe("DetailNode eyedropper", () => {
  const one = [region("a", 0, 300)];

  it("shows no picking hint by default", () => {
    const wrapper = mountNode({ selectedRegions: one });
    expect(wrapper.find('[data-test="picking-hint"]').exists()).toBe(false);
    expect(wrapper.find(".source-frame").classes()).not.toContain("picking");
  });

  // 读不到像素就别假装进入取色态。jsdom 没有真实 canvas，正好覆盖这条路径；
  // 真实浏览器里的取色行为由手工验收覆盖，单测碰不到 getImageData。
  it("refuses to enter picking mode when pixels cannot be read", async () => {
    const wrapper = mountNode({ selectedRegions: one });
    await wrapper.findComponent({ name: "ElementProperties" }).vm.$emit("toggle-picking");
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-test="picking-hint"]').exists()).toBe(false);
  });

  it("keeps the source image clean when not picking", () => {
    const wrapper = mountNode({ selectedRegions: one });
    expect(wrapper.find('[data-test="pick-preview"]').exists()).toBe(false);
  });
});
