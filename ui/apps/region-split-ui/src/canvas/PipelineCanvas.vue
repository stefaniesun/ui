<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import PipelineEdges from "./PipelineEdges.vue";
import PipelineNode from "./PipelineNode.vue";
import {
  DEFAULT_NODE_POSITIONS,
  NODE_POSITIONS_STORAGE_KEY,
  clampZoom,
  fitBounds,
  loadNodePositions,
  saveNodePositions,
  zoomAtPoint,
  type NodeId,
  type NodePositions,
  type Point,
  type Viewport,
} from "./canvas-state.js";

const props = withDefaults(defineProps<{
  sourceStatus?: "idle" | "active" | "done" | "warn";
  surfaceStatus?: "idle" | "active" | "done" | "warn";
  analyzeStatus?: "idle" | "active" | "done" | "warn";
  regionsStatus?: "idle" | "active" | "done" | "warn";
  edgeActive?: Partial<Record<"source-surface" | "surface-analyze" | "analyze-regions", boolean>>;
}>(), {
  sourceStatus: "idle",
  surfaceStatus: "idle",
  analyzeStatus: "idle",
  regionsStatus: "idle",
  edgeActive: () => ({}),
});

const rootEl = ref<HTMLElement | null>(null);
const viewport = reactive<Viewport>({ x: 0, y: 0, zoom: 1 });
const positions = reactive<NodePositions>(loadNodePositions(
  typeof localStorage === "undefined" ? undefined : localStorage,
  NODE_POSITIONS_STORAGE_KEY,
  DEFAULT_NODE_POSITIONS,
));
const sizes = {
  source: { width: 440, height: 500 },
  surface: { width: 440, height: 500 },
  analyze: { width: 440, height: 500 },
  regions: { width: 820, height: 700 },
};
const edgeStates = computed(() => ({
  "source-surface": props.edgeActive["source-surface"] ?? false,
  "surface-analyze": props.edgeActive["surface-analyze"] ?? false,
  "analyze-regions": props.edgeActive["analyze-regions"] ?? false,
}));
const worldTransform = computed(() => `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`);
const zoomLabel = computed(() => `${Math.round(viewport.zoom * 100)}%`);

let interaction: null | {
  kind: "pan" | "node";
  id?: NodeId;
  start: Point;
  origin: Point;
} = null;

function pointerPoint(event: PointerEvent | WheelEvent): Point {
  const rect = rootEl.value?.getBoundingClientRect();
  return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
}

