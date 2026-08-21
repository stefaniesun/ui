import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AiProcessingIndicator from "./AiProcessingIndicator.vue";

describe("AiProcessingIndicator", () => {
  it("renders the shared AI processing visuals and accessible label", () => {
    const wrapper = mount(AiProcessingIndicator, { props: { label: "AI 正在解析区域" } });

    expect(wrapper.get('[data-test="ai-processing-indicator"]').attributes("role")).toBe("status");
    expect(wrapper.text()).toContain("AI 正在解析区域");
    expect(wrapper.find('[data-test="ai-processing-scan"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="ai-processing-focus"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-test="ai-processing-dot"]')).toHaveLength(3);
  });

  it("supports inline mode for narrow AI panels", () => {
    const wrapper = mount(AiProcessingIndicator, { props: { mode: "inline" } });
    expect(wrapper.get('[data-test="ai-processing-indicator"]').classes()).toContain("is-inline");
    expect(wrapper.text()).toContain("AI 正在解析");
  });
});
