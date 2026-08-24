import type { PageOutline as PageOutlineDto } from "@region-split/core/browser";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import PageOutline from "./PageOutline.vue";
import { DEFAULT_FONT_STACK } from "../font-stacks.js";

let resizeCallback: (() => void) | null = null;
class ResizeObserverStub {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = () => callback([], this as unknown as ResizeObserver);
  }
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

function setElementSize(element: Element, width: number, height: number) {
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: width },
    clientHeight: { configurable: true, value: height },
  });
}

const outline: PageOutlineDto = {
  image: { fileName: "page.png", width: 400, height: 1000 }, designWidth: 400, suspiciousCount: 1,
  regions: [{ regionKey: "0-1000", displayName: "页面", bounds: { x: 0, y: 0, w: 400, h: 1000 }, status: "parsed" }],
  elements: [
    { id: "0-1000::ok", localId: "ok", regionKey: "0-1000", regionName: "页面", parentHint: null, outlineNumber: "1.1", depth: 0, suspicious: false,
      box: { x: 40, y: 100, w: 200, h: 50 }, kind: "text", displayName: "标题", text: "标题",
      style: {}, uniformity: 1, source: "auto", classification: "tool", scrollX: false, scrollY: false, positioning: "flow" },
    { id: "0-1000::bad", localId: "bad", regionKey: "0-1000", regionName: "页面", parentHint: "0-1000::ok", outlineNumber: "1.1.1", depth: 1, suspicious: true,
      box: { x: 20, y: 300, w: 40, h: 40 }, kind: "icon", displayName: "可疑图标",
      style: {}, uniformity: 1, source: "auto", classification: "uncertain", scrollX: false, scrollY: false, positioning: "flow" },
  ],
};

