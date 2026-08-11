import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.vue";
import { makeFakeApi, makeRegion } from "./test-helpers.js";

const initial = () => [makeRegion("a", 0, 200), makeRegion("b", 200, 200), makeRegion("c", 400, 200)];

// App.vue 直接引用 httpApi，测试里替换成不打网络的 fake。
// vi.mock 会被提升到文件顶部，所以 fake 必须在工厂内部构造，不能引用外层变量。
vi.mock("./api.js", async () => {
  const actual = await vi.importActual<typeof import("./api.js")>("./api.js");
  const helpers = await vi.importActual<typeof import("./test-helpers.js")>("./test-helpers.js");
  const regions = () => [
    helpers.makeRegion("a", 0, 200),
    helpers.makeRegion("b", 200, 200),
    helpers.makeRegion("c", 400, 200),
  ];
  return { ...actual, httpApi: helpers.makeFakeApi(regions) };
});

function press(key: string, init: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
}

async function mounted() {
  const wrapper = mount(App, { attachTo: document.body });
  // 等 onMounted 里的 loadModelConfig / load 完成
  await new Promise(resolve => setTimeout(resolve, 0));
  await wrapper.vm.$nextTick();
  return wrapper;
}

describe("App keyboard handling", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    Element.prototype.scrollIntoView = vi.fn();
    location.hash = "p1";
  });

  it("nudges the selected boundary with the arrow keys", async () => {
    const wrapper = await mounted();
    const rows = wrapper.findAll("[data-test=row]");
    await rows[0]!.trigger("click");

    press("ArrowDown");
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll("[data-test=row]")).toHaveLength(3);
    expect(wrapper.find("[data-test=status]").text()).toContain("h 201");

    press("ArrowUp");
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=status]").text()).toContain("h 200");
  });

  it("ignores arrow keys while typing in an input", async () => {
    const wrapper = await mounted();
    await wrapper.findAll("[data-test=row]")[0]!.trigger("click");
    await wrapper.findAll("[data-test=name]")[0]!.trigger("dblclick");
    const input = wrapper.find("[data-test=rename-input]").element;

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=status]").text()).toContain("h 200");
  });

  it("escapes out of split mode without dropping the selection", async () => {
    const wrapper = await mounted();
    await wrapper.findAll("[data-test=row]")[0]!.trigger("click");
    await wrapper.find("[data-test=split]").trigger("click");
    expect(wrapper.find("[data-test=cancel-split]").exists()).toBe(true);

    press("Escape");
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=cancel-split]").exists()).toBe(false);
    expect(wrapper.find("[data-test=split]").exists()).toBe(true);
  });

  it("clears the selection with escape when not splitting", async () => {
    const wrapper = await mounted();
    await wrapper.findAll("[data-test=row]")[0]!.trigger("click");
    expect(wrapper.find("[data-test=split]").exists()).toBe(true);

    press("Escape");
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=split]").exists()).toBe(false);
  });

  it("undoes and redoes with ctrl+z", async () => {
    const wrapper = await mounted();
    await wrapper.findAll("[data-test=row]")[0]!.trigger("click");

    press("ArrowDown");
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=status]").text()).toContain("h 201");

    press("z", { ctrlKey: true });
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=status]").text()).toContain("h 200");

    press("z", { ctrlKey: true, shiftKey: true });
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=status]").text()).toContain("h 201");
  });

  it("stops listening after unmount", async () => {
    const wrapper = await mounted();
    await wrapper.findAll("[data-test=row]")[0]!.trigger("click");
    wrapper.unmount();
    // 卸载后按键不应再抛错或触碰已销毁的组件
    expect(() => press("ArrowDown")).not.toThrow();
  });
});
