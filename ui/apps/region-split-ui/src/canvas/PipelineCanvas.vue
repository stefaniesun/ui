<script setup lang="ts">
import type { Region } from "@region-split/core/browser";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import type { ElementStore } from "../element-state.js";
import {
  bezierPath,
  clampZoom,
  fitBounds,
  DEFAULT_NODE_POSITIONS,
  loadNodePositions,
  NODE_POSITIONS_STORAGE_KEY,
  saveNodePositions,
  type Bounds,
  type Point,
  type Viewport,
} from "./canvas-state.js";
import {
  centerNodeViewport,
  detailNodeId,
  loadDetailPositions,
  nextDetailPosition,
  saveDetailPositions,
  screenPointToWorld,
} from "./dynamic-detail-state.js";
import PipelineNode from "./PipelineNode.vue";

const props = withDefaults(defineProps<{
  regions?: Region[];
  projectId?: string;
  getRegionAnchor?: (regionId: string) => Point | null;
  createElementStore?: () => ElementStore;
  showCode?: boolean;
  storage?: Storage;
}>(), {
  regions: () => [],
  projectId: "",
  getRegionAnchor: undefined,
  createElementStore: undefined,
  showCode: false,
  storage: undefined,
});

const emit = defineEmits<{ viewportChange: [viewport: Viewport] }>();
const canvas = ref<HTMLElement | null>(null);
const viewport = reactive<Viewport>({ x: 40, y: 40, zoom: 0.72 });
const fixedPositions = reactive(loadNodePositions(
  props.storage ?? globalThis.localStorage,
  NODE_POSITIONS_STORAGE_KEY,
  DEFAULT_NODE_POSITIONS,
));
const detailPositions = reactive<Record<string, Point>>({});
const openRegionIds = ref<string[]>([]);
const elementStores = new Map<string, ElementStore>();
const detailHoveredIds = reactive<Record<string, string | null>>({});
const highlightedRegionId = ref<string | null>(null);
const connectionStarts = reactive<Record<string, Point>>({});
let highlightTimer: ReturnType<typeof setTimeout> | undefined;
let connectionFrame = 0;
let drag: { nodeId: string; start: Point; origin: Point } | null = null;
let pan: { start: Point; origin: Point } | null = null;
let resizeObserver: ResizeObserver | undefined;

const WORKSPACE = { width: 1105, height: 700 };
const DETAIL = { width: 760, height: 600 };
const CODE = { width: 760, height: 600 };

const regionById = computed(() => new Map(props.regions.map(region => [region.id, region])));
const openedRegions = computed(() => openRegionIds.value.flatMap(id => {
  const region = regionById.value.get(id);
  return region ? [region] : [];
}));
const transform = computed(() => `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`);
const detailPositionKey = computed(() => `region-split:detail-node-positions:${props.projectId}:v1`);
const links = computed(() => openedRegions.value.flatMap(region => {
  const from = connectionStarts[region.id];
  const toPosition = detailPositions[region.id];
  if (!from || !toPosition) return [];
  return [{ id: region.id, path: bezierPath(from, { x: toPosition.x, y: toPosition.y + 21 }) }];
}));

function storageTarget(): Storage | undefined {
  return props.storage ?? globalThis.localStorage;
}

function persist(): void {
  saveNodePositions(storageTarget(), NODE_POSITIONS_STORAGE_KEY, fixedPositions);
  saveDetailPositions(storageTarget(), detailPositionKey.value, detailPositions);
}

function detailBounds(regionId: string): Bounds | null {
  const position = detailPositions[regionId];
  if (!position) return null;
  const element = canvas.value?.querySelector<HTMLElement>(`[data-node-id="${detailNodeId(regionId)}"]`);
  const measuredHeight = element ? element.getBoundingClientRect().height / viewport.zoom : 0;
  return { ...position, width: DETAIL.width, height: Math.max(DETAIL.height, measuredHeight) };
}

