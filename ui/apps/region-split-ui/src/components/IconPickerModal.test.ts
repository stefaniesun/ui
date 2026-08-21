import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import IconPickerModal from "./IconPickerModal.vue";

const candidate = (id: string) => ({ id, name: id.slice(4), svg: `<svg data-id="${id}"></svg>` });

function mounted(over: Record<string, unknown> = {}) {
  const searchIcons = vi.fn(async (query: string) => ({ candidates: query === "none" ? [] : [candidate("mdi:account")] }));
  return { searchIcons, wrapper: mount(IconPickerModal, {
    props: { open: true, cropSrc: "data:image/png;base64,AAAA", initialQuery: "user", currentIconId: "", initialCandidates: [candidate("mdi:user")], searchIcons, ...over },
    global: { stubs: { Teleport: true } },
  }) };
}

describe("IconPickerModal", () => {
  it("keeps the original crop visible beside candidates", () => {
    const { wrapper } = mounted();
    expect(wrapper.get('[data-test="picker-crop"]').attributes("src")).toBe("data:image/png;base64,AAAA");
  });

  it("automatically searches the initial english query", async () => {
    const { searchIcons } = mounted({ initialCandidates: [] });
    await flushPromises();
    expect(searchIcons).toHaveBeenCalledWith("user", 24);
  });

  it("searches and preselects an existing library icon", async () => {
    const { wrapper, searchIcons } = mounted({ currentIconId: "mdi:account", initialCandidates: [] });
    await flushPromises();
    expect(searchIcons).toHaveBeenCalledWith("user", 24);
    expect(wrapper.get('[data-test="icon-candidate-mdi:account"]').classes()).toContain("selected");
    expect(wrapper.get('[data-test="icon-picker-confirm"]').attributes("disabled")).toBeUndefined();
  });

  it("asks for a manual search when no english keyword exists", async () => {
    const { wrapper, searchIcons } = mounted({ initialQuery: "", initialCandidates: [] });
    await flushPromises();
    expect(searchIcons).not.toHaveBeenCalled();
    expect(wrapper.get('[data-test="picker-hint"]').text()).toContain("手动搜索");
  });

  it("shows searched candidates and confirms the selected icon", async () => {
    const { wrapper } = mounted();
    await flushPromises();
    expect(wrapper.get('[data-test="icon-picker-grid"]').text()).toContain("account");
    await wrapper.get('[data-test="icon-candidate-mdi:account"]').trigger("click");
    await wrapper.get('[data-test="icon-picker-confirm"]').trigger("click");
    expect(wrapper.emitted("confirm")?.[0]).toEqual(["mdi:account", ["mdi:account"], "user"]);
  });

  it("searches on demand and reports no matches", async () => {
    const { wrapper, searchIcons } = mounted();
    await wrapper.get('[data-test="icon-picker-query"]').setValue("none");
    await wrapper.get('[data-test="icon-picker-search"]').trigger("click");
    await flushPromises();
    expect(searchIcons).toHaveBeenCalledWith("none", 24);
    expect(wrapper.text()).toContain("没有匹配的图标");
  });

  it("emits using the original crop", async () => {
    const { wrapper } = mounted();
    await wrapper.get('[data-test="icon-picker-use-crop"]').trigger("click");
    expect(wrapper.emitted("useCrop")).toHaveLength(1);
  });
});
