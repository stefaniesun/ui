<script setup lang="ts">
import type { Region } from "@region-split/core/browser";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import type { ElementStore } from "../element-state.js";
import {
  createRegionDetailLayout,
  normalizeRegionDetailLayout,
  saveRegionDetailLayout,
  type RegionDetailLayout,
} from "../region-detail-layout.js";
import { regionColor } from "../region-visual.js";
import {
  bezierPath,
  canStartPan,
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
import PageCompareNode from "./nodes/PageCompareNode.vue";
import type { PageCodeOutput } from "../api.js";

const props = withDefaults(defineProps<{
  regions?: Region[];
  projectId?: string;
  getRegionAnchor?: (regionId: string) => Point | null;
  createElementStore?: () => ElementStore;
  pageApi?: { getPageCode(projectId: string): Promise<PageCodeOutput> };
  imageSize?: { w: number; h: number };
  storage?: Storage;
}>(), {
  regions: () => [],
  projectId: "",
  getRegionAnchor: undefined,
  createElementStore: undefined,
  pageApi: undefined,
  imageSize: () => ({ w: 1, h: 1 }),
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
const detailLayouts = reactive<Record<string, RegionDetailLayout>>({});
const openRegionIds = ref<string[]>([]);
const pageOpen = ref(false);
const elementStores = new Map<string, ElementStore>();
const detailHoveredIds = reactive<Record<string, string | null>>({});
const highlightedRegionId = ref<string | null>(null);
const connectionStarts = reactive<Record<string, Point>>({});
let highlightTimer: ReturnType<typeof setTimeout> | undefined;
let connectionFrame = 0;
let drag: { nodeId: string; start: Point; origin: Point } | null = null;
let frameResize: { regionId: string; direction: "right" | "bottom" | "corner"; start: Point; origin: RegionDetailLayout } | null = null;
let pan: { start: Point; origin: Point } | null = null;
let resizeObserver: ResizeObserver | undefined;

const WORKSPACE = { width: 1105, height: 700 };
const DETAIL = { width: 1280, height: 600 };
const PAGE = { width: 760, height: 760 };

const regionById = computed(() => new Map(props.regions.map(region => [region.id, region])));
const openedRegions = computed(() => openRegionIds.value.flatMap(id => {
  const region = regionById.value.get(id);
  return region ? [region] : [];
}));
const transform = computed(() => `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`);
const detailPositionKey = computed(() => `region-split:detail-node-positions:${props.projectId}:v1`);
const links = computed(() => {
  const regionLinks = openedRegions.value.flatMap(region => {
    const from = connectionStarts[region.id];
    const toPosition = detailPositions[region.id];
    if (!from || !toPosition) return [];
    return [{
      id: `region:${region.id}`,
      color: regionColor(region.id),
      path: bezierPath(from, { x: toPosition.x, y: toPosition.y + 21 }),
    }];
  });
  const pageLink = pageOpen.value ? [{
    id: "page",
    color: "#94a3b8",
    path: bezierPath(
      { x: fixedPositions.workspace.x + WORKSPACE.width, y: fixedPositions.workspace.y + 21 },
      { x: fixedPositions.page.x, y: fixedPositions.page.y + 21 },
    ),
  }] : [];
  return [...regionLinks, ...pageLink];
});

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
  const layout = detailLayouts[regionId];
  if (!layout) return null;
  return { ...position, width: layout.width, height: layout.height };
}

function occupiedNodeBounds(): Bounds[] {
  const detailBoundsList = openRegionIds.value.flatMap(id => {
    const detail = detailBounds(id);
    return detail ? [detail] : [];
  });
  const pageBounds = pageOpen.value ? [{ ...fixedPositions.page, ...PAGE }] : [];
  return [...detailBoundsList, ...pageBounds];
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
  const layout = createRegionDetailLayout(storageTarget());
  detailLayouts[regionId] = layout;
  if (!detailPositions[regionId]) {
    detailPositions[regionId] = nextDetailPosition(
      { ...fixedPositions.workspace, ...WORKSPACE },
      occupiedNodeBounds(),
      { width: layout.width, height: layout.height },
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
  delete detailLayouts[regionId];
  delete detailHoveredIds[regionId];
  delete connectionStarts[regionId];
  if (highlightedRegionId.value === regionId) highlightedRegionId.value = null;
}

function openPageCompare(): void {
  if (!props.projectId || !props.pageApi) return;
  pageOpen.value = true;
  persist();
  nextTick(() => {
    const rect = canvas.value?.getBoundingClientRect();
    if (rect) Object.assign(viewport, centerNodeViewport({ ...fixedPositions.page, ...PAGE }, { width: rect.width, height: rect.height }, viewport.zoom));
    refreshConnections();
  });
}

function closePageCompare(): void {
  pageOpen.value = false;
}

function setDetailHovered(regionId: string, id: string | null): void {
  detailHoveredIds[regionId] = id;
}

function updateDetailLayout(regionId: string, patch: Partial<RegionDetailLayout>): void {
  const current = detailLayouts[regionId];
  if (!current) return;
  Object.assign(current, normalizeRegionDetailLayout({ ...current, ...patch }));
  refreshConnections();
}

function saveDetailLayout(regionId: string): void {
  const current = detailLayouts[regionId];
  if (!current) return;
  Object.assign(current, saveRegionDetailLayout(storageTarget(), current));
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
  listenPointer();
}

function startFrameResize(event: PointerEvent, nodeId: string, direction: "right" | "bottom" | "corner"): void {
  if (event.button !== 0 || !nodeId.startsWith("detail:")) return;
  const regionId = nodeId.slice(7);
  const layout = detailLayouts[regionId];
  if (!layout) return;
  frameResize = { regionId, direction, start: { x: event.clientX, y: event.clientY }, origin: { ...layout } };
  listenPointer();
}

function listenPointer(): void {
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", stopPointer);
  window.addEventListener("pointercancel", stopPointer);
}

function startPan(event: PointerEvent): void {
  if (event.button !== 0 || !canStartPan(event.target, canvas.value)) return;
  pan = { start: { x: event.clientX, y: event.clientY }, origin: { x: viewport.x, y: viewport.y } };
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", stopPointer);
  window.addEventListener("pointercancel", stopPointer);
}

function onPointerMove(event: PointerEvent): void {
  if (frameResize) {
    const dx = (event.clientX - frameResize.start.x) / viewport.zoom;
    const dy = (event.clientY - frameResize.start.y) / viewport.zoom;
    updateDetailLayout(frameResize.regionId, {
      width: frameResize.direction === "bottom" ? frameResize.origin.width : frameResize.origin.width + dx,
      height: frameResize.direction === "right" ? frameResize.origin.height : frameResize.origin.height + dy,
    });
  } else if (drag) {
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
  frameResize = null;
  pan = null;
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", stopPointer);
  window.removeEventListener("pointercancel", stopPointer);
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
  if (pageOpen.value) bounds.push({ ...fixedPositions.page, ...PAGE });
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
  pageOpen.value = false;
  elementStores.clear();
  for (const id of Object.keys(detailPositions)) delete detailPositions[id];
  for (const id of Object.keys(connectionStarts)) delete connectionStarts[id];
  for (const id of Object.keys(detailHoveredIds)) delete detailHoveredIds[id];
  const validIds = new Set(props.regions.map(region => region.id));
  const restoredDetail = loadDetailPositions(storageTarget(), detailPositionKey.value, validIds);
  Object.assign(detailPositions, restoredDetail);
});

onMounted(() => {
  const validIds = new Set(props.regions.map(region => region.id));
  const restoredDetail = loadDetailPositions(storageTarget(), detailPositionKey.value, validIds);
  Object.assign(detailPositions, restoredDetail);
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(refreshConnections);
    if (canvas.value) {
      resizeObserver.observe(canvas.value);
      const workspaceNode = canvas.value.querySelector('[data-node-id="workspace"]');
      if (workspaceNode) resizeObserver.observe(workspaceNode);
    }
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

defineExpose({ openDetail, closeDetail, openPageCompare, closePageCompare, refreshConnections, fitAll });
</script>

<template>
  <section ref="canvas" class="pipeline-canvas" @pointerdown="startPan" @wheel="onWheel">
    <div class="grid" />
    <div class="world" :style="{ transform }">
      <svg class="links" width="10000" height="6000" aria-hidden="true">
        <path v-for="link in links" :key="link.id" :d="link.path" :stroke="link.color" />
      </svg>

      <PipelineNode
        node-id="workspace"
        title="工作区"
        :position="fixedPositions.workspace"
        :width="WORKSPACE.width"
        :min-height="WORKSPACE.height"
        :input="false"
        :output="pageOpen"
        @drag-start="startNodeDrag"
      >
        <slot />
      </PipelineNode>

      <PipelineNode
        v-if="pageOpen"
        node-id="page"
        title="整页比对"
        :position="fixedPositions.page"
        :width="PAGE.width"
        :min-height="PAGE.height"
        :input="true"
        :output="false"
        :closable="true"
        @drag-start="startNodeDrag"
        @close="closePageCompare"
      >
        <PageCompareNode :project-id="props.projectId" :api="props.pageApi!" :image-size="props.imageSize!" />
      </PipelineNode>

      <PipelineNode
        v-for="region in openedRegions"
        :key="region.id"
        :node-id="detailNodeId(region.id)"
        title="区域详情"
        :position="detailPositions[region.id]!"
        :width="detailLayouts[region.id]?.width ?? DETAIL.width"
        :height="detailLayouts[region.id]?.height ?? DETAIL.height"
        :min-height="0"
        :resizable="true"
        :input="true"
        :output="false"
        :closable="true"
        :highlighted="highlightedRegionId === region.id"
        :accent-color="regionColor(region.id)"
        @drag-start="startNodeDrag"
        @resize-start="startFrameResize"
        @close="closeDetail(region.id)"
      >
        <template #status><span>{{ region.displayName }}</span></template>
        <slot
          v-if="elementStores.get(region.id)"
          name="detail"
          :region="region"
          :element-store="elementStores.get(region.id)!"
          :hovered-id="detailHoveredIds[region.id] ?? null"
          :layout="detailLayouts[region.id]!"
          :set-hovered-id="(id: string | null) => setDetailHovered(region.id, id)"
          :update-layout="(patch: Partial<RegionDetailLayout>) => updateDetailLayout(region.id, patch)"
          :save-layout="() => saveDetailLayout(region.id)"
        />
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
.links path { fill: none; stroke-width: 2; vector-effect: non-scaling-stroke; }
.controls { position: fixed; right: 18px; bottom: 18px; z-index: 30; display: flex; align-items: center; gap: 6px; padding: 6px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-panel); box-shadow: 0 8px 20px #0006; }
.controls button { min-width: 28px; height: 28px; padding: 0 8px; border: 1px solid var(--border); border-radius: 5px; color: var(--text-dim); background: var(--bg-inset); cursor: pointer; }
.controls span { min-width: 44px; color: var(--text-faint); font-size: 11px; text-align: center; }
</style>
