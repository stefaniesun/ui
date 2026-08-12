import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import RegionList from "./RegionList.vue";
import { createStore } from "../state.js";
import { makeFakeApi, makeRegion } from "../test-helpers.js";

const initial = () => [makeRegion("a", 0, 300), makeRegion("b", 300, 300)];

async function mounted() {
  const store = createStore(makeFakeApi(initial));
  await store.load("p1");
  return { store, wrapper: mount(RegionList, { props: { store } }) };
}

describe("RegionList", () => {
  it("lists every region with type and confidence", async () => {
    const { wrapper } = await mounted();
    const rows = wrapper.findAll("[data-test=row]");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain("名-a");
    expect(rows[0]!.text()).toContain("card");
    expect(rows[0]!.text()).toContain("87%");
  });

  it("badges regions that scroll, and leaves static ones unmarked", async () => {
    const store = createStore(makeFakeApi(() => [
      makeRegion("a", 0, 300, { x: true }),
      makeRegion("b", 300, 300),
    ]));
    await store.load("p1");
    const wrapper = mount(RegionList, { props: { store } });
    const rows = wrapper.findAll("[data-test=row]");
    const badge = rows[0]!.find("[data-test=scroll]");
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe("↔");
    expect(badge.attributes("title")).toBe("可横向滑动");
    expect(rows[1]!.find("[data-test=scroll]").exists()).toBe(false);
  });

  it("warns that an un-analysed document is only the initial split", async () => {
    const { store, wrapper } = await mounted();
    const notice = wrapper.find("[data-test=needs-analysis]");
    expect(notice.exists()).toBe(true);
    expect(notice.text()).toContain("初始划分");
    expect(notice.text()).toContain("重新分析");
  });

  it("drops the warning once the document has been analysed", async () => {
    const store = createStore(makeFakeApi(initial));
    await store.load("p1");
    store.doc.value = { ...store.doc.value!, analyzedAt: "2026-08-12T00:00:00.000Z" };
    const wrapper = mount(RegionList, { props: { store } });
    expect(wrapper.find("[data-test=needs-analysis]").exists()).toBe(false);
  });

  it("selects on click and adds with ctrl-click", async () => {
    const { store, wrapper } = await mounted();
    await wrapper.findAll("[data-test=row]")[1]!.trigger("click");
    expect(store.selectedIds.value).toEqual(["b"]);
    await wrapper.findAll("[data-test=row]")[0]!.trigger("click", { ctrlKey: true });
    expect(store.selectedIds.value).toEqual(["b", "a"]);
  });

  it("renames inline on double click", async () => {
    const { store, wrapper } = await mounted();
    await wrapper.findAll("[data-test=name]")[0]!.trigger("dblclick");
    const input = wrapper.find("[data-test=rename-input]");
    expect(input.exists()).toBe(true);
    await input.setValue("会员卡");
    await input.trigger("keydown", { key: "Enter" });
    expect(store.regions.value[0]!.displayName).toBe("会员卡");
  });

  it("cancels renaming on escape", async () => {
    const { store, wrapper } = await mounted();
    await wrapper.findAll("[data-test=name]")[0]!.trigger("dblclick");
    const input = wrapper.find("[data-test=rename-input]");
    await input.setValue("不要这个");
    await input.trigger("keydown", { key: "Escape" });
    expect(store.regions.value[0]!.displayName).toBe("名-a");
    expect(wrapper.find("[data-test=rename-input]").exists()).toBe(false);
  });

  it("enters edit mode when the toolbar requests a rename", async () => {
    const { store, wrapper } = await mounted();
    store.startRename("b");
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=rename-input]").exists()).toBe(true);
  });

  it("shows a naming placeholder while the model is running", async () => {
    const { store, wrapper } = await mounted();
    store.pendingRenameIds.value = ["a"];
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll("[data-test=name]")[0]!.text()).toBe("命名中…");
  });

  it("highlights a row on hover and clears it on mouseleave", async () => {
    const { wrapper } = await mounted();
    const rows = wrapper.findAll("[data-test=row]");
    await rows[0]!.trigger("mouseenter");
    expect(wrapper.findAll("[data-test=row]")[0]!.classes()).toContain("hovered");
    expect(wrapper.findAll("[data-test=row]")[1]!.classes()).not.toContain("hovered");
    await rows[0]!.trigger("mouseleave");
    expect(wrapper.findAll("[data-test=row]")[0]!.classes()).not.toContain("hovered");
  });

  it("reflects an externally hovered id (e.g. from the canvas) without marking it selected", async () => {
    const { store, wrapper } = await mounted();
    await wrapper.setProps({ hoveredId: "b" });
    const rows = wrapper.findAll("[data-test=row]");
    expect(rows[1]!.classes()).toContain("hovered");
    expect(rows[1]!.classes()).not.toContain("selected");
    expect(store.selectedIds.value).toEqual([]);
  });

  // ⑥ 拆分模式下画布色块被禁用了点击（pointer-events: none），但列表行原本还能点，
  // ctrl+点第二行会把 selectedIndex 变成 -1，操作条卡死显示"拆分「undefined」"。
  it("ignores row clicks while in split mode so the selection can't drift out from under it", async () => {
    const { store, wrapper } = await mounted();
    store.select("a", false);
    store.beginSplit();
    expect(store.mode.value).toBe("split");
    await wrapper.vm.$nextTick();

    await wrapper.findAll("[data-test=row]")[1]!.trigger("click", { ctrlKey: true });

    expect(store.selectedIds.value).toEqual(["a"]);
    expect(store.mode.value).toBe("split");
  });

  it("scrolls the newly selected row into view", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const { store, wrapper } = await mounted();
    store.select("b", false);
    await wrapper.vm.$nextTick();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });
});
