import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createStore } from "./state.js";
import { makeDoc, makeFakeApi, makeRegion } from "./test-helpers.js";

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

  // 模型配置是服务端只读给出的，前端不写；界面只用它决定能否分析、
  // 以及未配置时提示该去改哪个文件。
  it("exposes the config file path so the toolbar can tell the user where to configure", async () => {
    const { store } = await loadedStore();
    await store.loadModelConfig();
    expect(store.modelConfig.value?.configPath).toContain("region-split.config.json");
    expect(JSON.stringify(store.modelConfig.value)).not.toContain("apiKey");
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

  // ⑧ 名字没变就不该产生撤销步或落盘请求
  it("skips rename when the new name matches the current one", async () => {
    const { store, putRegions } = await loadedStore();
    store.select("b", false);
    store.rename("b", "名-b");
    expect(store.canUndo.value).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(putRegions).not.toHaveBeenCalled();
  });

  // 遮罩层只是视觉拦截，真正保证"分析期间改不动"的是这些守卫。
  // 遮罩在真实浏览器里挡住指针，但它不该是唯一防线——键盘、程序化调用都绕得过。
  describe("busy guards", () => {
    it("ignores every mutating action while an operation is in flight", async () => {
      const { store, putRegions } = await loadedStore();
      store.select("a", false);
      const before = store.regions.value;

      store.busyLabel.value = "AI 分析中…";
      store.nudge(1);
      store.beginSplit();
      store.commitSplit(100);
      store.rename("a", "改个名");
      store.select("b", true);
      store.merge();

      expect(store.regions.value).toBe(before);   // 引用未变 = 一点没动
      expect(store.mode.value).toBe("idle");      // 没进入拆分模式
      await vi.advanceTimersByTimeAsync(500);
      expect(putRegions).not.toHaveBeenCalled();  // 也没有落盘请求
    });

    it("resumes normally once the operation finishes", async () => {
      const { store } = await loadedStore();
      store.select("a", false);
      store.busyLabel.value = "AI 分析中…";
      store.nudge(1);
      expect(store.regions.value[0]!.bounds.h).toBe(200);

      store.busyLabel.value = "";
      store.nudge(1);
      expect(store.regions.value[0]!.bounds.h).toBe(201);
    });

    it("labels each kind of operation so the overlay can name it", async () => {
      const api = makeFakeApi(initial);
      let seen = "";
      api.analyze = async () => { seen = store.busyLabel.value; return { doc: makeDoc(initial()) }; };
      const store = createStore(api);
      await store.load("p1");
      await store.analyze();
      expect(seen).toBe("AI 分析中…");
      expect(store.busyLabel.value).toBe("");   // 结束后清空
    });
  });

  describe("auto AI rename after split/merge", () => {
    // 这组用例只依赖真实 Promise 微任务链（受控 gate promise），不需要也不应该
    // 被假定时器影响——用假定时器反而要手动推进才能让微任务队列前进，脆弱且没必要。
    beforeEach(() => vi.useRealTimers());

    async function configuredStore() {
      const api = makeFakeApi(initial);
      const store = createStore(api);
      await store.load("p1");
      await store.loadModelConfig();
      return { store, api };
    }

    it("auto-renames both new blocks after a split, in order, once the model is configured", async () => {
      const { store, api } = await configuredStore();
      const seen: string[] = [];
      (api.renameAi as Mock).mockImplementation(async (_pid: string, regionId: string) => {
        seen.push(regionId);
        return { doc: makeDoc(store.regions.value) };
      });
      store.select("b", false);
      store.beginSplit();
      await store.commitSplit(300);
      expect(seen).toEqual(["b", "b-2"]);
    });

    it("shows a naming placeholder for both new blocks while the requests are in flight, then clears it", async () => {
      const { store, api } = await configuredStore();
      let releaseFirst!: () => void;
      const gate = new Promise<void>(resolve => { releaseFirst = resolve; });
      (api.renameAi as Mock).mockImplementation(async (_pid: string, regionId: string) => {
        if (regionId === "b") await gate;
        return { doc: makeDoc(store.regions.value) };
      });
      store.select("b", false);
      store.beginSplit();
      const done = store.commitSplit(300);
      // 真实 setTimeout(0) 排在所有已入队微任务之后，足以让 commitSplit 跑到
      // 卡在 gate 上的那次 renameAi 调用——此时两个新块都应该已经标记为待命名。
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(store.pendingRenameIds.value.slice().sort()).toEqual(["b", "b-2"]);
      releaseFirst();
      await done;
      expect(store.pendingRenameIds.value).toEqual([]);
    });

    it("auto-renames the merged region after a merge", async () => {
      const { store, api } = await configuredStore();
      const seen: string[] = [];
      (api.renameAi as Mock).mockImplementation(async (_pid: string, regionId: string) => {
        seen.push(regionId);
        return { doc: makeDoc(store.regions.value) };
      });
      store.select("a", false);
      store.select("b", true);
      await store.merge();
      expect(seen).toEqual(["a"]);
    });

    it("skips auto rename entirely when the model is not configured", async () => {
      const api = makeFakeApi(initial);
      const store = createStore(api);
      await store.load("p1");
      store.select("b", false);
      store.beginSplit();
      await store.commitSplit(300);
      expect(api.renameAi).not.toHaveBeenCalled();
      // 上块沿用原区域的名字（只是边界变了），只有新拆出来的下块是占位名
      expect(store.regions.value.map(r => r.displayName)).toEqual(["名-a", "名-b", "未命名区域", "名-c"]);
    });

    it("leaves the placeholder name and clears pending state when the model call fails, without surfacing an error", async () => {
      const { store, api } = await configuredStore();
      (api.renameAi as Mock).mockRejectedValue(new Error("model timed out"));
      store.select("b", false);
      store.beginSplit();
      await store.commitSplit(300);
      expect(store.pendingRenameIds.value).toEqual([]);
      expect(store.error.value).toBe("");
      expect(store.regions.value.map(r => r.displayName)).toContain("未命名区域");
    });

    it("does not push an extra undo step for the automatic rename — only the split itself", async () => {
      const { store, api } = await configuredStore();
      (api.renameAi as Mock).mockImplementation(async (_pid: string, regionId: string) => ({
        doc: makeDoc(store.regions.value.map(r => (r.id === regionId ? { ...r, displayName: "AI 命名" } : r))),
      }));
      store.select("b", false);
      store.beginSplit();
      await store.commitSplit(300);
      expect(store.regions.value.map(r => r.id)).toEqual(["a", "b", "b-2", "c"]);
      store.undo();
      expect(store.regions.value.map(r => r.id)).toEqual(["a", "b", "c"]);
      expect(store.canUndo.value).toBe(false);
    });

    // ① commitSplit 里新块的 id 是本地算出来的（如 b-2），真实服务端的 AI 重命名
    // 会给区域分配一个新 id——如果那个区域当时被选中，选中态必须跟着换成新 id，
    // 否则拆完自动重命名一结束，刚拆出来的块会悄悄地失去选中。
    it("follows the server-assigned id when the auto-renamed block was selected", async () => {
      const { store, api } = await configuredStore();
      (api.renameAi as Mock).mockImplementation(async (_pid: string, regionId: string) => ({
        doc: makeDoc(store.regions.value.map(r =>
          (r.id === regionId ? { ...r, id: `region-${regionId}`, displayName: "AI 命名" } : r))),
      }));
      store.select("b", false);
      store.beginSplit();
      await store.commitSplit(300);
      expect(store.selectedIds.value).toEqual(["region-b-2"]);
    });

    it("still pushes one undo step for a manual AI rename via the toolbar button", async () => {
      const { store } = await configuredStore();
      store.select("b", false);
      await store.aiRename("b");
      expect(store.canUndo.value).toBe(true);
      store.undo();
      expect(store.regions.value.map(r => r.id)).toEqual(["a", "b", "c"]);
      expect(store.canUndo.value).toBe(false);
    });
  });

  // ② 未落盘的边界微调必须在 AI 重命名 / 重新分析前先冲掉，否则服务端会用磁盘上的
  // 旧文档覆盖刚才的微调结果。
  describe("flushing pending edits before model requests", () => {
    beforeEach(() => vi.useRealTimers());

    it("flushes a pending debounced nudge before sending an AI rename request", async () => {
      const { store, putRegions } = await loadedStore();
      store.select("a", false);
      store.nudge(1);
      expect(putRegions).not.toHaveBeenCalled();
      await store.aiRename("a");
      expect(putRegions).toHaveBeenCalledTimes(1);
      expect(putRegions.mock.calls[0]![1][0].bounds.h).toBe(201);
    });

    it("flushes a pending debounced nudge before re-analyzing", async () => {
      const { store, putRegions } = await loadedStore();
      store.select("a", false);
      store.nudge(1);
      expect(putRegions).not.toHaveBeenCalled();
      await store.analyze();
      expect(putRegions).toHaveBeenCalledTimes(1);
      expect(putRegions.mock.calls[0]![1][0].bounds.h).toBe(201);
    });
  });

  // ④ persistNow 的失败回滚不能吞掉飞行中的编辑，也不能产生未捕获的 rejection
  describe("persistNow failure handling", () => {
    beforeEach(() => vi.useRealTimers());

    it("does not throw when both the save and the fallback refetch fail", async () => {
      const { store, api } = await (async () => {
        const api = makeFakeApi(initial);
        const store = createStore(api);
        await store.load("p1");
        return { store, api };
      })();
      (api.putRegions as Mock).mockRejectedValue(new Error("save failed"));
      (api.getProject as Mock).mockRejectedValue(new Error("network down"));
      store.select("a", false);
      store.nudge(1);
      await expect(store.flushPersist()).resolves.toBeUndefined();
      expect(store.error.value).toBeTruthy();
      // 本地编辑保留，不能被拉取失败的回滚逻辑覆盖成别的东西
      expect(store.regions.value[0]!.bounds.h).toBe(201);
    });
  });
});
