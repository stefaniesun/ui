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

    const zeroWheel = new WheelEvent("wheel", { deltaY: 0, clientX: 50, clientY: 50, bubbles: true, cancelable: true });
    viewport.element.dispatchEvent(zeroWheel);
    await wrapper.vm.$nextTick();
    expect(zeroWheel.defaultPrevented).toBe(false);
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

  it("pans from empty canvas with the left pointer, captures it, and preserves focus", async () => {
    const wrapper = mount(PageOutline, { attachTo: document.body, props: { projectId: "p1", outline, selectedId: null } });
    const viewport = wrapper.get('[data-test="canvas-viewport"]');
    const focused = wrapper.get('[data-test="fit-view"]').element as HTMLButtonElement;
    focused.focus();
    const capture = vi.fn();
    Object.defineProperty(viewport.element, "setPointerCapture", { configurable: true, value: capture });
    await viewport.trigger("pointerdown", { button: 0, pointerId: 7, clientX: 100, clientY: 100 });
    await viewport.trigger("pointermove", { pointerId: 7, clientX: 140, clientY: 130 });
    expect(capture).toHaveBeenCalledWith(7);
    expect(wrapper.get('[data-test="canvas-stage"]').attributes("style")).toContain("translate3d(40px, 30px, 0)");
    expect(document.activeElement).toBe(focused);
    wrapper.unmount();
  });

  it("does not left-pan from interactive content", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: "0-1000::ok" } });
    const viewport = wrapper.get('[data-test="canvas-viewport"]');
    const before = wrapper.get('[data-test="canvas-stage"]').attributes("style");
    for (const selector of [".tree-item-content", '[data-test="calibration-text"]', ".element-box"]) {
      await wrapper.get(selector).trigger("pointerdown", { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
      await viewport.trigger("pointermove", { pointerId: 1, clientX: 160, clientY: 160 });
      await viewport.trigger("pointerup", { pointerId: 1 });
    }
    expect(wrapper.get('[data-test="canvas-stage"]').attributes("style")).toBe(before);
  });

  it("pans from panel content with the middle pointer", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: "0-1000::ok" } });
    const viewport = wrapper.get('[data-test="canvas-viewport"]');
    Object.defineProperty(viewport.element, "setPointerCapture", { configurable: true, value: vi.fn() });
    await wrapper.get('[data-test="calibration-text"]').trigger("pointerdown", { button: 1, pointerId: 3, clientX: 100, clientY: 100 });
    await viewport.trigger("pointermove", { pointerId: 3, clientX: 150, clientY: 140 });
    expect(wrapper.get('[data-test="canvas-stage"]').attributes("style")).toContain("translate3d(50px, 40px, 0)");
  });

  it("does not suppress the next left click after middle-button panning", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: "0-1000::ok" } });
    const viewport = wrapper.get('[data-test="canvas-viewport"]');
    Object.defineProperties(viewport.element, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: () => false },
    });
    await wrapper.get('[data-test="calibration-text"]').trigger("pointerdown", { button: 1, pointerId: 3, clientX: 100, clientY: 100 });
    await viewport.trigger("pointermove", { pointerId: 3, clientX: 150, clientY: 140 });
    await viewport.trigger("pointerup", { pointerId: 3 });
    await wrapper.get(".element-box").trigger("click");
    expect(wrapper.emitted("select")).toEqual([["0-1000::ok"]]);
  });

  it("pans with space plus left pointer but not while editing", async () => {
    const wrapper = mount(PageOutline, { attachTo: document.body, props: { projectId: "p1", outline, selectedId: "0-1000::ok" } });
    const viewport = wrapper.get('[data-test="canvas-viewport"]');
    Object.defineProperty(viewport.element, "setPointerCapture", { configurable: true, value: vi.fn() });
    (document.activeElement as HTMLElement | null)?.blur();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));
    await wrapper.get(".tree-item-content").trigger("pointerdown", { button: 0, pointerId: 4, clientX: 100, clientY: 100 });
    await viewport.trigger("pointermove", { pointerId: 4, clientX: 125, clientY: 135 });
    expect(wrapper.get('[data-test="canvas-stage"]').attributes("style")).toContain("translate3d(25px, 35px, 0)");
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", bubbles: true }));
    const input = wrapper.get('[data-test="calibration-text"]');
    (input.element as HTMLInputElement).focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));
    const before = wrapper.get('[data-test="canvas-stage"]').attributes("style");
    await input.trigger("pointerdown", { button: 0, pointerId: 5, clientX: 100, clientY: 100 });
    await viewport.trigger("pointermove", { pointerId: 5, clientX: 150, clientY: 150 });
    expect(wrapper.get('[data-test="canvas-stage"]').attributes("style")).toBe(before);
    wrapper.unmount();
  });

  it("keeps a click below the pan threshold", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const viewport = wrapper.get('[data-test="canvas-viewport"]');
    Object.defineProperties(viewport.element, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: () => false },
    });
    await viewport.trigger("pointerdown", { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    await viewport.trigger("pointermove", { pointerId: 1, clientX: 12, clientY: 12 });
    await viewport.trigger("pointerup", { pointerId: 1 });
    await wrapper.get(".element-box").trigger("click");
    expect(wrapper.emitted("select")).toEqual([["0-1000::ok"]]);
  });

  it("suppresses a click after a real pan and clears pan state on cancel", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const viewport = wrapper.get('[data-test="canvas-viewport"]');
    const releasePointerCapture = vi.fn();
    Object.defineProperties(viewport.element, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: () => true },
      releasePointerCapture: { configurable: true, value: releasePointerCapture },
    });
    await viewport.trigger("pointerdown", { button: 0, pointerId: 2, clientX: 10, clientY: 10 });
    await viewport.trigger("pointermove", { pointerId: 2, clientX: 40, clientY: 40 });
    await viewport.trigger("pointerup", { pointerId: 2 });
    await viewport.trigger("lostpointercapture", { pointerId: 2 });
    expect(releasePointerCapture).toHaveBeenCalledWith(2);
    await wrapper.get(".element-box").trigger("click");
    expect(wrapper.emitted("select")).toBeFalsy();
    await viewport.trigger("pointerdown", { button: 0, pointerId: 9, clientX: 10, clientY: 10 });
    await viewport.trigger("pointermove", { pointerId: 9, clientX: 30, clientY: 30 });
    await viewport.trigger("pointercancel", { pointerId: 9 });
    const before = wrapper.get('[data-test="canvas-stage"]').attributes("style");
    await viewport.trigger("pointermove", { pointerId: 9, clientX: 80, clientY: 80 });
    expect(wrapper.get('[data-test="canvas-stage"]').attributes("style")).toBe(before);
    await wrapper.get(".element-box").trigger("click");
    expect(wrapper.emitted("select")).toEqual([["0-1000::ok"]]);
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

  it("shrinks the stage without resizing the image column and keeps the current view", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: "0-1000::bad" } });
    const viewport = wrapper.get('[data-test="canvas-viewport"]');
    const stage = wrapper.get('[data-test="canvas-stage"]');
    setElementSize(viewport.element, 1024, 700);
    setElementSize(stage.element, 1200, 760);
    resizeCallback?.();
    await wrapper.vm.$nextTick();
    await wrapper.get('[data-test="zoom-in"]').trigger("click");
    const zoom = wrapper.get('[data-test="zoom-level"]').text();
    const before = stage.attributes("style") ?? "";
    const imagePanel = wrapper.get('[data-test="image-panel"]');
    setElementSize(imagePanel.element, 600, 760);
    await wrapper.get('[data-test="collapse-tree-panel"]').trigger("click");
    setElementSize(stage.element, 934, 760);
    setElementSize(imagePanel.element, 600, 760);
    resizeCallback?.();
    await wrapper.vm.$nextTick();
    const after = stage.attributes("style") ?? "";
    expect(stage.classes()).toContain("tree-panel-collapsed");
    expect(stage.element.clientWidth).toBe(934);
    expect(imagePanel.element.clientWidth).toBe(600);
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe(zoom);
    expect(after).toBe(before);
  });

  it("collapses and restores the tree panel without hiding properties or selection", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: "0-1000::bad" } });
    const properties = wrapper.get('[data-test="property-panel"]');
    expect(properties.text()).toContain("可疑图标");
    expect(properties.text()).toContain("1.1.1");
    expect(properties.text()).toContain("页面");
    expect(properties.text()).toContain("可疑");

    await wrapper.get('[data-test="zoom-in"]').trigger("click");
    const zoom = wrapper.get('[data-test="zoom-level"]').text();
    await wrapper.get('[data-test="collapse-tree-panel"]').trigger("click");
    expect(wrapper.get(".outline-workspace").classes()).toContain("tree-panel-collapsed");
    expect(wrapper.find('[data-test="outline-tree"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="property-panel"]')).toBeTruthy();

    const scrollIntoView = spyOnScrollIntoView();
    await wrapper.get('[data-test="restore-tree-panel"]').trigger("click");
    expect(wrapper.get('[data-test="outline-tree"]')).toBeTruthy();
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe(zoom);
    expect(wrapper.get(".tree-item.selected").text()).toContain("可疑图标");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });

  it("reveals a tree-selected image box by panning the canvas without changing zoom", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const viewport = wrapper.get('[data-test="canvas-viewport"]');
    const stage = wrapper.get('[data-test="canvas-stage"]');
    const box = wrapper.findAll(".element-box")[1]!;
    setElementSize(viewport.element, 600, 400);
    setElementSize(stage.element, 1200, 760);
    resizeCallback?.();
    await wrapper.vm.$nextTick();
    await wrapper.get('[data-test="actual-size"]').trigger("click");
    await wrapper.get('[data-test="zoom-in"]').trigger("click");
    await wrapper.get('[data-test="zoom-in"]').trigger("click");
    vi.spyOn(stage.element, "getBoundingClientRect").mockReturnValue({ left: -420, top: -256, width: 1440, height: 912, right: 1020, bottom: 656, x: -420, y: -256, toJSON: () => ({}) });
    vi.spyOn(box.element, "getBoundingClientRect").mockReturnValue({ left: 540, top: 464, width: 72, height: 72, right: 612, bottom: 536, x: 540, y: 464, toJSON: () => ({}) });
    const scrollIntoView = spyOnScrollIntoView();
    const zoom = wrapper.get('[data-test="zoom-level"]').text();
    await wrapper.findAll(".tree-item-content")[1]!.trigger("click");
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("select")?.[0]).toEqual(["0-1000::bad"]);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe(zoom);
    const transform = stage.attributes("style") ?? "";
    const x = Number(transform.match(/translate3d\(([-\d.]+)px/)?.[1]);
    const y = Number(transform.match(/translate3d\([^,]+, ([-\d.]+)px/)?.[1]);
    expect(x).toBeCloseTo(-456);
    expect(y).toBeCloseTo(-416);
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
