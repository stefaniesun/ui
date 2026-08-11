import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createStore } from "./state.js";
import { makeFakeApi, makeRegion } from "./test-helpers.js";

const initial = () => [makeRegion("a", 0, 200), makeRegion("b", 200, 200), makeRegion("c", 400, 200)];

async function loadedStore() {
  const api = makeFakeApi(initial);
  const store = createStore(api);
  await store.load("p1");
  return { store, putRegions: api.putRegions as Mock };
}

describe("createStore", () => {
  beforeEach(() => vi.useFakeTimers());

  it("selects single and additive", async () => {
    const { store } = await loadedStore();
    store.select("a", false);
    expect(store.selectedIds.value).toEqual(["a"]);
    store.select("b", true);
    expect(store.selectedIds.value).toEqual(["a", "b"]);
    store.select("b", true);
    expect(store.selectedIds.value).toEqual(["a"]);
    store.select("c", false);
    expect(store.selectedIds.value).toEqual(["c"]);
  });

  it("nudges the selected boundary and coalesces undo snapshots", async () => {
    const { store } = await loadedStore();
    store.select("a", false);
    store.nudge(1);
    store.nudge(1);
    store.nudge(1);
    expect(store.regions.value[0]!.bounds.h).toBe(203);
    store.undo();
    expect(store.regions.value[0]!.bounds.h).toBe(200);
  });

  it("starts a new undo snapshot after the coalesce window", async () => {
    const { store } = await loadedStore();
    store.select("a", false);
    store.nudge(1);
    vi.advanceTimersByTime(600);
    store.nudge(1);
    expect(store.regions.value[0]!.bounds.h).toBe(202);
    store.undo();
    expect(store.regions.value[0]!.bounds.h).toBe(201);
  });

  it("debounces persistence for nudges and persists structure changes immediately", async () => {
    const { store, putRegions } = await loadedStore();
    store.select("a", false);
    store.nudge(1);
    expect(putRegions).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(putRegions).toHaveBeenCalledTimes(1);

    putRegions.mockClear();
    store.select("b", false);
    store.beginSplit();
    store.commitSplit(300);
    expect(putRegions).toHaveBeenCalledTimes(1);
  });

  it("loads the model configuration and exposes whether it is usable", async () => {
    const { store } = await loadedStore();
    expect(store.isModelConfigured.value).toBe(false);
    await store.loadModelConfig();
    expect(store.modelConfig.value).toMatchObject({ baseUrl: "http://local/v1", model: "test-model" });
    expect(store.isModelConfigured.value).toBe(true);
  });

  it("records the connection test result", async () => {
    const { store } = await loadedStore();
    await store.testModelConfig({ baseUrl: "http://local/v1", model: "m" });
    expect(store.configTestResult.value).toEqual({ ok: true });
  });

  it("splits the selected region and selects the new lower block", async () => {
    const { store } = await loadedStore();
    store.select("b", false);
    store.beginSplit();
    expect(store.mode.value).toBe("split");
    store.commitSplit(300);
    expect(store.mode.value).toBe("idle");
    expect(store.regions.value.map(r => r.id)).toEqual(["a", "b", "b-2", "c"]);
    expect(store.selectedIds.value).toEqual(["b-2"]);
  });

  it("merges only adjacent selections", async () => {
    const { store } = await loadedStore();
    store.select("a", false);
    store.select("c", true);
    expect(store.canMerge.value).toBe(false);
    store.select("b", true);
    expect(store.canMerge.value).toBe(true);
    store.merge();
    expect(store.regions.value).toHaveLength(1);
    expect(store.regions.value[0]!.bounds).toEqual({ x: 0, y: 0, w: 375, h: 600 });
  });

  it("undoes and redoes structural changes", async () => {
    const { store } = await loadedStore();
    store.select("b", false);
    store.rename("b", "会员卡");
    expect(store.regions.value[1]!.displayName).toBe("会员卡");
    expect(store.canUndo.value).toBe(true);
    store.undo();
    expect(store.regions.value[1]!.displayName).toBe("名-b");
    store.redo();
    expect(store.regions.value[1]!.displayName).toBe("会员卡");
  });

  it("clears the redo stack when a new operation happens", async () => {
    const { store } = await loadedStore();
    store.select("b", false);
    store.rename("b", "一");
    store.undo();
    expect(store.canRedo.value).toBe(true);
    store.rename("b", "二");
    expect(store.canRedo.value).toBe(false);
  });

  it("caps the undo stack at 50 entries", async () => {
    const { store } = await loadedStore();
    for (let i = 0; i < 60; i++) store.rename("b", `名字-${i}`);
    let depth = 0;
    while (store.canUndo.value) { store.undo(); depth++; }
    expect(depth).toBe(50);
  });

  // canUndo/canRedo 必须是响应式的：界面的撤销/重做按钮靠它们启用。
  // 先读一次再操作，能抓住"computed 无响应式依赖、首次求值后永远缓存"的退化。
  it("keeps canUndo and canRedo reactive after they are first read", async () => {
    const { store } = await loadedStore();
    expect(store.canUndo.value).toBe(false);
    expect(store.canRedo.value).toBe(false);

    store.select("b", false);
    store.rename("b", "会员卡");
    expect(store.canUndo.value).toBe(true);
    expect(store.canRedo.value).toBe(false);

    store.undo();
    expect(store.canUndo.value).toBe(false);
    expect(store.canRedo.value).toBe(true);

    store.redo();
    expect(store.canUndo.value).toBe(true);
    expect(store.canRedo.value).toBe(false);
  });

  // 分析失败必须把刚压入的快照丢掉，否则会留下一个"什么都没变"的撤销步
  it("drops the undo snapshot when analysis fails", async () => {
    const api = makeFakeApi(initial);
    api.analyze = async () => { throw new Error("model not configured"); };
    const store = createStore(api);
    await store.load("p1");
    await store.analyze();
    expect(store.error.value).toBe("model not configured");
    expect(store.canUndo.value).toBe(false);
  });
});
