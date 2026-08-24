<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import PipelineCanvas from "./canvas/PipelineCanvas.vue";
import RegionsNode, { type RegionNodeError } from "./canvas/nodes/RegionsNode.vue";
import BusyOverlay from "./components/BusyOverlay.vue";
import ErrorDialog from "./components/ErrorDialog.vue";
import PageOutline from "./components/PageOutline.vue";
import UploadPanel from "./components/UploadPanel.vue";
import { getPageArchive, httpApi, type AnalysisStats } from "./api.js";
import { createPageOutlineState } from "./page-outline-state.js";
import { createStore } from "./state.js";

const store = createStore(httpApi);
const pageOutline = createPageOutlineState(httpApi);
const hoveredId = ref<string | null>(null);
const outlineStats = ref<AnalysisStats | null>(null);
const exportingPage = ref(false);
const uploadingAndAnalyzing = ref(false);
const regionsNode = ref<InstanceType<typeof RegionsNode> | null>(null);
const pipelineCanvas = ref<{
  openPageCompare(): void;
  refreshConnections(): void;
} | null>(null);
const dialogError = ref<RegionNodeError | null>(null);
const parsedRegionKeys = ref<string[]>([]);
const showPanels = ref(true);
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

function getRegionAnchor(id: string) {
  return regionsNode.value?.getRegionAnchor(id) ?? null;
}
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
  if (!store.modelConfig.value?.configured) return;
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

function syncHash(projectId: string) { window.location.hash = `project=${projectId}`; }
function isEditingTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return element?.tagName === "INPUT" || element?.tagName === "TEXTAREA" || element?.isContentEditable;
}
async function retryAnalysis() {
  dialogError.value = null;
  await regionsNode.value?.retryAnalysis();
}

function onKeydown(event: KeyboardEvent) {
  if (dialogError.value) {
    if (event.key === "Escape") dialogError.value = null;
    return;
  }
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
      :configured="Boolean(store.modelConfig.value?.configured)"
      :config-path="store.modelConfig.value?.configPath"
      @upload="uploadAndAnalyze"
      @refresh-model-config="store.loadModelConfig"
    />
    <template v-else>
      <div class="brand">
        <span class="brand-mark">RS</span>
        <div><strong>Region Split</strong><small>视觉区域拆分工作台</small></div>
      </div>
      <PipelineCanvas
        ref="pipelineCanvas"
      :regions="store.regions.value"
      :project-id="store.projectId.value"
      :get-region-anchor="getRegionAnchor"
      :page-api="httpApi"
      :image-size="{ w: store.doc.value?.image.width ?? 1, h: store.doc.value?.image.height ?? 1 }"
    >
      <RegionsNode
        ref="regionsNode"
        :store="store"
        :hovered-id="hoveredId"
        :show-panels="showPanels"
        :parsed-region-keys="parsedRegionKeys"
        @hover="hoveredId = $event"
        @open-page-compare="pipelineCanvas?.openPageCompare()"
        @layout-change="pipelineCanvas?.refreshConnections()"
        @uploaded="store.projectId.value && (syncHash(store.projectId.value), refreshParsedRegions())"
        @error="dialogError = $event"
        />
      </PipelineCanvas>
    </template>
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
      @open-page-compare="pipelineCanvas?.openPageCompare()"
      @refresh-model-config="store.loadModelConfig"
      @patch="(id, patch) => pageOutline.patch(store.projectId.value, id, patch)"
    />
    <BusyOverlay v-if="store.busy.value && !analyzing" :label="store.busyLabel.value" />
    <ErrorDialog
      v-if="dialogError"
      :title="dialogError.title"
      :message="dialogError.message"
      :config-path="dialogError.configPath"
      :retryable="dialogError.retryable"
      @close="dialogError = null"
      @retry="retryAnalysis"
    />
  </main>
</template>

<style scoped>
.app-shell { position: relative; width: 100%; height: 100%; overflow: hidden; }
.app-shell > .page-outline { position: absolute; z-index: 20; inset: 0; }
.brand { position: absolute; z-index: 30; left: 16px; top: 14px; display: flex; align-items: center; gap: 9px; padding: 7px 10px; border: 1px solid var(--border); border-radius: 8px; background: #24272eee; box-shadow: 0 8px 20px #0007; pointer-events: none; }
.brand-mark { width: 29px; height: 29px; display: grid; place-items: center; border-radius: 7px; color: white; background: var(--accent); font-size: 10px; font-weight: 800; }.brand strong,.brand small { display: block; }.brand strong { font-size: 12px; }.brand small { margin-top: 2px; color: var(--text-faint); font-size: 9px; }
</style>