describe("PageOutline", () => {
  const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
  afterEach(() => {
    resizeCallback = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
    else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  });
  function spyOnScrollIntoView() {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
    return vi.spyOn(HTMLElement.prototype, "scrollIntoView");
  }
  const withRegions = (regions: PageOutlineDto["regions"]): PageOutlineDto => ({ ...outline, regions });
  const region = (regionKey: string, status: "parsed" | "missing" | "failed") => ({
    regionKey, displayName: `区域 ${regionKey}`, status,
    bounds: { x: 0, y: 0, w: 400, h: 100 },
  });

  // 「还没轮到」和「跑失败了」合成一个数字时，正在解析的界面和真失败的界面
  // 长得一模一样，人没法判断该等还是该重跑
  it("says how many regions failed rather than lumping in the unparsed ones", () => {
    const wrapper = mount(PageOutline, {
      props: {
        projectId: "p1", selectedId: null,
        outline: withRegions([region("0-100", "failed"), region("100-200", "parsed")]),
      },
    });
    expect(wrapper.get('[data-test="retry-failed"]').text()).toBe("重跑失败区域（1）");
  });

  it("calls the remaining regions unparsed, not failed", () => {
    const wrapper = mount(PageOutline, {
      props: {
        projectId: "p1", selectedId: null,
        outline: withRegions([region("0-100", "missing"), region("100-200", "missing")]),
      },
    });
    expect(wrapper.get('[data-test="retry-failed"]').text()).toBe("解析剩余区域（2）");
  });

  // 跑的过程中不该出现重跑按钮：那时"缺失"只是还没轮到
  it("hides the retry button while a run is in flight", () => {
    const wrapper = mount(PageOutline, {
      props: {
        projectId: "p1", selectedId: null, busy: true,
        outline: withRegions([region("0-100", "missing")]),
      },
    });
    expect(wrapper.find('[data-test="retry-failed"]').exists()).toBe(false);
  });

  it("names the kinds in chinese in the property panel", () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: "0-1000::ok" } });
    const options = wrapper.get('[data-test="calibration-kind"]').findAll("option");
    expect(options.map(option => option.text())).toContain("文字");
    expect(options.map(option => option.text())).not.toContain("text");
    expect(options.find(option => option.text() === "文字")?.attributes("value")).toBe("text");
    expect(wrapper.get(".tree-item small").text()).toBe("文字");
  });

  it("labels the box fields in chinese", () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: "0-1000::ok" } });
    const text = wrapper.get('[data-test="calibration"]').text();
    for (const label of ["横坐标", "纵坐标", "宽", "高"]) expect(text).toContain(label);
  });

  it("tints an element box by its kind while status styles stay higher priority", () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: "0-1000::ok" } });
    expect(wrapper.get('[data-test="page-outline"] .element-box').attributes("style")).toContain("--kind-color: #ffd166");
    expect(wrapper.get(".element-box.selected").classes()).toContain("selected");
    expect(wrapper.get(".element-box.suspicious").classes()).toContain("suspicious");
  });

  it("exposes migrated font, export, comparison, stats, and todo controls", async () => {
    const wrapper = mount(PageOutline, {
      props: {
        projectId: "p1", outline, selectedId: null,
        fontStack: DEFAULT_FONT_STACK.value,
        stats: {
          totalRegions: 2, parsedRegions: 1, totalIcons: 3, libraryIcons: 1,
          cropIcons: 1, unresolvedIcons: 1, textWithoutSize: 0,
          fontStackChosen: false, allPassed: false, todos: ["解析区域 底部"],
        },
      },
    });

    expect(wrapper.get('[data-test="font-stack"]').element).toBeInstanceOf(HTMLSelectElement);
    expect(wrapper.get('[data-test="export-page"]').text()).toContain("导出整页代码");
    expect(wrapper.get('[data-test="open-page-compare"]').text()).toContain("整页比对");
    expect(wrapper.get('[data-test="refresh-model-config"]').text()).toContain("刷新模型配置");
    expect(wrapper.get('[data-test="analysis-stats"]').text()).toContain("区域 1/2");
    expect(wrapper.get('[data-test="analysis-todos"]').text()).toContain("解析区域 底部");

    await wrapper.get('[data-test="font-stack"]').setValue('Roboto, "Noto Sans CJK SC", "Source Han Sans SC", sans-serif');
    await wrapper.get('[data-test="export-page"]').trigger("click");
    await wrapper.get('[data-test="open-page-compare"]').trigger("click");
    await wrapper.get('[data-test="refresh-model-config"]').trigger("click");
    expect(wrapper.emitted("fontStack")?.[0]).toEqual(['Roboto, "Noto Sans CJK SC", "Source Han Sans SC", sans-serif']);
    expect(wrapper.emitted("exportPage")).toHaveLength(1);
    expect(wrapper.emitted("openPageCompare")).toHaveLength(1);
    expect(wrapper.emitted("refreshModelConfig")).toHaveLength(1);
  });

  it("keeps tools outside one transformed three-column stage", () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const viewport = wrapper.get('[data-test="canvas-viewport"]');
    const stage = wrapper.get('[data-test="canvas-stage"]');
    const tools = wrapper.get('[data-test="view-controls"]');
    expect(tools.element.parentElement).not.toBe(viewport.element);
    expect(stage.element.parentElement).toBe(viewport.element);
    for (const selector of ['[data-test="image-panel"]', '[data-test="tree-panel"]', '[data-test="property-panel"]']) {
      expect(wrapper.get(selector).element.parentElement).toBe(stage.element);
    }
    expect(stage.attributes("style")).toContain("translate3d(");
    expect(stage.attributes("style")).toContain("scale(");
    expect(wrapper.get('[data-test="page-stage"]').attributes("style")).toContain("aspect-ratio: 400 / 1000");
    expect(wrapper.get('[data-test="image-panel"]').classes()).not.toContain("edge-to-edge");
  });

  it("renders accessible fit and 100 percent controls", () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    expect(wrapper.get('[data-test="zoom-out"]').attributes("aria-label")).toBe("缩小画布");
    expect(wrapper.get('[data-test="zoom-level"]').text()).toMatch(/^\d+%$/);
    expect(wrapper.get('[data-test="zoom-in"]').attributes("aria-label")).toBe("放大画布");
    expect(wrapper.get('[data-test="fit-view"]').text()).toBe("适应视图");
    expect(wrapper.get('[data-test="actual-size"]').text()).toBe("100%");
  });

  it("fits the whole stage after the first valid measurement", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const viewport = wrapper.get('[data-test="canvas-viewport"]');
    const stage = wrapper.get('[data-test="canvas-stage"]');
    setElementSize(viewport.element, 1024, 700);
    setElementSize(stage.element, 1200, 760);
    resizeCallback?.();
    await wrapper.vm.$nextTick();
    expect(stage.attributes("style")).toContain("scale(0.8)");
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("80%");
  });

  it("zooms empty canvas around the pointer but preserves ordinary panel scrolling", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: "0-1000::ok" } });
    const viewport = wrapper.get('[data-test="canvas-viewport"]');
    vi.spyOn(viewport.element, "getBoundingClientRect").mockReturnValue({ left: 10, top: 20, width: 800, height: 600, right: 810, bottom: 620, x: 10, y: 20, toJSON: () => ({}) });
    const canvasWheel = new WheelEvent("wheel", { deltaY: -100, clientX: 310, clientY: 220, bubbles: true, cancelable: true });
    viewport.element.dispatchEvent(canvasWheel);
    await wrapper.vm.$nextTick();
    expect(canvasWheel.defaultPrevented).toBe(true);
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("110%");
    expect(wrapper.get('[data-test="canvas-stage"]').attributes("style")).toContain("translate3d(-30");

    for (const selector of ['[data-test="tree-panel"]', '[data-test="property-panel"]']) {
      const panelWheel = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
      wrapper.get(selector).element.dispatchEvent(panelWheel);
      await wrapper.vm.$nextTick();
      expect(panelWheel.defaultPrevented).toBe(false);
      expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("110%");
    }

    const invalidWheel = new WheelEvent("wheel", { deltaY: -100, clientX: Number.NaN, clientY: 50, bubbles: true, cancelable: true });
    viewport.element.dispatchEvent(invalidWheel);
    await wrapper.vm.$nextTick();
    expect(invalidWheel.defaultPrevented).toBe(false);
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("110%");
  });

  it("zooms toolbar buttons around the viewport center and restores actual size", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const viewport = wrapper.get('[data-test="canvas-viewport"]');
    const stage = wrapper.get('[data-test="canvas-stage"]');
    setElementSize(viewport.element, 1024, 700);
    setElementSize(stage.element, 1200, 760);
    resizeCallback?.();
    await wrapper.vm.$nextTick();
    await wrapper.get('[data-test="zoom-in"]').trigger("click");
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("90%");
    await wrapper.get('[data-test="actual-size"]').trigger("click");
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("100%");
    setElementSize(viewport.element, 904, 700);
    await wrapper.get('[data-test="fit-view"]').trigger("click");
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("70%");
  });

  it("clamps repeated wheel zoom to 20 and 400 percent", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const viewport = wrapper.get('[data-test="canvas-viewport"]');
    for (let index = 0; index < 50; index += 1) {
      viewport.element.dispatchEvent(new WheelEvent("wheel", { deltaY: -1, bubbles: true, cancelable: true }));
    }
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("400%");
    for (let index = 0; index < 100; index += 1) {
      viewport.element.dispatchEvent(new WheelEvent("wheel", { deltaY: 1, bubbles: true, cancelable: true }));
    }
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("20%");
  });

  it("zooms from a panel with ctrl wheel and fits only on viewport double click", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: "0-1000::ok" } });
    const viewport = wrapper.get('[data-test="canvas-viewport"]');
    const stage = wrapper.get('[data-test="canvas-stage"]');
    setElementSize(viewport.element, 1024, 700);
    setElementSize(stage.element, 1200, 760);
    resizeCallback?.();
    await wrapper.vm.$nextTick();
    const event = new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, clientX: 600, clientY: 300, bubbles: true, cancelable: true });
    wrapper.get('[data-test="property-panel"]').element.dispatchEvent(event);
    await wrapper.vm.$nextTick();
    expect(event.defaultPrevented).toBe(true);
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("90%");
    await wrapper.get('[data-test="property-panel"]').trigger("dblclick");
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("90%");
    await viewport.trigger("dblclick");
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("80%");
  });

  it("renders the whole image and all boxes in page coordinates with suspicious emphasis", () => {
    const wrapper = mount(PageOutline, { props: { projectId: "project one", outline, selectedId: null } });
    expect(wrapper.get("img").attributes("src")).toBe("/api/projects/project%20one/image");
    const boxes = wrapper.findAll(".element-box");
    expect(boxes).toHaveLength(2);
    expect(boxes[0]?.attributes("style")).toContain("left: 10%");
    expect(boxes[0]?.attributes("style")).toContain("top: 10%");
    expect(boxes[1]?.classes()).toContain("suspicious");
    expect(boxes[0]?.classes()).not.toContain("suspicious");
    expect(boxes[0]?.attributes("aria-pressed")).toBe("false");
    expect(wrapper.get('[data-test="outline-tree"]').attributes("role")).toBe("tree");
    expect(wrapper.get(".tree-item.suspicious").attributes("aria-level")).toBe("2");
    expect(wrapper.get(".tree-item.suspicious").attributes("aria-selected")).toBe("false");
  });

  it("collapses descendants without selecting the parent", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    expect(wrapper.findAll(".tree-item")).toHaveLength(2);

    await wrapper.get('[data-test="tree-toggle-0-1000::ok"]').trigger("click");

    expect(wrapper.findAll(".tree-item")).toHaveLength(1);
    expect(wrapper.emitted("select")).toBeUndefined();

    await wrapper.get('[data-test="tree-toggle-0-1000::ok"]').trigger("click");
    expect(wrapper.findAll(".tree-item")).toHaveLength(2);
  });

  it("expands ancestors when an image box selects a hidden descendant", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    await wrapper.get('[data-test="tree-toggle-0-1000::ok"]').trigger("click");
    expect(wrapper.findAll(".tree-item")).toHaveLength(1);

    const scrollIntoView = spyOnScrollIntoView();
    await wrapper.findAll(".element-box")[1]!.trigger("click");

    expect(wrapper.emitted("select")?.at(-1)).toEqual(["0-1000::bad"]);
    expect(wrapper.findAll(".tree-item")).toHaveLength(2);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });

  it("treats invalid parents as top-level while preserving valid descendants", async () => {
    const invalidOutline: PageOutlineDto = {
      ...outline,
      elements: [
        { ...outline.elements[0]!, id: "a", parentHint: "b", depth: 4 },
        { ...outline.elements[1]!, id: "b", parentHint: "a", depth: 5 },
        { ...outline.elements[1]!, id: "self", parentHint: "self", depth: 3 },
        { ...outline.elements[0]!, id: "missing", parentHint: "unknown", depth: 2 },
        { ...outline.elements[1]!, id: "child", parentHint: "missing", depth: 3 },
      ],
    };
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline: invalidOutline, selectedId: null } });

    expect(wrapper.findAll(".tree-toggle")).toHaveLength(1);
    const rows = wrapper.findAll(".tree-item");
    for (const row of rows.slice(0, 4)) expect(row.attributes("style")).toContain("padding-left: 7px");
    expect(rows[4]!.attributes("style")).toContain("padding-left: 21px");

    await wrapper.get('[data-test="tree-toggle-missing"]').trigger("click");
    expect(wrapper.findAll(".tree-item")).toHaveLength(4);
  });

  it("collapses and restores the tree panel without hiding properties or selection", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: "0-1000::bad" } });
    const properties = wrapper.get('[data-test="property-panel"]');
    expect(properties.text()).toContain("可疑图标");
    expect(properties.text()).toContain("1.1.1");
    expect(properties.text()).toContain("页面");
    expect(properties.text()).toContain("可疑");

    await wrapper.get('[data-test="collapse-tree-panel"]').trigger("click");
    expect(wrapper.get(".outline-workspace").classes()).toContain("tree-panel-collapsed");
    expect(wrapper.find('[data-test="outline-tree"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="property-panel"]')).toBeTruthy();

    const scrollIntoView = spyOnScrollIntoView();
    await wrapper.get('[data-test="restore-tree-panel"]').trigger("click");
    expect(wrapper.get('[data-test="outline-tree"]')).toBeTruthy();
    expect(wrapper.get(".tree-item.selected").text()).toContain("可疑图标");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });

  it("shares selection between tree and image without independently scrolling the image panel", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const scrollIntoView = spyOnScrollIntoView();
    await wrapper.findAll(".tree-item-content")[1]!.trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual(["0-1000::bad"]);
    expect(scrollIntoView).not.toHaveBeenCalled();
    await wrapper.setProps({ selectedId: "0-1000::bad" });
    expect(wrapper.get('[data-test="calibration-kind"]')).toBeTruthy();
    expect(wrapper.get('[data-test="calibration-text"]')).toBeTruthy();
    expect(wrapper.findAll('.rect-fields input')).toHaveLength(4);
    expect(wrapper.text()).not.toContain("圆角");
    await wrapper.get('[data-test="calibration-text"]').setValue("消息");
    await wrapper.get('[data-test="save-calibration"]').trigger("submit");
    expect(wrapper.emitted("patch")?.[0]?.[0]).toBe("0-1000::bad");
    expect(wrapper.emitted("patch")?.[0]?.[1]).toMatchObject({ kind: "icon", text: "消息", box: { x: 20, y: 300, w: 40, h: 40 } });
  });
});
