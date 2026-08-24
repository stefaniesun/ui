<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import BusyOverlay from "./components/BusyOverlay.vue";
import ErrorDialog from "./components/ErrorDialog.vue";
import PageOutline from "./components/PageOutline.vue";
import PageCompare from "./components/PageCompare.vue";
import UploadPanel from "./components/UploadPanel.vue";
import { getPageArchive, httpApi, type AnalysisStats } from "./api.js";
import { createPageOutlineState } from "./page-outline-state.js";
import { createStore } from "./state.js";

const store = createStore(httpApi);
const pageOutline = createPageOutlineState(httpApi);
const outlineStats = ref<AnalysisStats | null>(null);
const exportingPage = ref(false);
const uploadingAndAnalyzing = ref(false);
const pageCompareOpen = ref(false);
const dialogError = ref<{ title: string; message: string; configPath?: string; retryable: boolean } | null>(null);
const parsedRegionKeys = ref<string[]>([]);
const hasImage = computed(() => store.doc.value?.image !== undefined);
const analyzed = computed(() => Boolean(store.doc.value?.analyzedAt));
const workspaceStatus = computed(() => analyzed.value ? "done" : hasImage.value ? "active" : "idle");
const analyzing = computed(() => store.busy.value && store.busyLabel.value === "AI 分析中…");

watch(() => [store.projectId.value, store.doc.value?.updatedAt] as const, async ([projectId]) => {
  await refreshParsedRegions();
  if (projectId && store.doc.value?.analyzedAt) {
    await pageOutline.analyzeAll(projectId);
    await refreshOutlineStats();
  } else outlineStats.value = null;
});

async function refreshParsedRegions() {
  const projectId = store.projectId.value;
  parsedRegionKeys.value = projectId ? (await httpApi.getParsedRegions(projectId)).regionKeys : [];
}
async function refreshOutlineStats() {
  if (!store.projectId.value || !store.doc.value?.analyzedAt) { outlineStats.value = null; return; }
  try { outlineStats.value = await httpApi.getAnalysisStats(store.projectId.value); }
  catch { outlineStats.value = null; }
}
function downloadArchive(projectId: string, archive: Blob) {
  const url = URL.createObjectURL(archive);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `region-page-${projectId}.zip`;
  anchor.click();
  URL.revokeObjectURL(url);
}
async function uploadAndAnalyze(file: File) {
  if (store.busy.value || uploadingAndAnalyzing.value) return;
  if (!store.modelConfig.value) await store.loadModelConfig();
  if (!(store.modelConfig.value?.baseUrl && store.modelConfig.value?.model && store.modelConfig.value?.hasApiKey)) return;
  uploadingAndAnalyzing.value = true;
  try {
    await store.uploadImage(file);
    if (!store.projectId.value || !store.doc.value?.image || store.error.value) {
      dialogError.value = { title: "图片上传失败", message: store.error.value || "图片上传或预处理失败，请重新选择图片。", retryable: false };
      return;
    }
    await store.analyze();
    if (store.error.value || !store.doc.value?.analyzedAt) {
      dialogError.value = { title: "AI 区域分析失败", message: store.error.value || "AI 区域分析失败，请检查模型配置后重试。", configPath: store.modelConfig.value?.configPath, retryable: false };
      return;
    }
    await refreshParsedRegions();
    await pageOutline.analyzeAll(store.projectId.value);
    await refreshOutlineStats();
  } finally { uploadingAndAnalyzing.value = false; }
}
async function exportPage() {
  const projectId = store.projectId.value;
  if (!projectId || exportingPage.value) return;
  exportingPage.value = true;
  try { downloadArchive(projectId, await getPageArchive(projectId)); }
  catch (error) { dialogError.value = { title: "整页代码导出失败", message: (error as Error).message, retryable: false }; }
  finally { exportingPage.value = false; }
}

function isEditingTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return element?.tagName === "INPUT" || element?.tagName === "TEXTAREA" || element?.isContentEditable;
}