function occupiedDetailBounds(): Bounds[] {
  const bounds = openRegionIds.value.flatMap(id => {
    const detail = detailBounds(id);
    return detail ? [detail] : [];
  });
  if (props.showCode) bounds.push({ ...fixedPositions.code, ...CODE });
  return bounds;
}

function refreshConnectionsNow(): void {
  if (!canvas.value || !props.getRegionAnchor) return;
  const rect = canvas.value.getBoundingClientRect();
  for (const id of openRegionIds.value) {
    const anchor = props.getRegionAnchor(id);
    if (anchor) connectionStarts[id] = screenPointToWorld(anchor, rect, viewport);
    else delete connectionStarts[id];
  }
}

function refreshConnections(): void {
  if (connectionFrame) cancelAnimationFrame(connectionFrame);
  connectionFrame = requestAnimationFrame(() => {
    connectionFrame = 0;
    refreshConnectionsNow();
  });
}

function focusDetail(regionId: string): void {
  const position = detailPositions[regionId];
  const rect = canvas.value?.getBoundingClientRect();
  if (position && rect) {
    Object.assign(viewport, centerNodeViewport(
      detailBounds(regionId) ?? { ...position, ...DETAIL },
      { width: rect.width, height: rect.height },
      viewport.zoom,
    ));
    emit("viewportChange", { ...viewport });
  }
  highlightedRegionId.value = regionId;
  if (highlightTimer) clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => {
    if (highlightedRegionId.value === regionId) highlightedRegionId.value = null;
  }, 900);
  nextTick(refreshConnections);
}

function openDetail(regionId: string): void {
  if (!regionById.value.has(regionId)) return;
  if (openRegionIds.value.includes(regionId)) {
    focusDetail(regionId);
    return;
  }
  if (!detailPositions[regionId]) {
    detailPositions[regionId] = nextDetailPosition(
      { ...fixedPositions.workspace, ...WORKSPACE },
      occupiedDetailBounds(),
      DETAIL,
      1500,
    );
  }
  if (props.createElementStore) elementStores.set(regionId, props.createElementStore());
  detailHoveredIds[regionId] = null;
  openRegionIds.value = [...openRegionIds.value, regionId];
  persist();
  nextTick(() => focusDetail(regionId));
}

function closeDetail(regionId: string): void {
  openRegionIds.value = openRegionIds.value.filter(id => id !== regionId);
  elementStores.delete(regionId);
  delete detailHoveredIds[regionId];
  delete connectionStarts[regionId];
  if (highlightedRegionId.value === regionId) highlightedRegionId.value = null;
}

function setDetailHovered(regionId: string, id: string | null): void {
  detailHoveredIds[regionId] = id;
}

function nodePosition(nodeId: string): Point | undefined {
  if (nodeId.startsWith("detail:")) return detailPositions[nodeId.slice(7)];
  return fixedPositions[nodeId as keyof typeof fixedPositions];
}

function startNodeDrag(event: PointerEvent, nodeId: string): void {
  if (event.button !== 0) return;
  const position = nodePosition(nodeId);
  if (!position) return;
  drag = { nodeId, start: { x: event.clientX, y: event.clientY }, origin: { ...position } };
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", stopPointer);
}

function startPan(event: PointerEvent): void {
  if (event.target !== canvas.value && !(event.target as HTMLElement).classList.contains("grid")) return;
  pan = { start: { x: event.clientX, y: event.clientY }, origin: { x: viewport.x, y: viewport.y } };
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", stopPointer);
}

function onPointerMove(event: PointerEvent): void {
  if (drag) {
    const position = nodePosition(drag.nodeId);
    if (!position) return;
    position.x = drag.origin.x + (event.clientX - drag.start.x) / viewport.zoom;
    position.y = drag.origin.y + (event.clientY - drag.start.y) / viewport.zoom;
    refreshConnections();
  } else if (pan) {
    viewport.x = pan.origin.x + event.clientX - pan.start.x;
    viewport.y = pan.origin.y + event.clientY - pan.start.y;
    emit("viewportChange", { ...viewport });
    refreshConnections();
  }
}

