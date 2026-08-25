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

function mockPointerCapture(element: Element) {
  const setPointerCapture = vi.fn();
  const releasePointerCapture = vi.fn();
  Object.defineProperties(element, {
    setPointerCapture: { configurable: true, value: setPointerCapture },
    hasPointerCapture: { configurable: true, value: () => true },
    releasePointerCapture: { configurable: true, value: releasePointerCapture },
  });
  return { setPointerCapture, releasePointerCapture };
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

  it("uses the viewport height for one equal-height three-panel workspace", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: "0-1000::ok" } });
    const viewport = wrapper.get('[data-test="canvas-viewport"]');
    setElementSize(viewport.element, 1024, 680);
    resizeCallback?.();
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[data-test="canvas-stage"]').attributes("style")).toContain("height: 680px");
    for (const selector of ['[data-test="image-panel"]', '[data-test="tree-panel"]', '[data-test="property-panel"]']) {
      expect(wrapper.get(selector).attributes("data-scroll-panel")).toBe("true");
    }
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

    for (const selector of ['[data-test="image-panel"]', '[data-test="tree-panel"]', '[data-test="property-panel"]']) {
      const panelWheel = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
      wrapper.get(selector).element.dispatchEvent(panelWheel);
      await wrapper.vm.$nextTick();
      expect(panelWheel.defaultPrevented).toBe(false);
      expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("110%");
    }

    const ctrlWheel = new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true });
    wrapper.get('[data-test="image-panel"]').element.dispatchEvent(ctrlWheel);
    await wrapper.vm.$nextTick();
    expect(ctrlWheel.defaultPrevented).toBe(true);
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("120%");

    const zeroWheel = new WheelEvent("wheel", { deltaY: 0, clientX: 50, clientY: 50, bubbles: true, cancelable: true });
    viewport.element.dispatchEvent(zeroWheel);
    await wrapper.vm.$nextTick();
    expect(zeroWheel.defaultPrevented).toBe(false);
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("120%");
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

  it("resizes only adjacent panels while keeping the expanded stage width", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const stage = wrapper.get('[data-test="canvas-stage"]');
    expect(stage.attributes("style")).toContain("width: 1200px");
    expect(stage.attributes("style")).toContain("594px 6px 297px 6px 297px");

    const first = wrapper.get('[data-test="splitter-image-tree"]');
    mockPointerCapture(first.element);
    await first.trigger("pointerdown", { button: 0, pointerId: 11, clientX: 600 });
    await first.trigger("pointermove", { pointerId: 11, clientX: 680 });
    await first.trigger("pointerup", { pointerId: 11, clientX: 680 });
    expect(stage.attributes("style")).toContain("671px 6px 220px 6px 297px");
    expect(stage.attributes("style")).toContain("width: 1200px");

    const second = wrapper.get('[data-test="splitter-tree-property"]');
    mockPointerCapture(second.element);
    await second.trigger("pointerdown", { button: 0, pointerId: 12, clientX: 900 });
    await second.trigger("pointermove", { pointerId: 12, clientX: 940 });
    await second.trigger("pointerup", { pointerId: 12, clientX: 940 });
    expect(stage.attributes("style")).toContain("671px 6px 260px 6px 257px");
    expect(stage.attributes("style")).toContain("width: 1200px");
  });

  it("resizes only the property panel from the workspace right edge", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const stage = wrapper.get('[data-test="canvas-stage"]');
    const edge = wrapper.get('[data-test="property-edge-resizer"]');
    const capture = mockPointerCapture(edge.element);
    const beforeTransform = stage.attributes("style")?.match(/transform:[^;]+/)?.[0];
    await edge.trigger("pointerdown", { button: 0, pointerId: 61, clientX: 1200 });
    await edge.trigger("pointermove", { pointerId: 61, clientX: 1280 });
    await edge.trigger("pointerup", { pointerId: 61, clientX: 1280 });
    expect(capture.setPointerCapture).toHaveBeenCalledWith(61);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(61);
    expect(stage.attributes("style")).toContain("width: 1280px");
    expect(stage.attributes("style")).toContain("594px 6px 297px 6px 377px");
    expect(stage.attributes("style")?.match(/transform:[^;]+/)?.[0]).toBe(beforeTransform);
  });

  it("clamps the property edge at its minimum width", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const edge = wrapper.get('[data-test="property-edge-resizer"]');
    mockPointerCapture(edge.element);
    await edge.trigger("pointerdown", { button: 0, pointerId: 62, clientX: 1200 });
    await edge.trigger("pointermove", { pointerId: 62, clientX: 0 });
    await edge.trigger("pointerup", { pointerId: 62, clientX: 0 });
    const style = wrapper.get('[data-test="canvas-stage"]').attributes("style") ?? "";
    expect(style).toContain("594px 6px 297px 6px 220px");
    expect(style).toContain("width: 1123px");
  });

  it("converts property edge movement at the current canvas scale", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    await wrapper.get('[data-test="actual-size"]').trigger("click");
    await wrapper.get('[data-test="zoom-in"]').trigger("click");
    const edge = wrapper.get('[data-test="property-edge-resizer"]');
    mockPointerCapture(edge.element);
    await edge.trigger("pointerdown", { button: 0, pointerId: 63, clientX: 1200 });
    await edge.trigger("pointermove", { pointerId: 63, clientX: 1288 });
    await edge.trigger("pointerup", { pointerId: 63, clientX: 1288 });
    expect(wrapper.get('[data-test="canvas-stage"]').attributes("style")).toContain("594px 6px 297px 6px 377px");
  });

  it("keeps the property edge resizer available while the tree is collapsed", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    await wrapper.get('[data-test="collapse-tree-panel"]').trigger("click");
    const edge = wrapper.get('[data-test="property-edge-resizer"]');
    mockPointerCapture(edge.element);
    await edge.trigger("pointerdown", { button: 0, pointerId: 64, clientX: 925 });
    await edge.trigger("pointermove", { pointerId: 64, clientX: 985 });
    await edge.trigger("pointerup", { pointerId: 64, clientX: 985 });
    const style = wrapper.get('[data-test="canvas-stage"]').attributes("style") ?? "";
    expect(style).toContain("594px 34px 357px");
    expect(style).toContain("width: 985px");
  });

  it("keeps the property edge fixed outside the property content scroller", () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: "0-1000::ok" } });
    const panel = wrapper.get('[data-test="property-panel"]');
    const edge = wrapper.get('[data-test="property-edge-resizer"]');
    const content = wrapper.get('[data-test="property-content-scroll"]');
    expect(edge.element.parentElement).toBe(panel.element);
    expect(content.element.parentElement).toBe(panel.element);
    expect(content.element.contains(edge.element)).toBe(false);
  });

  it("supports keyboard resizing and exposes the property width", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const edge = wrapper.get('[data-test="property-edge-resizer"]');
    expect(edge.attributes("tabindex")).toBe("0");
    expect(edge.attributes("aria-valuemin")).toBe("220");
    expect(edge.attributes("aria-valuenow")).toBe("297");
    await edge.trigger("keydown", { key: "ArrowRight" });
    expect(edge.attributes("aria-valuenow")).toBe("313");
    expect(wrapper.get('[data-test="canvas-stage"]').attributes("style")).toContain("width: 1216px");
    await edge.trigger("keydown", { key: "ArrowLeft", shiftKey: true });
    expect(edge.attributes("aria-valuenow")).toBe("265");
  });

  it("isolates property edge events, ignores double click, and cleans canceled drags", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const stage = wrapper.get('[data-test="canvas-stage"]');
    const edge = wrapper.get('[data-test="property-edge-resizer"]');
    mockPointerCapture(edge.element);
    const middleDown = new MouseEvent("pointerdown", { button: 1, bubbles: true, cancelable: true });
    Object.defineProperty(middleDown, "pointerId", { value: 71 });
    edge.element.dispatchEvent(middleDown);
    expect(middleDown.defaultPrevented).toBe(true);

    await edge.trigger("pointerdown", { button: 0, pointerId: 72, clientX: 1200 });
    await edge.trigger("pointermove", { pointerId: 72, clientX: 1260 });
    await edge.trigger("pointerup", { pointerId: 72, clientX: 1260 });
    const resized = stage.attributes("style") ?? "";
    expect(resized).toContain("357px");
    await edge.trigger("dblclick");
    expect(stage.attributes("style")).toBe(resized);

    await edge.trigger("pointerdown", { button: 0, pointerId: 73, clientX: 1260 });
    await edge.trigger("pointermove", { pointerId: 73, clientX: 1280 });
    await edge.trigger("pointercancel", { pointerId: 73 });
    const afterCancel = stage.attributes("style");
    await edge.trigger("pointermove", { pointerId: 73, clientX: 1320 });
    expect(stage.attributes("style")).toBe(afterCancel);
  });

  it("stops property edge resizing when the window loses focus", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const edge = wrapper.get('[data-test="property-edge-resizer"]');
    mockPointerCapture(edge.element);
    await edge.trigger("pointerdown", { button: 0, pointerId: 74, clientX: 1200 });
    window.dispatchEvent(new Event("blur"));
    const afterBlur = wrapper.get('[data-test="canvas-stage"]').attributes("style");
    await edge.trigger("pointermove", { pointerId: 74, clientX: 1260 });
    expect(wrapper.get('[data-test="canvas-stage"]').attributes("style")).toBe(afterBlur);
  });

  it("converts splitter movement from screen pixels at the current canvas scale", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    await wrapper.get('[data-test="actual-size"]').trigger("click");
    await wrapper.get('[data-test="zoom-in"]').trigger("click");
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("110%");
    const splitter = wrapper.get('[data-test="splitter-image-tree"]');
    mockPointerCapture(splitter.element);
    await splitter.trigger("pointerdown", { button: 0, pointerId: 15, clientX: 600 });
    await splitter.trigger("pointermove", { pointerId: 15, clientX: 644 });
    await splitter.trigger("pointerup", { pointerId: 15, clientX: 644 });
    expect(wrapper.get('[data-test="canvas-stage"]').attributes("style")).toContain("634px 6px 257px 6px 297px");
  });

  it("captures splitter pointers without starting canvas panning", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const splitter = wrapper.get('[data-test="splitter-image-tree"]');
    const capture = mockPointerCapture(splitter.element);
    const stage = wrapper.get('[data-test="canvas-stage"]');
    const beforeTransform = stage.attributes("style")?.match(/transform:[^;]+/)?.[0];

    const middleDown = new MouseEvent("pointerdown", { button: 1, bubbles: true, cancelable: true });
    Object.defineProperty(middleDown, "pointerId", { value: 20 });
    splitter.element.dispatchEvent(middleDown);
    expect(middleDown.defaultPrevented).toBe(true);

    await splitter.trigger("pointerdown", { button: 0, pointerId: 21, clientX: 600 });
    await splitter.trigger("pointermove", { pointerId: 21, clientX: -1000 });
    const pointerUp = new MouseEvent("pointerup", { clientX: -1000, bubbles: true, cancelable: true });
    Object.defineProperty(pointerUp, "pointerId", { value: 21 });
    splitter.element.dispatchEvent(pointerUp);
    await wrapper.vm.$nextTick();

    expect(pointerUp.defaultPrevented).toBe(true);
    expect(capture.setPointerCapture).toHaveBeenCalledWith(21);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(21);
    expect(stage.attributes("style")).toContain("320px 6px 571px 6px 297px");
    expect(stage.attributes("style")?.match(/transform:[^;]+/)?.[0]).toBe(beforeTransform);
  });

  it("cleans splitter drag on cancel and resets a boundary on double click", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const splitter = wrapper.get('[data-test="splitter-tree-property"]');
    mockPointerCapture(splitter.element);
    await splitter.trigger("pointerdown", { button: 0, pointerId: 31, clientX: 900 });
    await splitter.trigger("pointermove", { pointerId: 31, clientX: 940 });
    await splitter.trigger("pointercancel", { pointerId: 31 });
    const afterCancel = wrapper.get('[data-test="canvas-stage"]').attributes("style");
    await splitter.trigger("pointermove", { pointerId: 31, clientX: 980 });
    expect(wrapper.get('[data-test="canvas-stage"]').attributes("style")).toBe(afterCancel);

    await splitter.trigger("dblclick");
    expect(wrapper.get('[data-test="canvas-stage"]').attributes("style")).toContain("594px 6px 297px 6px 297px");
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
    const beforeTransform = (stage.attributes("style") ?? "").match(/transform:[^;]+/)?.[0];
    const imagePanel = wrapper.get('[data-test="image-panel"]');
    setElementSize(imagePanel.element, 594, 760);
    await wrapper.get('[data-test="collapse-tree-panel"]').trigger("click");
    setElementSize(stage.element, 925, 760);
    setElementSize(imagePanel.element, 594, 760);
    resizeCallback?.();
    await wrapper.vm.$nextTick();
    const after = stage.attributes("style") ?? "";
    expect(stage.classes()).toContain("tree-panel-collapsed");
    expect(stage.element.clientWidth).toBe(925);
    expect(imagePanel.element.clientWidth).toBe(594);
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe(zoom);
    expect(after).toContain("width: 925px");
    expect(after.match(/transform:[^;]+/)?.[0]).toBe(beforeTransform);
  });

  it("collapses and restores the tree panel without losing adjusted widths or selection", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: "0-1000::bad" } });
    const stage = wrapper.get('[data-test="canvas-stage"]');
    const first = wrapper.get('[data-test="splitter-image-tree"]');
    mockPointerCapture(first.element);
    await first.trigger("pointerdown", { button: 0, pointerId: 41, clientX: 600 });
    await first.trigger("pointermove", { pointerId: 41, clientX: 640 });
    await first.trigger("pointerup", { pointerId: 41, clientX: 640 });
    const second = wrapper.get('[data-test="splitter-tree-property"]');
    mockPointerCapture(second.element);
    await second.trigger("pointerdown", { button: 0, pointerId: 42, clientX: 900 });
    await second.trigger("pointermove", { pointerId: 42, clientX: 930 });
    await second.trigger("pointerup", { pointerId: 42, clientX: 930 });
    expect(stage.attributes("style")).toContain("634px 6px 287px 6px 267px");

    await wrapper.get('[data-test="zoom-in"]').trigger("click");
    const zoom = wrapper.get('[data-test="zoom-level"]').text();
    await wrapper.get('[data-test="collapse-tree-panel"]').trigger("click");
    expect(stage.attributes("style")).toContain("634px 34px 267px");
    expect(wrapper.find('[data-test="splitter-image-tree"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="splitter-tree-property"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="property-panel"]').text()).toContain("可疑图标");

    const scrollIntoView = spyOnScrollIntoView();
    await wrapper.get('[data-test="restore-tree-panel"]').trigger("click");
    expect(stage.attributes("style")).toContain("634px 6px 287px 6px 267px");
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe(zoom);
    expect(wrapper.get(".tree-item.selected").text()).toContain("可疑图标");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });

  it("scrolls the image panel to a tree-selected box without moving the canvas", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const imagePanel = wrapper.get('[data-test="image-panel"]');
    const stage = wrapper.get('[data-test="canvas-stage"]');
    const box = wrapper.findAll(".element-box")[1]!;
    setElementSize(imagePanel.element, 594, 680);
    Object.defineProperties(box.element, {
      offsetTop: { configurable: true, value: 750 },
      offsetHeight: { configurable: true, value: 40 },
    });
    const scrollTo = vi.fn();
    Object.defineProperty(imagePanel.element, "scrollTo", { configurable: true, value: scrollTo });
    const beforeTransform = stage.attributes("style")?.match(/transform:[^;]+/)?.[0];
    await wrapper.findAll(".tree-item-content")[1]!.trigger("click");
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("select")?.[0]).toEqual(["0-1000::bad"]);
    expect(scrollTo).toHaveBeenCalledWith({ top: 430, behavior: "auto" });
    expect(stage.attributes("style")?.match(/transform:[^;]+/)?.[0]).toBe(beforeTransform);
  });

  it("does not scroll an already visible or invalid tree-selected box", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const imagePanel = wrapper.get('[data-test="image-panel"]');
    const box = wrapper.findAll(".element-box")[1]!;
    setElementSize(imagePanel.element, 594, 680);
    Object.defineProperties(imagePanel.element, {
      scrollTop: { configurable: true, writable: true, value: 100 },
      scrollTo: { configurable: true, value: vi.fn() },
    });
    Object.defineProperties(box.element, {
      offsetTop: { configurable: true, value: 250 },
      offsetHeight: { configurable: true, value: 40 },
    });
    await wrapper.findAll(".tree-item-content")[1]!.trigger("click");
    await wrapper.vm.$nextTick();
    expect(imagePanel.element.scrollTo).not.toHaveBeenCalled();

    Object.defineProperty(box.element, "offsetTop", { configurable: true, value: Number.NaN });
    await wrapper.findAll(".tree-item-content")[1]!.trigger("click");
    await wrapper.vm.$nextTick();
    expect(imagePanel.element.scrollTo).not.toHaveBeenCalled();
  });
});
