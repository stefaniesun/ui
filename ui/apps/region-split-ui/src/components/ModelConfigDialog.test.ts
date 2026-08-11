import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import ModelConfigDialog from "./ModelConfigDialog.vue";
import { createStore } from "../state.js";
import { makeFakeApi, makeRegion } from "../test-helpers.js";

const initial = () => [makeRegion("a", 0, 600)];

async function mounted(open = true) {
  const api = makeFakeApi(initial);
  const store = createStore(api);
  await store.loadModelConfig();
  if (open) store.openConfigDialog();
  const wrapper = mount(ModelConfigDialog, { props: { store } });
  await wrapper.vm.$nextTick();
  return { store, api, wrapper };
}

describe("ModelConfigDialog", () => {
  it("renders nothing while closed", async () => {
    const { wrapper } = await mounted(false);
    expect(wrapper.find("[data-test=base-url]").exists()).toBe(false);
  });

  it("prefills the form from the saved config and masks the key", async () => {
    const { wrapper } = await mounted();
    expect((wrapper.find("[data-test=base-url]").element as HTMLInputElement).value).toBe("http://local/v1");
    expect((wrapper.find("[data-test=model-name]").element as HTMLInputElement).value).toBe("test-model");
    const key = wrapper.find("[data-test=api-key]");
    expect((key.element as HTMLInputElement).value).toBe("");
    expect(key.attributes("placeholder")).toBe("sk-••••abcd");
  });

  it("reports a successful connection test", async () => {
    const { wrapper } = await mounted();
    await wrapper.find("[data-test=test]").trigger("click");
    await new Promise(resolve => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=test-result]").text()).toContain("连接成功");
  });

  it("reports a failed connection test with the reason", async () => {
    const api = makeFakeApi(initial);
    api.testModelConfig = async () => ({ ok: false, error: "connect ECONNREFUSED" });
    const store = createStore(api);
    await store.loadModelConfig();
    store.openConfigDialog();
    const wrapper = mount(ModelConfigDialog, { props: { store } });
    await wrapper.vm.$nextTick();
    await wrapper.find("[data-test=test]").trigger("click");
    await new Promise(resolve => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=test-result]").text()).toContain("connect ECONNREFUSED");
  });

  it("saves the edited values and omits an empty key", async () => {
    const api = makeFakeApi(initial);
    const putModelConfig = vi.fn(api.putModelConfig);
    api.putModelConfig = putModelConfig;
    const store = createStore(api);
    await store.loadModelConfig();
    store.openConfigDialog();
    const wrapper = mount(ModelConfigDialog, { props: { store } });
    await wrapper.vm.$nextTick();
    await wrapper.find("[data-test=base-url]").setValue("http://other/v1");
    await wrapper.find("[data-test=save]").trigger("click");
    expect(putModelConfig).toHaveBeenCalledWith({
      baseUrl: "http://other/v1", model: "test-model", apiKey: undefined,
    });
  });

  it("closes on cancel without saving", async () => {
    const { store, wrapper } = await mounted();
    await wrapper.find("[data-test=cancel]").trigger("click");
    expect(store.configDialogOpen.value).toBe(false);
  });
});
