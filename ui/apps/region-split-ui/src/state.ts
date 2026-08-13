import { computed, ref, shallowRef } from "vue";
import {
  adjustBoundary, areAdjacent, canAdjustBoundary, canSplitAt,
  addElement as addElementToDoc, applyRegionEdit, changeElementType as changeElementTypeInDoc,
  deleteElementTree, mergeRegions, moveElementTree, renameElement as renameElementInDoc,
  renameRegion, reparentElement as reparentElementInDoc, resizeElement as resizeElementInDoc, splitRegion,
  type ElementNode, type ElementType, type ModelConfigView, type Rect, type Region, type RegionSplitDoc,
} from "@region-split/core/browser";
import { ApiError, type StoreApi } from "./api.js";

export type { StoreApi };
export type RegionExpandDirection = "up" | "down";

const UNDO_STACK_LIMIT = 50;
const COALESCE_MS = 500;
const PERSIST_DEBOUNCE_MS = 400;

export function createStore(api: StoreApi) {
  const projectId = ref("");
  const doc = shallowRef<RegionSplitDoc | null>(null);
  const regions = shallowRef<Region[]>([]);
  const elements = shallowRef<ElementNode[]>([]);
  const selectedIds = ref<string[]>([]);
  const selectedElementId = ref<string | null>(null);
  const hoveredElementId = ref<string | null>(null);
  const mode = ref<"idle" | "split">("idle");
  const canvasMode = ref<"select" | "split-region" | "add-element">("select");
  // busyLabel 是单一来源，busy 作为可写 computed 保留旧的布尔用法：
  // 组件里的 `:disabled="busy"` 和守卫里的 `if (busy.value) return` 都不用改，
  // 而遮罩层可以拿到"上传中"还是"AI 分析中"这样的具体文案。
  const busyLabel = ref("");
  const busy = computed({
    get: () => busyLabel.value !== "",
    set: (value: boolean) => { busyLabel.value = value ? "处理中…" : ""; },
  });
  const error = ref("");
  const saveConflict = ref<RegionSplitDoc | null>(null);
  let persistInFlight: Promise<void> | null = null;
  let localEditVersion = 0;
  const pendingRenameIds = ref<string[]>([]);
  const renamingId = ref<string | null>(null);
  const modelConfig = ref<ModelConfigView | null>(null);

  // 栈本身用普通数组（快照不需要响应式），深度单独用 ref 暴露，
  // 否则 canUndo/canRedo 这类 computed 没有响应式依赖，首次求值后就再也不会失效。
  interface EditSnapshot {
    regions: Region[]; elements: ElementNode[]; elementAnalysis: RegionSplitDoc["elementAnalysis"];
    selectedIds: string[]; selectedElementId: string | null;
  }
  const undoStack: EditSnapshot[] = [];
  const redoStack: EditSnapshot[] = [];
  const undoDepth = ref(0);
  const redoDepth = ref(0);
  let lastNudgeAt = 0;
  let lastNudgeBoundary = -1;
  let boundaryGestureActive = false;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  function syncDepths() {
    undoDepth.value = undoStack.length;
    redoDepth.value = redoStack.length;
  }

  function snapshot(): EditSnapshot {
    return {
      regions: regions.value.map(region => ({ ...region, bounds: { ...region.bounds } })),
      elements: elements.value.map(element => ({ ...element, bounds: { ...element.bounds } })),
      elementAnalysis: structuredClone(doc.value?.elementAnalysis ?? {}),
      selectedIds: [...selectedIds.value], selectedElementId: selectedElementId.value,
    };
  }
  function restore(edit: EditSnapshot) {
    localEditVersion += 1;
    regions.value = edit.regions; elements.value = edit.elements; selectedIds.value = edit.selectedIds;
    selectedElementId.value = edit.selectedElementId;
    if (doc.value) doc.value = { ...doc.value, regions: edit.regions, elements: edit.elements, elementAnalysis: edit.elementAnalysis };
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
  // 有文档但从没跑过模型分析——此时 regions 是候选切分线直接切出来的，
  // 名字是"区域 1..N"、类型全是 other，看起来和分析结果一模一样。
  // 界面必须把这个状态说清楚，否则用户会把原始信号当成 AI 的输出。
  const needsAnalysis = computed(() => Boolean(doc.value) && !doc.value?.analyzedAt);

  function boundaryMoveForRegion(id: string, direction: RegionExpandDirection) {
    const regionIndex = regions.value.findIndex(region => region.id === id);
    if (regionIndex < 0) return null;
    return direction === "up"
      ? { boundaryIndex: regionIndex - 1, delta: -1 }
      : { boundaryIndex: regionIndex, delta: 1 };
  }

  function canExpandRegion(id: string, direction: RegionExpandDirection): boolean {
    if (busy.value || needsAnalysis.value || mode.value === "split") return false;
    const move = boundaryMoveForRegion(id, direction);
    if (!move || !canAdjustBoundary(regions.value, move.boundaryIndex)) return false;
    return adjustBoundary(regions.value, move.boundaryIndex, move.delta) !== regions.value;
  }

  function pushUndo() {
    localEditVersion += 1;
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
    if (!projectId.value || saveConflict.value) return;
    const run = async () => {
      try {
        const current = doc.value;
        if (!current) return;
        const submittedRegions = regions.value;
        const submittedElements = elements.value;
        const result = await api.putDocument(projectId.value, {
          expectedRevision: current.revision, regions: submittedRegions, elements: submittedElements,
          elementAnalysis: current.elementAnalysis,
        });
        doc.value = { ...result.doc, regions: regions.value, elements: elements.value };
        if (regions.value === submittedRegions && elements.value === submittedElements) {
          regions.value = result.doc.regions; elements.value = result.doc.elements;
        } else schedulePersist();
      } catch (err) {
        error.value = (err as Error).message;
        if (err instanceof ApiError && err.status === 409 && err.latestDoc) saveConflict.value = err.latestDoc;
      }
    };
    if (persistInFlight) await persistInFlight;
    persistInFlight = run();
    try { await persistInFlight; } finally { persistInFlight = null; }
  }

  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => { persistTimer = null; void persistNow(); }, PERSIST_DEBOUNCE_MS);
  }

  function setDoc(next: RegionSplitDoc, id?: string) {
    doc.value = next;
    regions.value = next.regions;
    elements.value = next.elements;
    if (id) projectId.value = id;
    selectedIds.value = [];
    selectedElementId.value = null;
    hoveredElementId.value = null;
    mode.value = "idle";
  }

  // 单次 AI 命名调用的裸操作：只管请求 + 应用结果，不管撤销栈也不管
  // pendingRenameIds——这两件事在"手动重命名"和"拆分/合并后自动重命名"里
  // 语义不同（前者压一步撤销、失败要报错；后者复用调用方已压的那一步、
  // 失败要静默保留占位名），由各自的调用方处理。
  async function applyAiRename(id: string): Promise<void> {
    const revision = doc.value?.revision ?? 0;
    const editVersion = localEditVersion;
    const result = await api.renameAi(projectId.value, id, revision);
    if ((doc.value?.revision ?? 0) !== revision || localEditVersion !== editVersion) return;
    doc.value = result.doc;
    regions.value = result.doc.regions;
    elements.value = result.doc.elements;
  }

  // 拆分/合并后的自动重命名：模型未配置时直接跳过（不发请求也不报错，新块保持
  // 占位名）。失败或超时也只是静默保留占位名——这是锦上添花的自动动作，不是
  // 用户主动发起的操作，不该弹红字错误；人工仍可通过 [AI 重命名] 按钮重试。
  // 所有目标 id 一次性标记为"命名中…"（哪怕请求是顺序发出的），符合规格里
  // "新区域都显示命名中占位"的要求；顺序发请求是为了不让两个并发请求同时
  // 读写服务端同一份磁盘文档，产生互相覆盖的竞态。
  async function autoRenameStructuralResult(ids: string[]): Promise<void> {
    if (!projectId.value || !isModelConfigured.value || ids.length === 0) return;
    await persistNow();
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
    projectId, doc, regions, elements, selectedIds, selectedElementId, hoveredElementId,
    mode, canvasMode, busy, busyLabel, error, saveConflict, pendingRenameIds, renamingId, modelConfig,
    selectedIndex, selectedRegion, canNudge, canMerge, canUndo, canRedo,
    isModelConfigured, candidateLines, needsAnalysis, canExpandRegion,

    selectElement(id: string | null) { selectedElementId.value = id; if (id) selectedIds.value = []; },
    hoverElement(id: string | null) { hoveredElementId.value = id; },
    setCanvasMode(next: "select" | "split-region" | "add-element") { canvasMode.value = next; mode.value = next === "split-region" ? "split" : "idle"; },
    addElement(element: ElementNode) { if (!doc.value) return; pushUndo(); doc.value = addElementToDoc({ ...doc.value, regions: regions.value, elements: elements.value }, element); elements.value = doc.value.elements; schedulePersist(); },
    moveElement(id: string, dx: number, dy: number) { if (!doc.value) return; localEditVersion += 1; doc.value = moveElementTree({ ...doc.value, regions: regions.value, elements: elements.value }, id, dx, dy); elements.value = doc.value.elements; },
    resizeElement(id: string, bounds: Rect) { if (!doc.value) return; if (!boundaryGestureActive) pushUndo(); else localEditVersion += 1; doc.value = resizeElementInDoc({ ...doc.value, regions: regions.value, elements: elements.value }, id, bounds); elements.value = doc.value.elements; if (!boundaryGestureActive) schedulePersist(); },
    deleteElement(id: string) { if (!doc.value) return; pushUndo(); doc.value = deleteElementTree({ ...doc.value, regions: regions.value, elements: elements.value }, id); elements.value = doc.value.elements; if (selectedElementId.value === id) selectedElementId.value = null; schedulePersist(); },
    renameElement(id: string, name: string) { if (!doc.value) return; pushUndo(); doc.value = renameElementInDoc({ ...doc.value, regions: regions.value, elements: elements.value }, id, name); elements.value = doc.value.elements; schedulePersist(); },
    changeElementType(id: string, type: ElementType) { if (!doc.value) return; pushUndo(); doc.value = changeElementTypeInDoc({ ...doc.value, regions: regions.value, elements: elements.value }, id, type); elements.value = doc.value.elements; schedulePersist(); },
    reparentElement(id: string, parentId: string | null) { if (!doc.value) return; pushUndo(); doc.value = reparentElementInDoc({ ...doc.value, regions: regions.value, elements: elements.value }, id, parentId); elements.value = doc.value.elements; schedulePersist(); },
    beginElementGesture() { if (!boundaryGestureActive) pushUndo(); boundaryGestureActive = true; if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; } },
    endElementGesture() { if (!boundaryGestureActive) return; boundaryGestureActive = false; schedulePersist(); },
    async retryElementAnalysis(regionId: string) {
      const current = doc.value; const state = current?.elementAnalysis[regionId];
      if (!current || !projectId.value || !state?.inputFingerprint || saveConflict.value) return;
      await persistNow();
      if (saveConflict.value) return;
      const result = await api.retryElementAnalysis(projectId.value, regionId, doc.value!.revision, state.inputFingerprint);
      setDoc(result.doc);
    },
    loadServerVersion() { if (saveConflict.value) { setDoc(saveConflict.value); saveConflict.value = null; error.value = ""; } },

    startRename(id: string) { renamingId.value = id; },
    stopRename() { renamingId.value = null; },

    async loadModelConfig() {
      try { modelConfig.value = await api.getModelConfig(); }
      catch (err) { error.value = (err as Error).message; }
    },

    async uploadImage(file: File) {
      busyLabel.value = "上传并预处理中…"; error.value = "";
      try {
        const result = await api.upload(file);
        setDoc(result.doc, result.projectId);
        undoStack.length = 0; redoStack.length = 0; syncDepths();
      } catch (err) { error.value = (err as Error).message; }
      finally { busyLabel.value = ""; }
    },

    async load(id: string) {
      busyLabel.value = "载入中…"; error.value = "";
      try {
        const result = await api.getProject(id);
        setDoc(result.doc, result.projectId);
        undoStack.length = 0; redoStack.length = 0; syncDepths();
      } catch (err) { error.value = (err as Error).message; }
      finally { busyLabel.value = ""; }
    },

    async analyze() {
      if (busy.value || !projectId.value) return;
      busyLabel.value = "AI 分析中…"; error.value = "";
      try {
        // 先把待落盘的微调冲掉——服务端的分析流程从磁盘读文档，冲掉之前
        // 分析完成后可能反而把用户刚做的微调覆盖回旧值。
        await persistNow();
        pushUndo();
        setDoc((await api.analyze(projectId.value, doc.value?.revision ?? 0)).doc);
      } catch (err) { error.value = (err as Error).message; dropLastUndo(); }
      finally { busyLabel.value = ""; }
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
      const next = adjustBoundary(regions.value, index, delta);
      if (next === regions.value) return;
      const now = Date.now();
      if (index !== lastNudgeBoundary || now - lastNudgeAt >= COALESCE_MS) pushUndo();
      lastNudgeAt = now;
      lastNudgeBoundary = index;
      localEditVersion += 1;
      if (doc.value) { doc.value = applyRegionEdit({ ...doc.value, regions: regions.value, elements: elements.value }, () => next, "boundary"); regions.value = doc.value.regions; elements.value = doc.value.elements; }
      else regions.value = next;
      schedulePersist();
    },

    expandRegion(id: string, direction: RegionExpandDirection) {
      if (!canExpandRegion(id, direction)) return;
      const move = boundaryMoveForRegion(id, direction)!;
      const next = adjustBoundary(regions.value, move.boundaryIndex, move.delta);
      if (next === regions.value) return;
      selectedIds.value = [id];
      const now = Date.now();
      if (move.boundaryIndex !== lastNudgeBoundary || now - lastNudgeAt >= COALESCE_MS) pushUndo();
      lastNudgeAt = now;
      lastNudgeBoundary = move.boundaryIndex;
      localEditVersion += 1;
      if (doc.value) { doc.value = applyRegionEdit({ ...doc.value, regions: regions.value, elements: elements.value }, () => next, "boundary"); regions.value = doc.value.regions; elements.value = doc.value.elements; }
      else regions.value = next;
      if (!boundaryGestureActive) schedulePersist();
    },

    beginBoundaryGesture() {
      boundaryGestureActive = true;
      if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    },

    endBoundaryGesture() {
      if (!boundaryGestureActive) return;
      boundaryGestureActive = false;
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
      if (doc.value) { doc.value = applyRegionEdit({ ...doc.value, regions: regions.value, elements: elements.value }, () => next, "split"); regions.value = doc.value.regions; elements.value = doc.value.elements; }
      else regions.value = next;
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
      if (doc.value) { doc.value = applyRegionEdit({ ...doc.value, regions: regions.value, elements: elements.value }, () => next, "merge"); regions.value = doc.value.regions; elements.value = doc.value.elements; }
      else regions.value = next;
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
      const next = renameRegion(regions.value, id, displayName);
      if (doc.value) { doc.value = applyRegionEdit({ ...doc.value, regions: regions.value, elements: elements.value }, () => next, "metadata"); regions.value = doc.value.regions; elements.value = doc.value.elements; }
      else regions.value = next;
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
      restore(previous);
      lastNudgeAt = 0;
      void persistNow();
    },

    redo() {
      const next = redoStack.pop();
      if (!next) return;
      undoStack.push(snapshot());
      syncDepths();
      restore(next);
      lastNudgeAt = 0;
      void persistNow();
    },

    flushPersist: persistNow,
  };
}

export type Store = ReturnType<typeof createStore>;
