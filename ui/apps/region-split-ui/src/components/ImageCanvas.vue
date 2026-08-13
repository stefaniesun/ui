<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { canSplitAt } from "@region-split/core/browser";
import { imageUrl } from "../api.js";
import { snapToCandidates, toImageY } from "../coords.js";
import type { Store } from "../state.js";
import ElementOverlay from "./ElementOverlay.vue";

const props = defineProps<{ store: Store; hoveredId?: string | null }>();
const emit = defineEmits<{ hover: [id: string | null] }>();

const SNAP_THRESHOLD = 12;

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
  if (splitting.value) return;
  props.store.select(id, event.ctrlKey || event.metaKey || event.shiftKey);
}

const stageEl = ref<HTMLElement>();
const splitY = ref<number | null>(null);
const splitSnapped = ref(false);

const splitting = computed(() => props.store.mode.value === "split");
const splitValid = computed(() =>
  splitY.value !== null &&
  canSplitAt(props.store.regions.value, props.store.selectedIndex.value, splitY.value));
const splitHalves = computed(() => {
  const region = props.store.selectedRegion.value;
  if (!region || splitY.value === null) return null;
  return {
    top: splitY.value - region.bounds.y,
    bottom: region.bounds.y + region.bounds.h - splitY.value,
  };
});

// 覆盖所有退出路径：取消/Esc → cancelSplit() 把 mode 置回 idle；
// commitSplit 成功也会把 mode 置回 idle；选中变化本身不会退出拆分模式
// （beginSplit 要求先选中），因此只需监听 mode 一处即可覆盖全部路径。
watch(splitting, active => { if (!active) { splitY.value = null; splitSnapped.value = false; } });

function onStageMove(event: MouseEvent) {
  if (!splitting.value) return;
  const rect = stageEl.value?.getBoundingClientRect();
  const raw = toImageY(event.clientY, rect?.top ?? 0, displayScale.value);
  const result = snapToCandidates(raw, props.store.candidateLines.value, SNAP_THRESHOLD);
  splitY.value = result.y;
  splitSnapped.value = result.snapped;
}

function onStageClick() {
  if (!splitting.value || splitY.value === null || !splitValid.value) return;
  props.store.commitSplit(splitY.value);
}
</script>

<template>
  <div class="canvas" data-test="backdrop" @click.self="props.store.clearSelection()">
    <div v-if="image" class="comparison">
      <section class="preview-panel">
        <h2>原始效果图</h2>
        <div class="image-frame">
          <img :src="imageUrl(props.store.projectId.value)" :alt="image.fileName" />
        </div>
      </section>

      <section class="preview-panel">
        <h2>区域分析图</h2>
        <div
          ref="stageEl"
          class="stage image-frame"
          data-test="stage"
          :class="{ splitting }"
          @mousemove="onStageMove"
          @click="onStageClick"
        >
          <img ref="imgEl" :src="imageUrl(props.store.projectId.value)" :alt="image.fileName" @load="measure" />
          <div
            v-for="(region, index) in props.store.regions.value"
            :key="region.id"
            class="overlay"
            :class="{
              selected: props.store.selectedIds.value.includes(region.id),
              hovered: props.hoveredId === region.id,
            }"
            :data-region-id="region.id"
            :style="{
              top: `${region.bounds.y * displayScale}px`,
              height: `${region.bounds.h * displayScale}px`,
            }"
            @click.stop="onRegionClick(region.id, $event)"
            @mouseenter="emit('hover', region.id)"
            @mouseleave="emit('hover', null)"
          >
            <span class="label">{{ index + 1 }} {{ region.displayName }}</span>
          </div>

          <ElementOverlay
            :store="props.store" :image-width="image.width" :image-height="image.height"
            :display-width="displayWidth" :display-height="image.height * displayScale"
            :disabled="!props.store.doc.value?.analyzedAt || props.store.busy.value || splitting"
          />

          <template v-if="splitting && splitY !== null">
            <div
              data-test="split-line"
              class="split-line"
              :class="{ snapped: splitSnapped, invalid: !splitValid }"
              :style="{ top: `${splitY * displayScale}px` }"
            />
            <span
              data-test="split-info"
              class="split-info"
              :style="{ top: `${splitY * displayScale}px` }"
            >
              y {{ splitY }} · 上 {{ splitHalves?.top }} / 下 {{ splitHalves?.bottom }}
            </span>
          </template>
        </div>
      </section>
    </div>
    <p v-else class="empty">先选择一张 UI 效果图</p>
  </div>
</template>

<style scoped>
.canvas { min-height: 100%; padding: 12px; display: flex; justify-content: center; box-sizing: border-box; }
.comparison { width: min(100%, 732px); display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: start; }
.preview-panel { min-width: 0; }
.preview-panel h2 { height: 24px; margin: 0; font-size: 12px; line-height: 24px; font-weight: 500; color: #666; }
.image-frame { width: 100%; box-sizing: border-box; border: 1px solid #d9dce1; background: #fff; overflow: hidden; }
.stage { position: relative; }
.image-frame img { display: block; width: 100%; height: auto; }
.overlay {
  position: absolute; left: 0; right: 0; cursor: pointer;
  border-bottom: 1px solid #00000033; box-sizing: border-box;
}
.overlay:nth-of-type(odd) { background: #00000008; }
.overlay:nth-of-type(even) { background: #00000014; }
.overlay.selected { background: #2f6fed1a; outline: 1px solid #2f6fed; border-bottom: 3px solid #2f6fed; }
.overlay.hovered:not(.selected) { background: #2f6fed0d; outline: 1px dashed #2f6fed80; }
.label {
  position: absolute; top: 2px; left: 4px; font-size: 12px; line-height: 16px;
  padding: 0 4px; border-radius: 3px; background: #ffffffd9; color: #333; white-space: nowrap;
}
.empty { color: #888; align-self: center; }
.stage.splitting { cursor: crosshair; }
.stage.splitting .overlay { pointer-events: none; }
.split-line { position: absolute; left: 0; right: 0; height: 2px; background: #2f6fed; pointer-events: none; }
.split-line.snapped { height: 4px; }
.split-line.invalid { background: #d0454c; }
.split-info {
  position: absolute; right: 4px; transform: translateY(-140%);
  font-size: 12px; padding: 1px 5px; border-radius: 3px;
  background: #2f6fedee; color: #fff; white-space: nowrap; pointer-events: none;
}
@media (max-width: 760px) {
  .comparison { grid-template-columns: 1fr; }
}
</style>
