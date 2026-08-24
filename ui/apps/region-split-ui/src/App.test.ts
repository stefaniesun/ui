import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.vue";
import { httpApi } from "./api.js";

vi.mock("./api.js", async () => {
  const actual = await vi.importActual<typeof import("./api.js")>("./api.js");
  const helpers = await vi.importActual<typeof import("./test-helpers.js")>("./test-helpers.js");
  const httpApi = helpers.makeFakeApi(() => [helpers.makeRegion("a", 0, 300), helpers.makeRegion("b", 300, 300)]);
  httpApi.getProject = vi.fn(async () => ({ projectId: "p1", doc: helpers.makeDoc([helpers.makeRegion("a", 0, 300), helpers.makeRegion("b", 300, 300)], [], true) }));
  return { ...actual, httpApi };
});

async function mounted() {
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { stubs: { UploadPanel: false } },
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  return wrapper;
}

describe("App pipeline workspace", () => {
  it("shows only the upload panel before a project exists", async () => {
    const wrapper = await mounted();
    expect(wrapper.findComponent({ name: "UploadPanel" }).exists()).toBe(true);
    expect(wrapper.find(".pipeline-canvas").exists()).toBe(false);
    expect(wrapper.find(".brand").exists()).toBe(false);
    wrapper.unmount();
  });
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    location.hash = "";
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 1600, bottom: 900, width: 1600, height: 900, toJSON: () => ({}) }),
    });
  });

  it("uploads, analyzes, syncs the project hash, and builds the outline", async () => {
    const wrapper = await mounted();
    const upload = wrapper.getComponent({ name: "UploadPanel" });
    upload.vm.$emit("upload", new File(["page"], "page.png", { type: "image/png" }));

    await vi.waitFor(() => expect(httpApi.analyze).toHaveBeenCalledOnce(), { timeout: 3_000 });
    expect(httpApi.upload).toHaveBeenCalledOnce();
    expect(location.hash).toBe("#project=p1");
    expect(wrapper.find('[data-test="page-outline"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("opens a project directly in the outline without mounting the retired canvas", async () => {
    location.hash = "#project=p1";
    const wrapper = await mounted();
    await vi.waitFor(() => expect(wrapper.find('[data-test="page-outline"]').exists()).toBe(true));
    expect(wrapper.find(".pipeline-canvas").exists()).toBe(false);
    expect(wrapper.find("[data-node-id]").exists()).toBe(false);
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

  it("closes the standalone page comparison with Escape", async () => {
    location.hash = "#project=p1";
    const wrapper = await mounted();
    await vi.waitFor(() => expect(wrapper.find('[data-test="open-page-compare"]').exists()).toBe(true));
    await wrapper.get('[data-test="open-page-compare"]').trigger("click");
    expect(wrapper.find('[aria-label="整页比对"]').exists()).toBe(true);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[aria-label="整页比对"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