function stopPointer(): void {
  if (drag) persist();
  drag = null;
  pan = null;
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", stopPointer);
}

function onWheel(event: WheelEvent): void {
  event.preventDefault();
  if (event.ctrlKey || event.metaKey) {
    const oldZoom = viewport.zoom;
    const nextZoom = clampZoom(oldZoom * (event.deltaY > 0 ? 0.9 : 1.1));
    const rect = canvas.value!.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    viewport.x = px - ((px - viewport.x) / oldZoom) * nextZoom;
    viewport.y = py - ((py - viewport.y) / oldZoom) * nextZoom;
    viewport.zoom = nextZoom;
  } else {
    viewport.x -= event.deltaX;
    viewport.y -= event.deltaY;
  }
  emit("viewportChange", { ...viewport });
  refreshConnections();
}

function zoomBy(factor: number): void {
  const rect = canvas.value?.getBoundingClientRect();
  if (!rect) return;
  const oldZoom = viewport.zoom;
  const nextZoom = clampZoom(oldZoom * factor);
  viewport.x = rect.width / 2 - ((rect.width / 2 - viewport.x) / oldZoom) * nextZoom;
  viewport.y = rect.height / 2 - ((rect.height / 2 - viewport.y) / oldZoom) * nextZoom;
  viewport.zoom = nextZoom;
  emit("viewportChange", { ...viewport });
  refreshConnections();
}

function fitAll(): void {
  const rect = canvas.value?.getBoundingClientRect();
  if (!rect) return;
  const bounds: Bounds[] = [{ ...fixedPositions.workspace, ...WORKSPACE }];
  for (const id of openRegionIds.value) {
    const detail = detailBounds(id);
    if (detail) bounds.push(detail);
  }
  if (props.showCode) bounds.push({ ...fixedPositions.code, ...CODE });
  const left = Math.min(...bounds.map(bound => bound.x));
  const top = Math.min(...bounds.map(bound => bound.y));
  const right = Math.max(...bounds.map(bound => bound.x + bound.width));
  const bottom = Math.max(...bounds.map(bound => bound.y + bound.height));
  Object.assign(viewport, fitBounds(
    { x: left, y: top, width: right - left, height: bottom - top },
    { width: rect.width, height: rect.height },
  ));
  emit("viewportChange", { ...viewport });
  refreshConnections();
}

watch(() => props.regions.map(region => region.id), ids => {
  const validIds = new Set(ids);
  let changed = false;
  for (const id of openRegionIds.value) {
    if (!validIds.has(id)) {
      closeDetail(id);
      delete detailPositions[id];
      changed = true;
    }
  }
  for (const id of Object.keys(detailPositions)) {
    if (!validIds.has(id)) {
      delete detailPositions[id];
      changed = true;
    }
  }
  if (changed) persist();
  refreshConnections();
}, { deep: true });

watch(() => props.projectId, () => {
  openRegionIds.value = [];
  elementStores.clear();
  for (const id of Object.keys(detailPositions)) delete detailPositions[id];
  for (const id of Object.keys(connectionStarts)) delete connectionStarts[id];
  for (const id of Object.keys(detailHoveredIds)) delete detailHoveredIds[id];
  const restored = loadDetailPositions(storageTarget(), detailPositionKey.value, new Set(props.regions.map(region => region.id)));
  Object.assign(detailPositions, restored);
});

onMounted(() => {
  const restored = loadDetailPositions(storageTarget(), detailPositionKey.value, new Set(props.regions.map(region => region.id)));
  Object.assign(detailPositions, restored);
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(refreshConnections);
    if (canvas.value) resizeObserver.observe(canvas.value);
  }
  window.addEventListener("resize", refreshConnections);
  requestAnimationFrame(fitAll);
});

