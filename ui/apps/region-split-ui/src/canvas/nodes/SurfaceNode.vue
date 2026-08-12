<script setup lang="ts">
import type { Store } from "../../state.js";
import { imageUrl } from "../../api.js";

const props = defineProps<{
  store: Store;
  showCandidateLines: boolean;
  showPanels: boolean;
}>();
const emit = defineEmits<{
  "update:showCandidateLines": [value: boolean];
  "update:showPanels": [value: boolean];
}>();
</script>

<template>
  <div v-if="props.store.doc.value?.image" class="surface-node">
    <div class="preview">
      <img :src="imageUrl(props.store.projectId.value)" :alt="props.store.doc.value!.image.fileName" />
      <div v-if="props.showPanels" class="panel-tint" />
      <span
        v-for="line in props.showCandidateLines ? props.store.candidateLines.value : []"
        :key="line.y"
        class="candidate-line"
        :style="{ top: `${line.y / props.store.doc.value!.image.height * 100}%`, opacity: Math.max(.32, line.strength) }"
      />
    </div>
    <div class="surface-stats">
      <div><strong>{{ props.store.candidateLines.value.length }}</strong><span>候选分隔线</span></div>
      <div><strong>{{ props.store.regions.value.length }}</strong><span>表面区块</span></div>
    </div>
    <div class="layer-list">
      <label>
        <span><i class="line-swatch" />候选分隔线</span>
        <input type="checkbox" :checked="props.showCandidateLines" @change="emit('update:showCandidateLines', ($event.target as HTMLInputElement).checked)" />
      </label>
      <label>
        <span><i class="panel-swatch" />表面面板</span>
        <input type="checkbox" :checked="props.showPanels" @change="emit('update:showPanels', ($event.target as HTMLInputElement).checked)" />
      </label>
    </div>
  </div>
  <div v-else class="empty-state">等待图片源输入</div>
</template>

<style scoped>
.surface-node { display: grid; gap: 12px; }
.preview { position: relative; height: 300px; overflow: hidden; border: 1px solid var(--border); border-radius: 7px; background: var(--bg-inset); }
.preview img { width: 100%; height: 100%; object-fit: contain; }
.panel-tint { position: absolute; inset: 0; background: repeating-linear-gradient(180deg, transparent 0 19%, #4c8dff18 19% 20%); pointer-events: none; }
.candidate-line { position: absolute; left: 0; right: 0; height: 2px; background: var(--warn); box-shadow: 0 0 5px #e2a40088; pointer-events: none; }
.surface-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.surface-stats div { padding: 9px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg-inset); }
.surface-stats strong { display: block; color: var(--text); font-size: 18px; }.surface-stats span { color: var(--text-faint); font-size: 10px; }
.layer-list { display: grid; gap: 5px; }
.layer-list label { display: flex; align-items: center; justify-content: space-between; padding: 7px 9px; border-radius: 6px; background: var(--bg-inset); color: var(--text-dim); font-size: 11px; }
.layer-list label span { display: flex; align-items: center; gap: 7px; }
.line-swatch, .panel-swatch { width: 12px; height: 3px; background: var(--warn); }.panel-swatch { height: 9px; border: 1px solid var(--accent); background: var(--accent-soft); }
input { min-height: 0; accent-color: var(--accent); }
.empty-state { min-height: 410px; display: grid; place-items: center; color: var(--text-faint); }
</style>
