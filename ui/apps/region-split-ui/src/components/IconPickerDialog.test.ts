import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { PageOutlineElement } from "@region-split/core/browser";
import IconPickerDialog from "./IconPickerDialog.vue";

const element: PageOutlineElement = {
  id: "0-100::gear", localId: "gear", regionKey: "0-100", regionName: "设置区", parentHint: null, outlineNumber: "1.1", depth: 1, displayName: "设置", kind: "icon", classification: "human", source: "manual", uniformity: 1, scrollX: false, scrollY: false, positioning: "flow", suspicious: false,
  box: { x: 10, y: 10, w: 20, h: 20 }, style: {}, asset: { ref: "gear.png", cutFrom: { x: 10, y: 10, w: 20, h: 20 } },
  iconDecision: { kind: "ambiguous", query: "settings", candidates: [], keywords: ["设置", "gear"] },
};
const candidates = [{ id: "mdi:gear", name: "gear", set: "mdi", svg: '<svg><path d="M0 0"/></svg>' }, { id: "lucide:settings", name: "settings", set: "lucide", svg: "<svg/>" }];

describe("IconPickerDialog", () => {
  it("keeps the source crop visible and auto searches the first english keyword", async () => {
    const searchIcons = vi.fn().mockResolvedValue({ candidates });
    const wrapper = mount(IconPickerDialog, { props: { projectId: "p 1", element, api: { searchIcons } } });
    await vi.waitFor(() => {
      expect(searchIcons).toHaveBeenCalledWith("gear", 30);
      expect(wrapper.findAll(".icon-grid button")).toHaveLength(2);
    });
    expect(wrapper.get('[data-test="picker-source"]').attributes("src")).toContain("p%201");
  });

  it("emits a human library decision with the displayed candidates", async () => {
    const wrapper = mount(IconPickerDialog, { props: { projectId: "p1", element, api: { searchIcons: vi.fn().mockResolvedValue({ candidates }) } } });
    await vi.waitFor(() => expect(wrapper.findAll(".icon-grid button")).toHaveLength(2));
    await wrapper.findAll(".icon-grid button")[0]!.trigger("click");
    await wrapper.get('[data-test="confirm-icon"]').trigger("click");
    expect(wrapper.emitted("confirm")?.[0]?.[0]).toEqual({ iconDecision: { kind: "library", iconId: "mdi:gear", query: "gear", candidates: ["mdi:gear", "lucide:settings"], keywords: ["设置", "gear"], by: "human" } });
  });

  it("uses the original crop on explicit request", async () => {
    const wrapper = mount(IconPickerDialog, { props: { projectId: "p1", element, api: { searchIcons: vi.fn().mockResolvedValue({ candidates: [] }) } } });
    await wrapper.get("footer button").trigger("click");
    expect(wrapper.emitted("confirm")?.[0]?.[0]).toEqual({ iconDecision: { kind: "crop", assetRef: "gear.png", reason: "人工选择使用原图切片", by: "human" } });
  });

  it("asks for a manual query when no english keyword exists", () => {
    const searchIcons = vi.fn();
    const wrapper = mount(IconPickerDialog, { props: { projectId: "p1", element: { ...element, iconDecision: { ...element.iconDecision!, keywords: ["设置"] } }, api: { searchIcons } } });
    expect(searchIcons).not.toHaveBeenCalled();
    expect(wrapper.get('[data-test="keyword-hint"]').text()).toContain("手动搜索");
  });
});
