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
      const fresh = await api.getProject(projectId.value);
      doc.value = fresh.doc;
      regions.value = fresh.doc.regions;
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
      if (!projectId.value) return;
      busy.value = true; error.value = "";
      pushUndo();
      try {
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
      const index = selectedIndex.value;
      if (index < 0 || !canAdjustBoundary(regions.value, index)) return;
      const now = Date.now();
      if (now - lastNudgeAt >= COALESCE_MS) pushUndo();
      lastNudgeAt = now;
      regions.value = adjustBoundary(regions.value, index, delta);
      schedulePersist();
    },

    beginSplit() { if (selectedIndex.value >= 0) mode.value = "split"; },
    cancelSplit() { mode.value = "idle"; },

    commitSplit(y: number) {
      const index = selectedIndex.value;
      if (index < 0 || !canSplitAt(regions.value, index, y)) return;
      pushUndo();
      const next = splitRegion(regions.value, index, y);
      regions.value = next;
      mode.value = "idle";
      const lower = next[index + 1]!;
      selectedIds.value = [lower.id];
      void persistNow();
    },

    merge() {
      if (!areAdjacent(regions.value, selectedIds.value)) return;
      pushUndo();
      const next = mergeRegions(regions.value, selectedIds.value);
      regions.value = next;
      const survivorIds = new Set(next.map(region => region.id));
      selectedIds.value = selectedIds.value.filter(id => survivorIds.has(id)).slice(0, 1);
      void persistNow();
    },

    rename(id: string, displayName: string) {
      pushUndo();
      regions.value = renameRegion(regions.value, id, displayName);
      void persistNow();
    },

    async aiRename(id: string) {
      if (!projectId.value) return;
      pendingRenameIds.value = [...pendingRenameIds.value, id];
      pushUndo();
      try {
        const result = await api.renameAi(projectId.value, id);
        doc.value = result.doc;
        regions.value = result.doc.regions;
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
