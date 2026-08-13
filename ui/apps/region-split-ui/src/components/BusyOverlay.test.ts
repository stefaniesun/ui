import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import BusyOverlay from "./BusyOverlay.vue";

describe("BusyOverlay", () => {
  it("covers the canvas and names the operation in flight", () => {
    const wrapper = mount(BusyOverlay, { props: { label: "AI 分析中…" } });
    const overlay = wrapper.find("[data-test=busy-overlay]");
    expect(overlay.exists()).toBe(true);
    expect(overlay.text()).toContain("AI 分析中…");
    expect(overlay.text()).toContain("画布暂时锁定");
  });
});
