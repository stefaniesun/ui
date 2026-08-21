import type { PageOutline as PageOutlineDto } from "@region-split/core/browser";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
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
  });

  it("shares selection between tree and image and exposes only three calibration fields", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    await wrapper.findAll(".tree-item")[1]!.trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual(["0-1000::bad"]);
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
