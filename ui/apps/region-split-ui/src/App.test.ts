import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.vue";

vi.mock("./api.js", async () => {
  const actual = await vi.importActual<typeof import("./api.js")>("./api.js");
  const helpers = await vi.importActual<typeof import("./test-helpers.js")>("./test-helpers.js");
  return { ...actual, httpApi: helpers.makeFakeApi(() => [helpers.makeRegion("a", 0, 300), helpers.makeRegion("b", 300, 300)]) };
});

async function mounted() {
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { stubs: { RegionsNode: true } },
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  return wrapper;
}

describe("App pipeline workspace", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    location.hash = "";
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 1600, bottom: 900, width: 1600, height: 900, toJSON: () => ({}) }),
    });
  });

  it("renders one comparison workspace without intermediate nodes or edges", async () => {
    const wrapper = await mounted();
    expect(wrapper.findAll("[data-node-id]").map(node => node.attributes("data-node-id")))
      .toEqual(["workspace"]);
    expect(wrapper.findAll(".edges path")).toHaveLength(0);
    expect(wrapper.text()).not.toContain("表面分析");
    expect(wrapper.text()).not.toContain("AI 分段");
    wrapper.unmount();
  });

  it("ignores global shortcuts while editing and removes listeners on unmount", async () => {
    const wrapper = await mounted();
    const input = document.createElement("input");
    document.body.append(input);
    expect(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))).not.toThrow();
    wrapper.unmount();
    expect(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))).not.toThrow();
  });
});
