import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ErrorDialog from "./ErrorDialog.vue";

describe("ErrorDialog", () => {
  it("shows details and config path with accessible dialog semantics", () => {
    const wrapper = mount(ErrorDialog, {
      props: {
        title: "AI 模型未配置",
        message: "使用前必须配置模型",
        configPath: "D:/workspace/ui/region-split.config.json",
        retryable: false,
      },
    });
    const dialog = wrapper.get('[role="dialog"]');
    expect(dialog.attributes("aria-modal")).toBe("true");
    expect(dialog.attributes("aria-labelledby")).toBe("error-dialog-title");
    expect(wrapper.text()).toContain("AI 模型未配置");
    expect(wrapper.text()).toContain("D:/workspace/ui/region-split.config.json");
    expect(wrapper.find('[data-test="retry-error"]').exists()).toBe(false);
  });

  it("emits close and retry without owning application state", async () => {
    const wrapper = mount(ErrorDialog, {
      props: { title: "分析失败", message: "模型不可用", retryable: true },
    });
    await wrapper.get('[data-test="retry-error"]').trigger("click");
    await wrapper.get('[data-test="close-error"]').trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
    expect(wrapper.emitted("close")).toHaveLength(1);
  });
});
