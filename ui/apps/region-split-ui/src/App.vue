<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import PipelineCanvas from "./canvas/PipelineCanvas.vue";
import RegionsNode, { type RegionNodeError } from "./canvas/nodes/RegionsNode.vue";
import BusyOverlay from "./components/BusyOverlay.vue";
import ErrorDialog from "./components/ErrorDialog.vue";
import { httpApi } from "./api.js";
import { createStore } from "./state.js";

const store = createStore(httpApi);
const hoveredId = ref<string | null>(null);
const regionsNode = ref<InstanceType<typeof RegionsNode> | null>(null);
const dialogError = ref<RegionNodeError | null>(null);
const showCandidateLines = ref(true);
const showPanels = ref(true);
const hasImage = computed(() => store.doc.value?.image !== undefined);
const analyzed = computed(() => Boolean(store.doc.value?.analyzedAt));
const workspaceStatus = computed(() => analyzed.value ? "done" : hasImage.value ? "active" : "idle");
const analyzing = computed(() => store.busy.value && store.busyLabel.value === "AI 分析中…");

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
    <div class="brand">
      <span class="brand-mark">RS</span>
      <div><strong>Region Split</strong><small>视觉区域拆分工作台</small></div>
    </div>
    <PipelineCanvas :status="workspaceStatus">
      <template #status>{{ analyzed ? `${store.regions.value.length} 个区域` : hasImage ? "自动分析中" : "等待上传" }}</template>
      <RegionsNode
        ref="regionsNode"
        :store="store"
        :hovered-id="hoveredId"
        :show-candidate-lines="showCandidateLines"
        :show-panels="showPanels"
        @hover="hoveredId = $event"
        @uploaded="store.projectId.value && syncHash(store.projectId.value)"
        @error="dialogError = $event"
      />
    </PipelineCanvas>
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
.brand { position: absolute; z-index: 30; left: 16px; top: 14px; display: flex; align-items: center; gap: 9px; padding: 7px 10px; border: 1px solid var(--border); border-radius: 8px; background: #24272eee; box-shadow: 0 8px 20px #0007; pointer-events: none; }
.brand-mark { width: 29px; height: 29px; display: grid; place-items: center; border-radius: 7px; color: white; background: var(--accent); font-size: 10px; font-weight: 800; }.brand strong,.brand small { display: block; }.brand strong { font-size: 12px; }.brand small { margin-top: 2px; color: var(--text-faint); font-size: 9px; }
</style>
