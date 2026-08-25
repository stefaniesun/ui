import type { PageElementPatch, PageOutline } from "@region-split/core/browser";
import { computed, ref, type ComputedRef, type Ref } from "vue";
import type { DetectAllResult, StoreApi } from "./api";

export interface PageOutlineState {
  outline: Ref<PageOutline | null>;
  selectedId: Ref<string | null>;
  hoveredId: Ref<string | null>;
  busy: Ref<boolean>;
  error: Ref<string>;
  progress: Ref<DetectAllResult | null>;
  progressText: ComputedRef<string>;
  load(projectId: string): Promise<void>;
  analyzeAll(projectId: string, retry?: boolean): Promise<void>;
  patch(projectId: string, elementId: string, patch: PageElementPatch): Promise<void>;
}

export function createPageOutlineState(api: StoreApi): PageOutlineState {
  const outline = ref<PageOutline | null>(null);
  const selectedId = ref<string | null>(null);
  const hoveredId = ref<string | null>(null);
  const busy = ref(false);
  const error = ref("");
  const progress = ref<DetectAllResult | null>(null);
  let generation = 0;
  let activeRun: Promise<void> | null = null;
  let activeProjectId = "";
  let patchQueue: Promise<void> = Promise.resolve();
  const progressText = computed(() => {
    if (!progress.value) return busy.value ? "正在准备全页解析…" : "";
    const done = progress.value.completed + progress.value.skipped;
    const failed = progress.value.failed ? `，失败 ${progress.value.failed}` : "";
    // 跑完之后不再说"已完成 N/N"——那句话在结束后没有信息量，且容易和"还在跑"混淆
    return busy.value
      ? `正在解析 ${done}/${progress.value.total}${failed}`
      : `已解析 ${done}/${progress.value.total}${failed}`;
  });

  async function load(projectId: string) {
    const currentGeneration = ++generation;
    const next = await api.getPageOutline(projectId);
    if (currentGeneration === generation) outline.value = next;
  }

  async function analyzeAll(projectId: string, retry = false) {
    if (activeRun && activeProjectId === projectId) return activeRun;
    const currentGeneration = ++generation;
    activeProjectId = projectId;
    activeRun = (async () => {
      busy.value = true;
      error.value = "";
      try {
        const initialOutline = await api.getPageOutline(projectId);
        if (currentGeneration === generation) outline.value = initialOutline;

        // 逐区域跑，每完成一个就刷新轮廓——整轮要一分多钟（实测单区域约 7 秒），
        // 一个请求跑完只能在结束时报进度，那段时间界面一动不动，看起来像卡死。
        // 逐区域跑的进度是"框一块块长出来"，比进度条更直观。
        const pending = initialOutline.regions.filter(region =>
          retry ? region.status !== "parsed" : region.status === "missing");
        const done = initialOutline.regions.length - pending.length;
        const failedRegionKeys: string[] = [];
        let completed = 0;
        const report = () => {
          if (currentGeneration !== generation) return;
          progress.value = {
            total: initialOutline.regions.length,
            completed,
            skipped: done,
            failed: failedRegionKeys.length,
            failedRegionKeys: [...failedRegionKeys],
          };
        };
        report();

        for (const region of pending) {
          if (currentGeneration !== generation) return;
          try {
            await api.detectElements(projectId, region.bounds);
            completed += 1;
          } catch {
            // 单个区域失败不该中断整轮：其余照常跑完，失败的那块在界面上标出来重跑
            failedRegionKeys.push(region.regionKey);
          }
          report();
          const nextOutline = await api.getPageOutline(projectId);
          if (currentGeneration === generation) outline.value = nextOutline;
        }
      } catch (reason) {
        if (currentGeneration === generation) error.value = (reason as Error).message;
      } finally {
        if (currentGeneration === generation) busy.value = false;
        activeRun = null;
        activeProjectId = "";
      }
    })();
    return activeRun;
  }

  function patch(projectId: string, elementId: string, nextPatch: PageElementPatch) {
    const operation = patchQueue.then(async () => {
      error.value = "";
      const previous = outline.value;
      if (previous) {
        outline.value = {
          ...previous,
          elements: previous.elements.map(element => {
            if (element.id !== elementId) return element;
            const { borderRadius, ...elementPatch } = nextPatch;
            return {
              ...element,
              ...elementPatch,
              style: borderRadius === undefined
                ? element.style
                : { ...element.style, borderRadius },
            };
          }),
        };
      }
      try {
        outline.value = await api.patchPageElement(projectId, elementId, nextPatch);
      } catch (reason) {
        outline.value = previous;
        error.value = (reason as Error).message;
        throw reason;
      }
    });
    patchQueue = operation.catch(() => undefined);
    return operation;
  }

  return { outline, selectedId, hoveredId, busy, error, progress, progressText, load, analyzeAll, patch };
}
