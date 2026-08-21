import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ElementRefactorPanel from "./ElementRefactorPanel.vue";

const props = {
  session: null,
  messages: [],
  diffs: [],
  error: "",
  selectedReference: { number: "1.1", displayName: "头像" },
};

describe("ElementRefactorPanel", () => {
  it("shows the shared inline AI animation while calibrating", () => {
    const wrapper = mount(ElementRefactorPanel, { props: { ...props, busy: true } });
    const indicator = wrapper.get('[data-test="ai-processing-indicator"]');
    expect(indicator.text()).toContain("AI 正在校准结构");
    expect(indicator.classes()).toContain("is-inline");
  });

  it("removes the animation when calibration is idle", () => {
    const wrapper = mount(ElementRefactorPanel, { props: { ...props, busy: false } });
    expect(wrapper.find('[data-test="ai-processing-indicator"]').exists()).toBe(false);
  });
});
