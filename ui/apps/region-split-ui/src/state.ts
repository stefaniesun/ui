import { computed, ref, shallowRef } from "vue";
import {
  adjustBoundary, areAdjacent, canAdjustBoundary, canSplitAt,
  mergeRegions, renameRegion, splitRegion,
  type ModelConfigView, type Region, type RegionSplitDoc,
} from "@region-split/core/browser";
import type { ModelConfigInput, StoreApi } from "./api.js";

export type { ModelConfigInput, StoreApi };

const UNDO_STACK_LIMIT = 50;
const COALESCE_MS = 500;
const PERSIST_DEBOUNCE_MS = 400;

export function createStore(api: StoreApi) {
  const projectId = ref("");
  const doc = shallowRef<RegionSplitDoc | null>(null);
  const regions = shallowRef<Region[]>([]);
  const selectedIds = ref<string[]>([]);
  const mode = ref<"idle" | "split">("idle");
  const busy = ref(false);
  const error = ref("");
  const pendingRenameIds = ref<string[]>([]);
  const renamingId = ref<string | null>(null);
  const modelConfig = ref<ModelConfigView | null>(null);
  const configDialogOpen = ref(false);
  const configTestResult = ref<{ ok: boolean; error?: string } | null>(null);

  // 栈本身用普通数组（快照不需要响应式），深度单独用 ref 暴露，
  // 否则 canUndo/canRedo 这类 computed 没有响应式依赖，首次求值后就再也不会失效。
  const undoStack: Region[][] = [];
  const redoStack: Region[][] = [];
  const undoDepth = ref(0);
  const redoDepth = ref(0);
  let lastNudgeAt = 0;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  function syncDepths() {
    undoDepth.value = undoStack.length;
    redoDepth.value = redoStack.length;
  }

  function snapshot(): Region[] {
    return regions.value.map(region => ({ ...region, bounds: { ...region.bounds } }));
  }

  const selectedIndex = computed(() =>
    selectedIds.value.length === 1
      ? regions.value.findIndex(region => region.id === selectedIds.value[0])
      : -1);
  const selectedRegion = computed(() =>
    selectedIndex.value >= 0 ? regions.value[selectedIndex.value]! : null);
  const canNudge = computed(() =>
    selectedIndex.value >= 0 && canAdjustBoundary(regions.value, selectedIndex.value));
  const canMerge = computed(() => areAdjacent(regions.value, selectedIds.value));
  const canUndo = computed(() => undoDepth.value > 0);
  const canRedo = computed(() => redoDepth.value > 0);
  const isModelConfigured = computed(() =>
    Boolean(modelConfig.value?.baseUrl) && Boolean(modelConfig.value?.model));
  const candidateLines = computed(() => doc.value?.candidateLines ?? []);

  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > UNDO_STACK_LIMIT) undoStack.shift();
    redoStack.length = 0;
    syncDepths();
  }

  // 结构性操作失败时回滚刚压入的快照
  function dropLastUndo() {
    undoStack.pop();
    syncDepths();
  }

  async function persistNow() {
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    if (!projectId.value) return;
    try {
      const result = await api.putRegions(projectId.value, regions.value);
      doc.value = result.doc;
    } catch (err) {
      error.value = (err as Error).message;
      // 落盘失败后尝试用服务端当前状态纠正本地——但这个纠正本身也可能失败
      // （网络仍然不通）。纠正失败时只报错，绝不能让本地飞行中的编辑被
      // 一个半失败的回滚过程篡改成别的东西；调用方全是 `void persistNow()`，
      // 这里也绝不能让异常逃出去变成 unhandled rejection。
      try {
        const fresh = await api.getProject(projectId.value);
        doc.value = fresh.doc;
        regions.value = fresh.doc.regions;
      } catch (fetchErr) {
        error.value = (fetchErr as Error).message;
      }
    }
  }

  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => { persistTimer = null; void persistNow(); }, PERSIST_DEBOUNCE_MS);
  }

  function setDoc(next: RegionSplitDoc, id?: string) {
    doc.value = next;
    regions.value = next.regions;
    if (id) projectId.value = id;
    selectedIds.value = [];
    mode.value = "idle";
  }

  // 单次 AI 命名调用的裸操作：只管请求 + 应用结果，不管撤销栈也不管
  // pendingRenameIds——这两件事在"手动重命名"和"拆分/合并后自动重命名"里
  // 语义不同（前者压一步撤销、失败要报错；后者复用调用方已压的那一步、
  // 失败要静默保留占位名），由各自的调用方处理。
  async function applyAiRename(id: string): Promise<void> {
    const result = await api.renameAi(projectId.value, id);
    doc.value = result.doc;
    regions.value = result.doc.regions;
  }

  // 拆分/合并后的自动重命名：模型未配置时直接跳过（不发请求也不报错，新块保持
  // 占位名）。失败或超时也只是静默保留占位名——这是锦上添花的自动动作，不是
  // 用户主动发起的操作，不该弹红字错误；人工仍可通过 [AI 重命名] 按钮重试。
  // 所有目标 id 一次性标记为"命名中…"（哪怕请求是顺序发出的），符合规格里
  // "新区域都显示命名中占位"的要求；顺序发请求是为了不让两个并发请求同时
  // 读写服务端同一份磁盘文档，产生互相覆盖的竞态。
  async function autoRenameStructuralResult(ids: string[]): Promise<void> {
    if (!projectId.value || !isModelConfigured.value || ids.length === 0) return;
    pendingRenameIds.value = [...pendingRenameIds.value, ...ids];
    for (const id of ids) {
      const indexBefore = regions.value.findIndex(region => region.id === id);
      try {
        await applyAiRename(id);
        // AI 重命名会顺带重新分配 id（真实服务端如此，测试里的假 api 默认不会）。
        // 这个区域如果当时被选中，选中态要跟着换成新 id——否则拆分自动重命名
        // 一结束，刚拆出来的块会悄悄地从"已选中"变成"什么都没选中"。
        const newId = indexBefore >= 0 ? regions.value[indexBefore]?.id : undefined;
        if (newId && newId !== id && selectedIds.value.includes(id)) {
          selectedIds.value = selectedIds.value.map(item => (item === id ? newId : item));
        }
      } catch {
        // 静默保留占位名，见上方注释。
      } finally {
        pendingRenameIds.value = pendingRenameIds.value.filter(item => item !== id);
      }
    }
  }

  return {
    projectId, doc, regions, selectedIds, mode, busy, error, pendingRenameIds, renamingId,
    modelConfig, configDialogOpen, configTestResult,
    selectedIndex, selectedRegion, canNudge, canMerge, canUndo, canRedo,
    isModelConfigured, candidateLines,

    startRename(id: string) { renamingId.value = id; },
    stopRename() { renamingId.value = null; },

    async loadModelConfig() {
      try { modelConfig.value = await api.getModelConfig(); }
      catch (err) { error.value = (err as Error).message; }
    },
    openConfigDialog() { configTestResult.value = null; configDialogOpen.value = true; },
    closeConfigDialog() { configDialogOpen.value = false; },
    async saveModelConfig(input: ModelConfigInput) {
      try { modelConfig.value = await api.putModelConfig(input); configDialogOpen.value = false; }
      catch (err) { error.value = (err as Error).message; }
    },
    async testModelConfig(input: ModelConfigInput) {
      configTestResult.value = null;
      try { configTestResult.value = await api.testModelConfig(input); }
      catch (err) { configTestResult.value = { ok: false, error: (err as Error).message }; }
    },

    async uploadImage(file: File) {
      busy.value = true; error.value = "";
      try {
        const result = await api.upload(file);
        setDoc(result.doc, result.projectId);
        undoStack.length = 0; redoStack.length = 0; syncDepths();
      } catch (err) { error.value = (err as Error).message; }
      finally { busy.value = false; }
    },

    async load(id: string) {
      busy.value = true; error.value = "";
      try {
        const result = await api.getProject(id);
        setDoc(result.doc, result.projectId);
        undoStack.length = 0; redoStack.length = 0; syncDepths();
      } catch (err) { error.value = (err as Error).message; }
      finally { busy.value = false; }
    },

    async analyze() {
      if (busy.value || !projectId.value) return;
      busy.value = true; error.value = "";
      try {
        // 先把待落盘的微调冲掉——服务端的分析流程从磁盘读文档，冲掉之前
        // 分析完成后可能反而把用户刚做的微调覆盖回旧值。
        await persistNow();
        pushUndo();
        setDoc((await api.analyze(projectId.value)).doc);
      } catch (err) { error.value = (err as Error).message; dropLastUndo(); }
      finally { busy.value = false; }
    },

    select(id: string, additive: boolean) {
      if (!additive) { selectedIds.value = [id]; return; }
      selectedIds.value = selectedIds.value.includes(id)
        ? selectedIds.value.filter(item => item !== id)
        : [...selectedIds.value, id];
    },

    clearSelection() { selectedIds.value = []; mode.value = "idle"; },

    nudge(delta: number) {
      if (busy.value) return;
      const index = selectedIndex.value;
      if (index < 0 || !canAdjustBoundary(regions.value, index)) return;
      const now = Date.now();
      if (now - lastNudgeAt >= COALESCE_MS) pushUndo();
      lastNudgeAt = now;
      regions.value = adjustBoundary(regions.value, index, delta);
      schedulePersist();
    },

    beginSplit() { if (!busy.value && selectedIndex.value >= 0) mode.value = "split"; },
    cancelSplit() { mode.value = "idle"; },

    async commitSplit(y: number) {
      if (busy.value) return;
      const index = selectedIndex.value;
      if (index < 0 || !canSplitAt(regions.value, index, y)) return;
      pushUndo();
      const next = splitRegion(regions.value, index, y);
      regions.value = next;
      mode.value = "idle";
      const upperId = next[index]!.id;
      const lowerId = next[index + 1]!.id;
      selectedIds.value = [lowerId];
      await persistNow();
      // 拆分产生的两个新块结构变了、原名不再准确——自动把裁图丢给模型重新
      // 命名，不追加撤销步（上面 pushUndo() 已经压过这一次结构变化了）。
      await autoRenameStructuralResult([upperId, lowerId]);
    },

    async merge() {
      if (busy.value) return;
      if (!areAdjacent(regions.value, selectedIds.value)) return;
      pushUndo();
      const next = mergeRegions(regions.value, selectedIds.value);
      regions.value = next;
      const survivorIds = new Set(next.map(region => region.id));
      selectedIds.value = selectedIds.value.filter(id => survivorIds.has(id)).slice(0, 1);
      const mergedId = selectedIds.value[0];
      await persistNow();
      if (mergedId) await autoRenameStructuralResult([mergedId]);
    },

    rename(id: string, displayName: string) {
      if (busy.value) return;
      const current = regions.value.find(region => region.id === id);
      if (!current || current.displayName === displayName) return;
      pushUndo();
      regions.value = renameRegion(regions.value, id, displayName);
      void persistNow();
    },

    async aiRename(id: string) {
      if (busy.value || !projectId.value) return;
      // 先冲掉待落盘的微调——服务端按 id 从磁盘读文档改名再写回，冲掉之前调用
      // 会让服务端读到旧文档，把刚做的微调静默吞掉。
      await persistNow();
      pendingRenameIds.value = [...pendingRenameIds.value, id];
      pushUndo();
      try {
        await applyAiRename(id);
      } catch (err) { error.value = (err as Error).message; dropLastUndo(); }
      finally { pendingRenameIds.value = pendingRenameIds.value.filter(item => item !== id); }
    },

    undo() {
      const previous = undoStack.pop();
      if (!previous) return;
      redoStack.push(snapshot());
      syncDepths();
      regions.value = previous;
      lastNudgeAt = 0;
      void persistNow();
    },

    redo() {
      const next = redoStack.pop();
      if (!next) return;
      undoStack.push(snapshot());
      syncDepths();
      regions.value = next;
      lastNudgeAt = 0;
      void persistNow();
    },

    flushPersist: persistNow,
  };
}

export type Store = ReturnType<typeof createStore>;
