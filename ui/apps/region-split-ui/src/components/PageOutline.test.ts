import type { PageOutline as PageOutlineDto } from "@region-split/core/browser";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import PageOutline from "./PageOutline.vue";

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

  it("renders image, tree, and independent property columns", () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const workspace = wrapper.get(".outline-workspace");
    const panels = [
      wrapper.get('[data-test="image-panel"]'),
      wrapper.get('[data-test="tree-panel"]'),
      wrapper.get('[data-test="property-panel"]'),
    ];
    expect(panels.every(panel => panel.element.parentElement === workspace.element)).toBe(true);
    expect(panels[1]!.find('[data-test="calibration"]').exists()).toBe(false);
    expect(panels[2]!.get('[data-test="property-empty"]').text()).toContain("选择元素");
    expect(panels[2]!.find('[data-test="calibration"]').exists()).toBe(false);
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

  it("shares selection between tree and image and exposes only three calibration fields", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const scrollIntoView = spyOnScrollIntoView();
    await wrapper.findAll(".tree-item-content")[1]!.trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual(["0-1000::bad"]);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
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
