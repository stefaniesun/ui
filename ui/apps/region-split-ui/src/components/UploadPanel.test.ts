import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import UploadPanel from "./UploadPanel.vue";

function file(name = "page.png") { return new File(["image"], name, { type: "image/png" }); }

describe("UploadPanel", () => {
  it("renders the portrait phone upload workspace", () => {
    const wrapper = mount(UploadPanel, { props: { busy: false } });
    expect(wrapper.get(".phone-status-bar").text()).toContain("9:41");
    expect(wrapper.get(".upload-drop-zone").text()).toContain("拖放 PNG、JPG 或 WebP");
    expect(wrapper.get(".upload-drop-zone").text()).toContain("推荐 375px 宽的手机长截图");
    expect(wrapper.get(".phone-home-indicator")).toBeTruthy();
    expect(wrapper.get("input[type=file]").attributes("accept")).toBe("image/png,image/jpeg,image/webp");
  });

  it("emits the selected file", async () => {
    const wrapper = mount(UploadPanel, { props: { busy: false } });
    const selected = file();
    const input = wrapper.get("input[type=file]");
    Object.defineProperty(input.element, "files", { value: [selected] });
    await input.trigger("change");
    expect(wrapper.emitted("upload")?.[0]).toEqual([selected]);
  });

  it("emits a dropped file once", async () => {
    const wrapper = mount(UploadPanel, { props: { busy: false } });
    const dropped = file("drop.png");
    await wrapper.get(".upload-drop-zone").trigger("drop", { dataTransfer: { files: [dropped] } });
    expect(wrapper.emitted("upload")).toEqual([[dropped]]);
  });

  it("disables selection and ignores drops while busy", async () => {
    const wrapper = mount(UploadPanel, { props: { busy: true } });
    expect(wrapper.get("input[type=file]").attributes()).toHaveProperty("disabled");
    expect(wrapper.get(".upload-button").attributes()).toHaveProperty("disabled");
    await wrapper.get(".upload-drop-zone").trigger("drop", { dataTransfer: { files: [file()] } });
    expect(wrapper.emitted("upload")).toBeUndefined();
  });

  it("opens the input from the keyboard accessible button", async () => {
    const wrapper = mount(UploadPanel, { props: { busy: false } });
    const click = vi.spyOn(wrapper.get("input[type=file]").element as HTMLInputElement, "click");
    await wrapper.get(".upload-button").trigger("click");
    expect(click).toHaveBeenCalledOnce();
  });
});
