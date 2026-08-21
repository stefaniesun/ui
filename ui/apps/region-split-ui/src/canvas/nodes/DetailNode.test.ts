import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import DetailNode from "./DetailNode.vue";
import { createElementStore } from "../../element-state.js";
import type { StoreApi } from "../../api.js";
import { DEFAULT_REGION_DETAIL_LAYOUT } from "../../region-detail-layout.js";
import type { ElementNode, ElementTree, Region } from "@region-split/core/browser";

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
const element = (over: Partial<ElementNode> & Pick<ElementNode, "id">): ElementNode => ({
  parentId: null, box: { x: 0, y: 0, w: 100, h: 100 }, kind: "component", displayName: "节点",
  style: {}, uniformity: 1, source: "auto", classification: "tool", scrollX: false, scrollY: false,
  positioning: "flow", ...over,
});
const parsedTree = (): ElementTree => ({
  ...emptyTree(),
  nodes: [element({ id: "root", displayName: "登录区" }), element({ id: "child", parentId: "root", displayName: "用户头像", kind: "icon" })],
});

const region = (id: string, y: number, h: number): Region => ({
  id, displayName: `名-${id}`, bounds: { x: 0, y, w: 400, h },
  confidence: 1, scrollX: false, scrollY: false,
});

const mountNode = (over: Record<string, unknown> = {}, tree: ElementTree | null = null) =>
  mount(DetailNode, {
    props: {
      projectId: "p1", region: region("a", 0, 300), elementStore: createElementStore(stubApi(tree)),
      layout: { ...DEFAULT_REGION_DETAIL_LAYOUT }, updateLayout: vi.fn(), saveLayout: vi.fn(),
      ...over,
    },
    global: { stubs: { ElementOverlay: true, ElementTree: true, ElementProperties: true } },
  });