function onCanvasPointerDown(event: PointerEvent) {
  if (event.button !== 0 && event.button !== 1) return;
  interaction = { kind: "pan", start: pointerPoint(event), origin: { x: viewport.x, y: viewport.y } };
  rootEl.value?.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function onNodeDragStart(event: PointerEvent, rawId: string) {
  if (event.button !== 0) return;
  const id = rawId as NodeId;
  interaction = { kind: "node", id, start: pointerPoint(event), origin: { ...positions[id] } };
  rootEl.value?.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function onPointerMove(event: PointerEvent) {
  if (!interaction) return;
  const point = pointerPoint(event);
  const dx = point.x - interaction.start.x;
  const dy = point.y - interaction.start.y;
  if (interaction.kind === "pan") {
    viewport.x = interaction.origin.x + dx;
    viewport.y = interaction.origin.y + dy;
  } else if (interaction.id) {
    positions[interaction.id] = {
      x: interaction.origin.x + dx / viewport.zoom,
      y: interaction.origin.y + dy / viewport.zoom,
    };
  }
}

function endInteraction() {
  if (interaction?.kind === "node") {
    saveNodePositions(typeof localStorage === "undefined" ? undefined : localStorage, NODE_POSITIONS_STORAGE_KEY, positions);
  }
  interaction = null;
}

function setZoom(next: number, center?: Point) {
  const rect = rootEl.value?.getBoundingClientRect();
  const point = center ?? { x: (rect?.width ?? 0) / 2, y: (rect?.height ?? 0) / 2 };
  Object.assign(viewport, zoomAtPoint(viewport, clampZoom(next), point));
}

function onWheel(event: WheelEvent) {
  event.preventDefault();
  setZoom(viewport.zoom * Math.exp(-event.deltaY * .0015), pointerPoint(event));
}

function contentBounds() {
  const ids = Object.keys(positions) as NodeId[];
  const left = Math.min(...ids.map(id => positions[id].x));
  const top = Math.min(...ids.map(id => positions[id].y));
  const right = Math.max(...ids.map(id => positions[id].x + sizes[id].width));
  const bottom = Math.max(...ids.map(id => positions[id].y + sizes[id].height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function fitAll() {
  const rect = rootEl.value?.getBoundingClientRect();
  if (!rect?.width || !rect.height) return;
  Object.assign(viewport, fitBounds(contentBounds(), { width: rect.width, height: rect.height }, 64));
}

function onResize() { if (viewport.zoom === 1 && viewport.x === 0 && viewport.y === 0) fitAll(); }

onMounted(async () => {
  await nextTick();
  fitAll();
  window.addEventListener("resize", onResize);
});
onBeforeUnmount(() => window.removeEventListener("resize", onResize));

defineExpose({ fitAll, viewport, positions });
</script>

<template>
  <div
    ref="rootEl"
    class="pipeline-canvas"
    data-test="pipeline-canvas"
    @pointerdown="onCanvasPointerDown"
    @pointermove="onPointerMove"
    @pointerup="endInteraction"
    @pointercancel="endInteraction"
    @wheel="onWheel"
  >
    <div class="world" :style="{ transform: worldTransform }">
      <PipelineEdges :positions="positions" :sizes="sizes" :active="edgeStates" />
      <PipelineNode node-id="source" title="图片源" :position="positions.source" :width="sizes.source.width" :min-height="sizes.source.height" :status="props.sourceStatus" :input="false" @drag-start="onNodeDragStart">
        <template #status><slot name="source-status" /></template>
        <slot name="source" />
      </PipelineNode>
      <PipelineNode node-id="surface" title="表面分析" :position="positions.surface" :width="sizes.surface.width" :min-height="sizes.surface.height" :status="props.surfaceStatus" @drag-start="onNodeDragStart">
        <template #status><slot name="surface-status" /></template>
        <slot name="surface" />
      </PipelineNode>
      <PipelineNode node-id="analyze" title="AI 分段" :position="positions.analyze" :width="sizes.analyze.width" :min-height="sizes.analyze.height" :status="props.analyzeStatus" @drag-start="onNodeDragStart">
        <template #status><slot name="analyze-status" /></template>
        <slot name="analyze" />
      </PipelineNode>
      <PipelineNode node-id="regions" title="区域文档" :position="positions.regions" :width="sizes.regions.width" :min-height="sizes.regions.height" :status="props.regionsStatus" :output="false" @drag-start="onNodeDragStart">
        <template #status><slot name="regions-status" /></template>
        <slot name="regions" />
      </PipelineNode>
    </div>

    <div class="zoom-controls" @pointerdown.stop>
      <button aria-label="缩小" @click="setZoom(viewport.zoom - .1)">−</button>
      <button class="zoom-label" aria-label="当前缩放" @click="setZoom(1)">{{ zoomLabel }}</button>
      <button aria-label="放大" @click="setZoom(viewport.zoom + .1)">＋</button>
      <button aria-label="适应窗口" title="适应窗口" @click="fitAll">⌗</button>
    </div>
  </div>
</template>

<style scoped>
.pipeline-canvas { position: relative; width: 100%; height: 100%; overflow: hidden; background-color: var(--bg-canvas); background-image: radial-gradient(circle, #424751 1px, transparent 1px); background-size: 22px 22px; touch-action: none; cursor: grab; }
.pipeline-canvas:active { cursor: grabbing; }
.world { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
.zoom-controls { position: absolute; right: 18px; bottom: 18px; z-index: 20; display: flex; gap: 4px; padding: 5px; border: 1px solid var(--border); border-radius: 8px; background: #24272eee; box-shadow: 0 8px 24px #0008; }
.zoom-controls button { width: 32px; height: 30px; min-height: 30px; padding: 0; }
.zoom-controls .zoom-label { width: 56px; color: var(--text-dim); font-size: 11px; }
</style>
