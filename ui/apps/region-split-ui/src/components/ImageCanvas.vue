<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { imageUrl } from "../api.js";
import type { Store } from "../state.js";

const props = defineProps<{ store: Store }>();

const imgEl = ref<HTMLImageElement>();
const displayWidth = ref(0);

const image = computed(() => props.store.doc.value?.image ?? null);
const displayScale = computed(() => {
  const width = image.value?.width ?? 0;
  return displayWidth.value > 0 && width > 0 ? displayWidth.value / width : 1;
});

function measure() { displayWidth.value = imgEl.value?.clientWidth ?? 0; }
onMounted(() => { measure(); window.addEventListener("resize", measure); });
onUnmounted(() => window.removeEventListener("resize", measure));

function onRegionClick(id: string, event: MouseEvent) {
  props.store.select(id, event.ctrlKey || event.metaKey || event.shiftKey);
}
</script>

<template>
  <div class="canvas" data-test="backdrop" @click.self="props.store.clearSelection()">
    <div v-if="image" class="stage">
      <img ref="imgEl" :src="imageUrl(props.store.projectId.value)" :alt="image.fileName" @load="measure" />
      <div
        v-for="(region, index) in props.store.regions.value"
        :key="region.id"
        class="overlay"
        :class="{ selected: props.store.selectedIds.value.includes(region.id) }"
        :data-region-id="region.id"
        :style="{
          top: `${region.bounds.y * displayScale}px`,
          height: `${region.bounds.h * displayScale}px`,
        }"
        @click.stop="onRegionClick(region.id, $event)"
      >
        <span class="label">{{ index + 1 }} {{ region.displayName }}</span>
      </div>
    </div>
    <p v-else class="empty">先选择一张 UI 效果图</p>
  </div>
</template>

<style scoped>
.canvas { min-height: 100%; padding: 16px; display: flex; justify-content: center; }
.stage { position: relative; width: 100%; max-width: 480px; align-self: flex-start; }
.stage img { display: block; width: 100%; }
.overlay {
  position: absolute; left: 0; right: 0; cursor: pointer;
  border-bottom: 1px solid #00000033; box-sizing: border-box;
}
.overlay:nth-of-type(odd) { background: #00000008; }
.overlay:nth-of-type(even) { background: #00000014; }
.overlay.selected { background: #2f6fed1a; outline: 1px solid #2f6fed; border-bottom: 3px solid #2f6fed; }
.label {
  position: absolute; top: 2px; left: 4px; font-size: 12px; line-height: 16px;
  padding: 0 4px; border-radius: 3px; background: #ffffffd9; color: #333; white-space: nowrap;
}
.empty { color: #888; align-self: center; }
</style>