describe("DetailNode", () => {
  it("offers detection for its region", () => {
    expect(mountNode().find('[data-test="detect-elements"]').text()).toBe("解析元素");
  });

  it("emits parsed after detecting the region", async () => {
    const wrapper = mountNode();
    await flushPromises();
    await wrapper.get('[data-test="detect-elements"]').trigger("click");
    await flushPromises();
    expect(wrapper.emitted("parsed")).toHaveLength(1);
  });

  it("shows the shared AI animation over the region while detecting elements", async () => {
    let resolveDetection!: (value: { tree: ElementTree }) => void;
    const api = stubApi();
    api.detectElements = vi.fn(() => new Promise<{ tree: ElementTree }>((resolve) => { resolveDetection = resolve; }));
    const store = createElementStore(api);
    const wrapper = mountNode({ elementStore: store });
    await flushPromises();

    const pending = wrapper.get('[data-test="detect-elements"]').trigger("click");
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-test="ai-processing-indicator"]').text()).toContain("AI 正在解析元素");
    expect(wrapper.find('[data-test="ai-processing-focus"]').exists()).toBe(true);

    resolveDetection({ tree: emptyTree() });
    await pending;
    await flushPromises();
    expect(wrapper.find('[data-test="ai-processing-indicator"]').exists()).toBe(false);
  });

  it("shows the region name and size", () => {
    const wrapper = mountNode({ region: region("a", 0, 300) });
    expect(wrapper.text()).toContain("名-a");
    expect(wrapper.text()).toContain("400×300");
  });

  it("places elements below the image and AI calibration in the right column", async () => {
    const wrapper = mountNode({ region: region("a", 0, 300) }, emptyTree());
    await wrapper.vm.$nextTick();

    const workspace = wrapper.get('[data-test="detail-workspace"]');
    const image = workspace.get('[data-test="detail-image"]');
    const imageFit = image.get('[data-test="detail-image-fit"]');
    const inspector = workspace.get('[data-test="detail-inspector"]');
    expect(imageFit.findComponent({ name: "ElementOverlay" }).exists()).toBe(true);
    expect(workspace.element.firstElementChild).toBe(image.element);
    expect(image.element.nextElementSibling).toBe(inspector.element);
    expect(inspector.findComponent({ name: "ElementTree" }).exists()).toBe(true);
    expect(inspector.findComponent({ name: "ElementProperties" }).exists()).toBe(true);
    expect(inspector.find('[data-test="detail-ai-column"]').exists()).toBe(false);

    const aiColumn = workspace.get('[data-test="detail-ai-column"]');
    expect(workspace.element.lastElementChild).toBe(aiColumn.element);
    expect(aiColumn.find('[data-test="ai-refactor-panel"]').exists()).toBe(true);
    expect(aiColumn.find('[data-test="ai-conversation-scroll"]').exists()).toBe(true);
    expect(aiColumn.find('[data-test="ai-composer"]').exists()).toBe(true);
  });

  it("removes layout copy and exposes all four region controls", async () => {
    const wrapper = mountNode({ region: region("a", 0, 300) }, emptyTree());
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).not.toContain("元素解析图");
    expect(wrapper.find('[data-test="detail-layout-values"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="detail-layout-save"]').text()).toBe("保存布局");
    expect(wrapper.get('[data-test="detail-tree-resizer"]').attributes("aria-orientation")).toBe("vertical");
    expect(wrapper.get('[data-test="detail-ai-resizer"]').attributes("aria-orientation")).toBe("vertical");
    expect(wrapper.get('[data-test="detail-inspector-resizer"]').attributes("aria-orientation")).toBe("horizontal");
    expect(wrapper.find('[data-test="detail-image-resizer"]').exists()).toBe(true);
    const style = wrapper.get('[data-test="detail-workspace"]').attributes("style");
    expect(style).toContain("--detail-image-aspect: 1.3333333333333333");
    expect(style).toContain("--detail-inspector-min-height: 240px");
    expect(style).not.toContain("--detail-inspector-height:");
  });

  it("explicitly saves the current instance layout", async () => {
    const saveLayout = vi.fn();
    const wrapper = mountNode({ saveLayout }, emptyTree());
    await wrapper.get('[data-test="detail-layout-save"]').trigger("click");
    expect(saveLayout).toHaveBeenCalledOnce();
    expect(wrapper.get('[data-test="detail-layout-save"]').text()).toBe("已保存");
  });

  it("always shows the AI panel and asks for an element selection", async () => {
    const wrapper = mountNode({ region: region("a", 0, 300) }, emptyTree());
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-test="ai-refactor-panel"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="ai-empty-selection"]').text()).toContain("请选择元素");
    expect(wrapper.find('[data-test="ai-send"]').attributes("disabled")).toBeDefined();
  });

  it("shows the selected element hierarchy number in the AI panel", async () => {
    const store = createElementStore(stubApi(parsedTree()));
    const wrapper = mountNode({ region: region("a", 0, 300), elementStore: store }, parsedTree());
    await store.load("p1", { x: 0, y: 0, w: 400, h: 300 });
    store.select("child");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-test="ai-selected-reference"]').text()).toContain("1.1 用户头像");
  });

  it("hides the empty notice before anything is parsed", () => {
    const wrapper = mountNode({ region: region("a", 0, 300) });
    expect(wrapper.find('[data-test="empty-result"]').exists()).toBe(false);
  });

  // 阶段一检不出小元素是正常的，界面必须说清楚，否则看起来像坏了
  it("explains an empty result after parsing", async () => {
    const store = createElementStore(stubApi(emptyTree()));
    const wrapper = mount(DetailNode, {
      props: {
        projectId: "p1", region: region("a", 0, 300), elementStore: store,
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
        projectId: "p1", region: region("a", 0, 300),
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
  const one = region("a", 0, 300);

  it("does not show the removed source comparison block", () => {
    const wrapper = mountNode({ region: one });
    expect(wrapper.find('[data-test="detail-source"]').exists()).toBe(false);
    expect(wrapper.find(".source-frame").exists()).toBe(false);
  });

  // 读不到像素就别假装进入取色态。jsdom 没有真实 canvas，正好覆盖这条路径；
  // 真实浏览器里的取色行为由手工验收覆盖，单测碰不到 getImageData。
  it("refuses to enter picking mode when pixels cannot be read", async () => {
    const wrapper = mountNode({ region: one });
    await wrapper.findComponent({ name: "ElementProperties" }).vm.$emit("toggle-picking");
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-test="picking-hint"]').exists()).toBe(false);
  });

  it("keeps the source image clean when not picking", () => {
    const wrapper = mountNode({ region: one });
    expect(wrapper.find('[data-test="pick-preview"]').exists()).toBe(false);
  });
});
