import { describe, expect, it, vi } from "vitest";
import { makeDoc, makeFakeApi, makeRegion } from "./test-helpers.js";
import { createStore } from "./state.js";

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe("store", () => {
  it("uploads and stores the returned project", async () => {
    const api = makeFakeApi(() => []);
    const store = createStore(api);
    await store.uploadImage(new File(["page"], "page.png", { type: "image/png" }));
    expect(api.upload).toHaveBeenCalledOnce();
    expect(store.projectId.value).toBe("p1");
    expect(store.doc.value?.image.width).toBe(375);
  });

  it("loads an existing project", async () => {
    const api = makeFakeApi(() => []);
    const store = createStore(api);
    await store.load("p1");
    expect(api.getProject).toHaveBeenCalledWith("p1");
    expect(store.projectId.value).toBe("p1");
  });

  it("analyzes the current project", async () => {
    const api = makeFakeApi(() => []);
    api.getProject = async projectId => ({ projectId, doc: makeDoc([makeRegion("a", 0, 300)]) });
    api.analyze = async () => ({ doc: makeDoc([makeRegion("a", 0, 300)], [], true) });
    const store = createStore(api);
    await store.load("p1");
    await store.analyze();
    expect(store.doc.value?.analyzedAt).toBeTruthy();
  });

  it("does not start a second analysis while busy", async () => {
    const api = makeFakeApi(() => []);
    let finish!: () => void;
    api.getProject = async projectId => ({ projectId, doc: makeDoc([makeRegion("a", 0, 300)]) });
    api.analyze = vi.fn(async () => { await new Promise<void>(resolve => { finish = resolve; }); return { doc: makeDoc([], [], true) }; });
    const store = createStore(api);
    await store.load("p1");
    const first = store.analyze();
    await tick();
    const second = store.analyze();
    expect(api.analyze).toHaveBeenCalledTimes(1);
    finish();
    await Promise.all([first, second]);
  });

  it("stores model configuration and errors", async () => {
    const api = makeFakeApi(() => []);
    const store = createStore(api);
    await store.loadModelConfig();
    expect(store.modelConfig.value?.hasApiKey).toBe(true);
    api.getModelConfig = async () => { throw new Error("配置读取失败"); };
    await store.loadModelConfig();
    expect(store.error.value).toBe("配置读取失败");
  });

  it("persists the selected font stack", async () => {
    const api = makeFakeApi(() => []);
    const store = createStore(api);
    await store.load("p1");
    await store.setFontStack("system-ui");
    expect(api.putFontStack).toHaveBeenCalledWith("p1", "system-ui");
    expect(store.doc.value?.fontStack).toBe("system-ui");
  });
});
