<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import PipelineCanvas from "./canvas/PipelineCanvas.vue";
import AnalyzeNode from "./canvas/nodes/AnalyzeNode.vue";
import RegionsNode from "./canvas/nodes/RegionsNode.vue";
import SourceNode from "./canvas/nodes/SourceNode.vue";
import SurfaceNode from "./canvas/nodes/SurfaceNode.vue";
import BusyOverlay from "./components/BusyOverlay.vue";
import { httpApi } from "./api.js";
import { createStore } from "./state.js";

const store = createStore(httpApi);
const hoveredId = ref<string | null>(null);
const showCandidateLines = ref(true);
const showPanels = ref(true);
const hasImage = computed(() => store.doc.value?.image !== undefined);
const analyzed = computed(() => Boolean(store.doc.value?.analyzedAt));
const hasRegions = computed(() => store.regions.value.length > 0);

function syncHash(projectId: string) { window.location.hash = `project=${projectId}`; }
function isEditingTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return element?.tagName === "INPUT" || element?.tagName === "TEXTAREA" || element?.isContentEditable;
}
function onKeydown(event: KeyboardEvent) {
  if (store.busy.value || isEditingTarget(event.target)) return;
  const mod = event.ctrlKey || event.metaKey;
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
    <PipelineCanvas
      :source-status="hasImage ? 'done' : 'active'"
      :surface-status="hasImage ? 'done' : 'idle'"
      :analyze-status="analyzed ? 'done' : hasImage ? 'active' : 'idle'"
      :regions-status="hasRegions ? 'active' : 'idle'"
      :edge-active="{ 'source-surface': hasImage, 'surface-analyze': hasImage, 'analyze-regions': hasRegions }"
    >
      <template #source-status>{{ hasImage ? "已载入" : "等待输入" }}</template>
      <template #surface-status>{{ store.candidateLines.value.length }} 条线索</template>
      <template #analyze-status>{{ analyzed ? "已完成" : "待处理" }}</template>
      <template #regions-status>{{ store.regions.value.length }} 个区域</template>
      <template #source><SourceNode :store="store" @uploaded="syncHash" /></template>
      <template #surface>
        <SurfaceNode
          v-model:show-candidate-lines="showCandidateLines"
          v-model:show-panels="showPanels"
          :store="store"
        />
      </template>
      <template #analyze><AnalyzeNode :store="store" /></template>
      <template #regions>
        <RegionsNode
          :store="store"
          :hovered-id="hoveredId"
          :show-candidate-lines="showCandidateLines"
          :show-panels="showPanels"
          @hover="hoveredId = $event"
        />
      </template>
    </PipelineCanvas>
    <BusyOverlay v-if="store.busy.value" :label="store.busyLabel.value" />
  </main>
</template>

<style scoped>
.app-shell { position: relative; width: 100%; height: 100%; overflow: hidden; }
.brand { position: absolute; z-index: 30; left: 16px; top: 14px; display: flex; align-items: center; gap: 9px; padding: 7px 10px; border: 1px solid var(--border); border-radius: 8px; background: #24272eee; box-shadow: 0 8px 20px #0007; pointer-events: none; }
.brand-mark { width: 29px; height: 29px; display: grid; place-items: center; border-radius: 7px; color: white; background: var(--accent); font-size: 10px; font-weight: 800; }.brand strong,.brand small { display: block; }.brand strong { font-size: 12px; }.brand small { margin-top: 2px; color: var(--text-faint); font-size: 9px; }
</style>