function onKeydown(event: KeyboardEvent) {
  if (dialogError.value) {
    if (event.key === "Escape") dialogError.value = null;
    return;
  }
  if (pageCompareOpen.value && event.key === "Escape") { pageCompareOpen.value = false; return; }
  if (store.busy.value || isEditingTarget(event.target)) return;
  const mod = event.ctrlKey || event.metaKey;
  if (store.mode.value === "split" && event.key !== "Escape") return;
  if (mod && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) void store.redo(); else void store.undo();
  } else if (event.key === "Escape") {
    if (store.mode.value === "split") store.cancelSplit();
    else store.clearSelection();
  } else if (event.key === "ArrowUp" && store.selectedIds.value.length === 1) {
    event.preventDefault(); void store.nudge(-1);
  } else if (event.key === "ArrowDown" && store.selectedIds.value.length === 1) {
    event.preventDefault(); void store.nudge(1);
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  const match = window.location.hash.match(/project=([^&]+)/);
  void store.loadModelConfig();
  if (match?.[1]) void store.load(match[1]);
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <main class="app-shell">
    <UploadPanel
      v-if="!store.projectId.value"
      :busy="store.busy.value || uploadingAndAnalyzing"
      :configured="Boolean(store.modelConfig.value?.baseUrl && store.modelConfig.value?.model && store.modelConfig.value?.hasApiKey)"
      :config-path="store.modelConfig.value?.configPath"
      @upload="uploadAndAnalyze"
      @refresh-model-config="store.loadModelConfig"
    />
    <div v-else-if="!pageOutline.outline.value" class="analysis-loading" aria-live="polite">
      <strong>{{ store.busyLabel.value || pageOutline.progressText.value || "正在准备整页轮廓…" }}</strong>
      <span>区域分析完成后将直接进入整页三栏工作区</span>
    </div>
    <PageOutline
      v-if="pageOutline.outline.value && store.projectId.value"
      :project-id="store.projectId.value"
      :outline="pageOutline.outline.value"
      :selected-id="pageOutline.selectedId.value"
      :hovered-id="pageOutline.hoveredId.value"
      :busy="pageOutline.busy.value"
      :progress-text="pageOutline.progressText.value"
      :error="pageOutline.error.value"
      :font-stack="store.doc.value?.fontStack"
      :stats="outlineStats"
      :exporting="exportingPage"
      @select="pageOutline.selectedId.value = $event"
      @hover="pageOutline.hoveredId.value = $event"
      @retry="pageOutline.analyzeAll(store.projectId.value, true)"
      @font-stack="store.setFontStack"
      @export-page="exportPage"
      @open-page-compare="pageCompareOpen = true"
      @refresh-model-config="store.loadModelConfig"
      @patch="(id, patch) => pageOutline.patch(store.projectId.value, id, patch)"
    />
    <section v-if="pageCompareOpen && store.projectId.value" class="page-compare-dialog" role="dialog" aria-modal="true" aria-label="整页比对">
      <header><strong>整页比对</strong><button type="button" aria-label="关闭整页比对" @click="pageCompareOpen = false">×</button></header>
      <PageCompare
        :project-id="store.projectId.value" :api="httpApi"
        :image-size="{ w: store.doc.value?.image.width ?? 1, h: store.doc.value?.image.height ?? 1 }"
      />
    </section>
    <BusyOverlay v-if="store.busy.value && !analyzing" :label="store.busyLabel.value" />
    <ErrorDialog
      v-if="dialogError"
      :title="dialogError.title"
      :message="dialogError.message"
      :config-path="dialogError.configPath"
      :retryable="dialogError.retryable"
      @close="dialogError = null"
    />
  </main>
</template>

<style scoped>
.app-shell { position: relative; width: 100%; height: 100%; overflow: hidden; }
.app-shell > .page-outline { position: absolute; z-index: 20; inset: 0; }
.analysis-loading { height: 100%; display: grid; place-content: center; gap: 8px; color: #dbe7f5; text-align: center; background: #0c1119; }.analysis-loading span { color: #8d9bb0; font-size: 12px; }
.page-compare-dialog { position: absolute; z-index: 50; inset: 5%; display: flex; flex-direction: column; overflow: hidden; border: 1px solid #354155; border-radius: 10px; color: #e5e7eb; background: #121720; box-shadow: 0 20px 70px #000c; }.page-compare-dialog > header { min-height: 42px; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; border-bottom: 1px solid #2a3342; }.page-compare-dialog > header button { border: 0; color: #cbd5e1; background: transparent; font-size: 22px; cursor: pointer; }.page-compare-dialog :deep(.page-compare) { min-height: 0; flex: 1; overflow: auto; }
</style>
