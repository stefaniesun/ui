<script setup lang="ts">
import { computed, ref } from "vue";
import { canSplitAt } from "@region-split/core/browser";
import type { Store } from "../state.js";
import { imageUrl } from "../api.js";
import { snapToCandidates, toImageY } from "../coords.js";

const props = defineProps<{
  store: Store;
  hoveredId: string | null;
  showCandidateLines: boolean;
  showPanels: boolean;
}>();
const emit = defineEmits<{ hover: [id: string | null] }>();
const stageEl = ref<HTMLElement | null>(null);
const imgEl = ref<HTMLImageElement | null>(null);
const displayScale = ref(1);
const splitY = ref<number | null>(null);
const splitValid = ref(false);
const splitSnapped = ref(false);
const image = computed(() => props.store.doc.value?.image ?? null);
const selectedRegion = computed(() => props.store.regions.value.find(region => props.store.selectedIds.value.includes(region.id)) ?? null);
const splitHalvesValue = computed(() => {
  if (!selectedRegion.value || splitY.value === null) return null;
  return {
    top: splitY.value - selectedRegion.value.bounds.y,
    bottom: selectedRegion.value.bounds.y + selectedRegion.value.bounds.h - splitY.value,
  };
});

function measure() {
  if (!imgEl.value || !image.value) return;
  const layoutWidth = imgEl.value.clientWidth;
  displayScale.value = layoutWidth > 0 && image.value.width > 0 ? layoutWidth / image.value.width : 1;
}
function onMove(event: MouseEvent) {
  if (props.store.mode.value !== "split" || !image.value) return;
  const rect = stageEl.value!.getBoundingClientRect();
  const screenScale = rect.height > 0 && image.value.height > 0 ? rect.height / image.value.height : 1;
  const rawY = Math.max(0, Math.min(image.value.height, toImageY(event.clientY, rect.top, screenScale)));
  const snappedY = snapToCandidates(rawY, props.store.candidateLines.value, 12);
  splitY.value = snappedY.y;
  splitSnapped.value = snappedY.snapped;
  splitValid.value = canSplitAt(props.store.regions.value, props.store.selectedIndex.value, snappedY.y);
}
async function onStageClick() {
  if (props.store.mode.value !== "split" || splitY.value === null || !splitValid.value) return;
  await props.store.commitSplit(splitY.value);
  splitY.value = null;
}
function onRegionClick(id: string, event: MouseEvent) {
  if (props.store.mode.value === "split") return;
  props.store.select(id, event.ctrlKey || event.metaKey || event.shiftKey);
}
</script>

<template>
  <div class="region-canvas" @click.self="props.store.clearSelection()">
    <div v-if="image" ref="stageEl" class="stage" :class="{ splitting: props.store.mode.value === 'split' }" @mousemove="onMove" @click="onStageClick">
      <img ref="imgEl" data-test="analysis-image" class="comparison-image" :src="imageUrl(props.store.projectId.value)" :alt="image.fileName" @load="measure" />
      <div v-if="props.showPanels" class="panel-tint" />
      <span
        v-for="line in props.showCandidateLines ? props.store.candidateLines.value : []"
        :key="`candidate-${line.y}`"
        class="candidate-line"
        :style="{ top: `${line.y * displayScale}px`, opacity: Math.max(.35, line.strength) }"
      />
      <div
        v-for="(region, index) in props.store.regions.value"
        :key="region.id"
        class="overlay"
        :class="{ selected: props.store.selectedIds.value.includes(region.id), hovered: props.hoveredId === region.id }"
        :style="{ top: `${region.bounds.y * displayScale}px`, height: `${region.bounds.h * displayScale}px` }"
        @click.stop="onRegionClick(region.id, $event)"
        @mouseenter="emit('hover', region.id)"
        @mouseleave="emit('hover', null)"
      >
        <span>{{ index + 1 }} · {{ region.displayName }}</span>
      </div>
      <template v-if="props.store.mode.value === 'split' && splitY !== null">
        <div class="split-line" :class="{ snapped: splitSnapped, invalid: !splitValid }" :style="{ top: `${splitY * displayScale}px` }" />
        <span class="split-info" :style="{ top: `${splitY * displayScale}px` }">y {{ splitY }} · {{ splitHalvesValue?.top }} / {{ splitHalvesValue?.bottom }}</span>
      </template>
    </div>
    <div v-else class="empty-state">等待图片源输入</div>
  </div>
</template>

<style scoped>
.region-canvas { min-width: 0; min-height: 0; display: block; margin: 0; padding: 0; overflow: hidden; background: var(--bg-inset); }
.stage { position: relative; width: 100%; aspect-ratio: var(--image-aspect); margin: 0; padding: 0; overflow: hidden; background: #111318; }
.stage img { display: block; width: 100%; height: auto; }.stage.splitting { cursor: crosshair; }.panel-tint { position: absolute; inset: 0; background: repeating-linear-gradient(180deg, transparent 0 19%, #4c8dff12 19% 20%); pointer-events: none; }
.candidate-line { position: absolute; z-index: 2; left: 0; right: 0; height: 1px; background: var(--warn); pointer-events: none; }
.overlay { position: absolute; z-index: 3; left: 0; right: 0; border: 1px solid #4c8dff66; background: #4c8dff08; cursor: pointer; }.overlay:hover,.overlay.hovered { background: #4c8dff22; }.overlay.selected { z-index: 4; border: 2px solid var(--accent); background: #4c8dff28; box-shadow: inset 0 0 0 1px #ffffff22; }.overlay span { position: absolute; left: 5px; top: 4px; max-width: calc(100% - 10px); overflow: hidden; padding: 2px 5px; border-radius: 4px; color: white; background: #16181dcc; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.split-line { position: absolute; z-index: 8; left: 0; right: 0; height: 2px; background: var(--accent); box-shadow: 0 0 6px var(--accent); pointer-events: none; }.split-line.snapped { background: var(--ok); }.split-line.invalid { background: var(--danger); }.split-info { position: absolute; z-index: 9; right: 5px; transform: translateY(-130%); padding: 2px 5px; border-radius: 4px; color: white; background: #16181dee; font-size: 10px; pointer-events: none; }
.empty-state { min-height: 520px; display: grid; place-items: center; color: var(--text-faint); }
</style>
