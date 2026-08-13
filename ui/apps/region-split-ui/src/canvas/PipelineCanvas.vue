<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";
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
  status?: "idle" | "active" | "done" | "warn";
  detailStatus?: "idle" | "active" | "done" | "warn";
  showDetail?: boolean;
}>(), { status: "idle", detailStatus: "idle", showDetail: false });

const rootEl = ref<HTMLElement | null>(null);
const workspaceEl = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | null = null;
const viewport = reactive<Viewport>({ x: 0, y: 0, zoom: 1 });
const positions = reactive<NodePositions>(loadNodePositions(
  typeof localStorage === "undefined" ? undefined : localStorage,
  NODE_POSITIONS_STORAGE_KEY,
  DEFAULT_NODE_POSITIONS,
));
const fallbackSize = { width: 1105, height: 700 };
/** 详情节点的宽度，与模板里 PipelineNode 的 :width 保持一致 */
const DETAIL_WIDTH = 760;
const worldTransform = computed(() => `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`);
const zoomLabel = computed(() => `${Math.round(viewport.zoom * 100)}%`);

let interaction: null | {
  kind: "pan" | "node";
  nodeId: NodeId;
  start: Point;
  origin: Point;
} = null;

function pointerPoint(event: PointerEvent | WheelEvent): Point {
  const rect = rootEl.value?.getBoundingClientRect();
  return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
}

function onCanvasPointerDown(event: PointerEvent) {
  if (event.button !== 0 && event.button !== 1) return;
  // pan 分支不读 nodeId，填 workspace 只为满足类型
  interaction = {
    kind: "pan", nodeId: "workspace",
    start: pointerPoint(event), origin: { x: viewport.x, y: viewport.y },
  };
  rootEl.value?.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function onNodeDragStart(event: PointerEvent, nodeId: string) {
  if (event.button !== 0) return;
  const id = nodeId as NodeId;
  interaction = {
    kind: "node", nodeId: id, start: pointerPoint(event), origin: { ...positions[id] },
  };
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
  } else {
    positions[interaction.nodeId] = {
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

/** 两个节点的并集包围盒——只算 workspace 会把详情节点挡在视口外 */
function contentBounds() {
  const measure = (id: NodeId, fallbackWidth: number) => {
    const node = workspaceEl.value?.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
    return {
      ...positions[id],
      width: node?.offsetWidth || fallbackWidth,
      height: node?.offsetHeight || fallbackSize.height,
    };
  };
  const boxes = [measure("workspace", fallbackSize.width)];
  if (props.showDetail) boxes.push(measure("detail", DETAIL_WIDTH));
  const left = Math.min(...boxes.map(box => box.x));
  const top = Math.min(...boxes.map(box => box.y));
  const right = Math.max(...boxes.map(box => box.x + box.width));
  const bottom = Math.max(...boxes.map(box => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function fitAll() {
  const rect = rootEl.value?.getBoundingClientRect();
  if (!rect?.width || !rect.height) return;
  Object.assign(viewport, fitBounds(contentBounds(), { width: rect.width, height: rect.height }, 64));
}

async function refreshLayout() {
  await nextTick();
  fitAll();
}

function onResize() { fitAll(); }

onMounted(async () => {
  await nextTick();
  const node = workspaceEl.value?.querySelector<HTMLElement>('[data-node-id="workspace"]');
  if (node && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => fitAll());
    resizeObserver.observe(node);
  }
  fitAll();
  window.addEventListener("resize", onResize);
});
onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  window.removeEventListener("resize", onResize);
});

defineExpose({ fitAll, refreshLayout, viewport, positions });
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
      <div ref="workspaceEl">
        <PipelineNode
          node-id="workspace"
          title="图片区域对照"
          :position="positions.workspace"
          :width="fallbackSize.width"
          :min-height="fallbackSize.height"
          :status="props.status"
          :input="false"
          :output="false"
          @drag-start="onNodeDragStart"
        >
          <template #status><slot name="status" /></template>
          <slot />
        </PipelineNode>
        <PipelineNode
          v-if="props.showDetail"
          node-id="detail"
          title="区域详情"
          :position="positions.detail"
          :width="DETAIL_WIDTH"
          :min-height="420"
          :status="props.detailStatus"
          :input="false"
          :output="false"
          @drag-start="onNodeDragStart"
        >
          <template #status><slot name="detail-status" /></template>
          <slot name="detail" />
        </PipelineNode>
      </div>
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
