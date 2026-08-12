import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import BusyOverlay from "./BusyOverlay.vue";
import { createStore } from "../state.js";
import { makeFakeApi, makeRegion } from "../test-helpers.js";

const initial = () => [makeRegion("a", 0, 300), makeRegion("b", 300, 300)];

async function mounted() {
  const store = createStore(makeFakeApi(initial));
  await store.load("p1");
  return { store, wrapper: mount(BusyOverlay, { props: { store } }) };
}

describe("BusyOverlay", () => {
  it("renders nothing while idle", async () => {
    const { wrapper } = await mounted();
    expect(wrapper.find("[data-test=busy-overlay]").exists()).toBe(false);
  });

  it("covers the workspace and names the operation in flight", async () => {
    const { store, wrapper } = await mounted();
    store.busyLabel.value = "AI 分析中…";
    await wrapper.vm.$nextTick();
    const overlay = wrapper.find("[data-test=busy-overlay]");
    expect(overlay.exists()).toBe(true);
    expect(overlay.text()).toContain("AI 分析中…");
    expect(overlay.text()).toContain("分析期间无法编辑");
  });

  it("disappears once the operation finishes", async () => {
    const { store, wrapper } = await mounted();
    store.busyLabel.value = "AI 分析中…";
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=busy-overlay]").exists()).toBe(true);
    store.busyLabel.value = "";
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=busy-overlay]").exists()).toBe(false);
  });

  // busy 是 busyLabel 派生出来的可写 computed，这样组件里既能用布尔判断，
  // 又能拿到具体文案；两者不会失去同步。
  it("stays in step with the boolean busy flag", async () => {
    const { store, wrapper } = await mounted();
    store.busy.value = true;
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=busy-overlay]").exists()).toBe(true);
    store.busy.value = false;
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=busy-overlay]").exists()).toBe(false);
  });
});
