import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import BusyOverlay from "./BusyOverlay.vue";

describe("BusyOverlay", () => {
  it("keeps the standard spinner for non-AI work", () => {
    const wrapper = mount(BusyOverlay, { props: { label: "图片上传中…" } });
    const overlay = wrapper.find("[data-test=busy-overlay]");
    expect(overlay.exists()).toBe(true);
    expect(overlay.text()).toContain("图片上传中…");
    expect(overlay.text()).toContain("画布暂时锁定");
    expect(wrapper.find('[data-test="ai-processing-indicator"]').exists()).toBe(false);
  });

  it("uses the shared animation for AI work", () => {
    const wrapper = mount(BusyOverlay, { props: { label: "AI 正在生成页面" } });
    expect(wrapper.get('[data-test="ai-processing-indicator"]').text()).toContain("AI 正在生成页面");
  });
});