onBeforeUnmount(() => {
  if (highlightTimer) clearTimeout(highlightTimer);
  if (connectionFrame) cancelAnimationFrame(connectionFrame);
  resizeObserver?.disconnect();
  window.removeEventListener("resize", refreshConnections);
  stopPointer();
});

defineExpose({ openDetail, closeDetail, refreshConnections, fitAll });
</script>

<template>
  <section ref="canvas" class="pipeline-canvas" @pointerdown="startPan" @wheel="onWheel">
    <div class="grid" />
    <div class="world" :style="{ transform }">
      <svg class="links" width="10000" height="6000" aria-hidden="true">
        <path v-for="link in links" :key="link.id" :d="link.path" />
      </svg>

      <PipelineNode
        node-id="workspace"
        title="工作区"
        :position="fixedPositions.workspace"
        :width="WORKSPACE.width"
        :min-height="WORKSPACE.height"
        :input="false"
        :output="false"
        @drag-start="startNodeDrag"
      >
        <slot />
      </PipelineNode>

      <PipelineNode
        v-for="region in openedRegions"
        :key="region.id"
        :node-id="detailNodeId(region.id)"
        title="区域详情"
        :position="detailPositions[region.id]!"
        :width="DETAIL.width"
        :min-height="DETAIL.height"
        :input="true"
        :output="false"
        :closable="true"
        :highlighted="highlightedRegionId === region.id"
        @drag-start="startNodeDrag"
        @close="closeDetail(region.id)"
      >
        <template #status><span>{{ region.displayName }}</span></template>
        <slot
          v-if="elementStores.get(region.id)"
          name="detail"
          :region="region"
          :element-store="elementStores.get(region.id)!"
          :hovered-id="detailHoveredIds[region.id] ?? null"
          :set-hovered-id="(id: string | null) => setDetailHovered(region.id, id)"
        />
      </PipelineNode>

      <PipelineNode
        v-if="props.showCode"
        node-id="code"
        title="代码产出"
        :position="fixedPositions.code"
        :width="CODE.width"
        :min-height="CODE.height"
        :input="false"
        :output="false"
        @drag-start="startNodeDrag"
      >
        <slot name="code" />
      </PipelineNode>
    </div>

    <div class="controls" @pointerdown.stop>
      <button type="button" title="缩小" @click="zoomBy(0.8)">−</button>
      <span>{{ Math.round(viewport.zoom * 100) }}%</span>
      <button type="button" title="放大" @click="zoomBy(1.25)">＋</button>
      <button type="button" title="适配全部节点" @click="fitAll">适配</button>
    </div>
  </section>
</template>

<style scoped>
.pipeline-canvas { position: relative; width: 100%; height: 100vh; overflow: hidden; color: var(--text); background: var(--bg-canvas); user-select: none; }
.grid { position: absolute; inset: 0; background-image: radial-gradient(circle, var(--grid-dot) 1px, transparent 1px); background-size: 24px 24px; pointer-events: none; }
.world { position: absolute; top: 0; left: 0; width: 10000px; height: 6000px; transform-origin: 0 0; }
.links { position: absolute; inset: 0; overflow: visible; pointer-events: none; }
.links path { fill: none; stroke: var(--line); stroke-width: 2; vector-effect: non-scaling-stroke; }
.controls { position: fixed; right: 18px; bottom: 18px; z-index: 30; display: flex; align-items: center; gap: 6px; padding: 6px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-panel); box-shadow: 0 8px 20px #0006; }
.controls button { min-width: 28px; height: 28px; padding: 0 8px; border: 1px solid var(--border); border-radius: 5px; color: var(--text-dim); background: var(--bg-inset); cursor: pointer; }
.controls span { min-width: 44px; color: var(--text-faint); font-size: 11px; text-align: center; }
</style>
