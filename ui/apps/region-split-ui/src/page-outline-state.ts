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
  const progressText = computed(() => {
    if (!progress.value) return busy.value ? "正在准备全页解析…" : "";
    const done = progress.value.completed + progress.value.skipped;
    return `已完成 ${done}/${progress.value.total}${progress.value.failed ? `，失败 ${progress.value.failed}` : ""}`;
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
        const nextProgress = await api.detectAllElements(projectId, retry);
        const nextOutline = await api.getPageOutline(projectId);
        if (currentGeneration === generation) {
          progress.value = nextProgress;
          outline.value = nextOutline;
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

  async function patch(projectId: string, elementId: string, nextPatch: PageElementPatch) {
    error.value = "";
    const previous = outline.value;
    if (previous) {
      outline.value = {
        ...previous,
        elements: previous.elements.map(element => element.id === elementId ? { ...element, ...nextPatch } : element),
      };
    }
    try {
      outline.value = await api.patchPageElement(projectId, elementId, nextPatch);
    } catch (reason) {
      outline.value = previous;
      error.value = (reason as Error).message;
      throw reason;
    }
  }

  return { outline, selectedId, hoveredId, busy, error, progress, progressText, load, analyzeAll, patch };
}
