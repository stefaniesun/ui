<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { elementKinds, type ElementKind, type PageOutline, type PageOutlineElement, type Rect } from "@region-split/core/browser";
import { KIND_COLOR, KIND_LABEL } from "../element-kind-display.js";
import { DEFAULT_FONT_STACK, FONT_STACKS } from "../font-stacks.js";
import { DEFAULT_VIEW, fitView, keepViewportCenter, zoomAt, type CanvasSize, type CanvasView } from "../infinite-canvas-view.js";
import {
  DEFAULT_PANEL_WIDTHS,
  DEFAULT_WORKSPACE_HEIGHT,
  MAX_PROPERTY_WIDTH,
  MIN_PANEL_WIDTHS,
  SPLITTER_SIZE,
  TREE_RESTORE_WIDTH,
  collapsedWorkspaceWidth,
  expandedWorkspaceWidth,
  resetPanelBoundary,
  resizePanelBoundary,
  type PanelBoundary,
  type PanelWidths,
  type ResettablePanelBoundary,
} from "../panel-layout.js";
import type { AnalysisStats } from "../api.js";

const props = defineProps<{
  projectId: string;
  outline: PageOutline;
  selectedId: string | null;
  hoveredId?: string | null;
  busy?: boolean;
  progressText?: string;
  error?: string;
  fontStack?: string;
  stats?: AnalysisStats | null;
  exporting?: boolean;
}>();
const emit = defineEmits<{
  select: [id: string];
  hover: [id: string | null];
  retry: [];
  fontStack: [value: string];
  exportPage: [];
  openPageCompare: [];
  refreshModelConfig: [];
  patch: [id: string, patch: { kind?: ElementKind; text?: string; box?: Rect }];
}>();
const treeRefs = new Map<string, HTMLElement>();
const boxRefs = new Map<string, HTMLElement>();
const collapsedIds = ref(new Set<string>());
const treePanelCollapsed = ref(false);
const editKind = ref<ElementKind>("text");
const editText = ref("");
const editBox = ref<Rect>({ x: 0, y: 0, w: 4, h: 4 });

const selected = computed(() => props.outline.elements.find(element => element.id === props.selectedId) ?? null);
const imageSrc = computed(() => `/api/projects/${encodeURIComponent(props.projectId)}/image`);
const ordered = computed(() => props.outline.elements);
const elementById = computed(() => new Map(props.outline.elements.map(node => [node.id, node])));
const validParentById = computed(() => {
  const parents = new Map<string, string>();
  for (const node of props.outline.elements) {
    const parentId = node.parentHint;
    if (parentId && parentId !== node.id && elementById.value.has(parentId)) parents.set(node.id, parentId);
  }
  const cyclicIds = new Set<string>();
  for (const node of props.outline.elements) {
    const path: string[] = [];
    const indexById = new Map<string, number>();
    let currentId: string | undefined = node.id;
    while (currentId && parents.has(currentId)) {
      const cycleStart = indexById.get(currentId);
      if (cycleStart !== undefined) {
        for (const id of path.slice(cycleStart)) cyclicIds.add(id);
        break;
      }
      indexById.set(currentId, path.length);
      path.push(currentId);
      currentId = parents.get(currentId);
    }
  }
  for (const id of cyclicIds) parents.delete(id);
  return parents;
});
const childrenById = computed(() => {
  const children = new Map<string, string[]>();
  for (const [childId, parentId] of validParentById.value) {
    const siblings = children.get(parentId) ?? [];
    siblings.push(childId);
    children.set(parentId, siblings);
  }
  return children;
});
function ancestorsOf(id: string) {
  const ancestors: string[] = [];
  let currentId: string | undefined = id;
  while (currentId && validParentById.value.has(currentId)) {
    const parentId: string = validParentById.value.get(currentId)!;
    ancestors.push(parentId);
    currentId = parentId;
  }
  return ancestors;
}
const visibleNodes = computed(() => ordered.value.filter(node =>
  !ancestorsOf(node.id).some(parentId => collapsedIds.value.has(parentId)),
));
function displayDepth(id: string) { return ancestorsOf(id).length; }
// 「还没轮到」和「跑失败了」要分开：合成一个数字时，解析还在进行中的界面
// 和真的失败了的界面长得一模一样，人没法判断该等还是该重跑。
const failedRegions = computed(() => props.outline.regions.filter(region => region.status === "failed"));
const missingRegions = computed(() => props.outline.regions.filter(region => region.status === "missing"));
const retryLabel = computed(() => {
  const failed = failedRegions.value.length;
  const missing = missingRegions.value.length;
  if (failed && missing) return `重跑失败 ${failed} · 未解析 ${missing}`;
  if (failed) return `重跑失败区域（${failed}）`;
  return `解析剩余区域（${missing}）`;
});

function boxStyle(node: PageOutlineElement) {
  const { width, height } = props.outline.image;
  return {
    left: `${node.box.x / width * 100}%`, top: `${node.box.y / height * 100}%`,
    width: `${node.box.w / width * 100}%`,     height: `${node.box.h / height * 100}%`,
    "--kind-color": KIND_COLOR[node.kind],
  };
}
function toggleNode(id: string) {
  const next = new Set(collapsedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsedIds.value = next;
}
const FIT_PADDING = 32;
const ZOOM_STEP = 0.1;
const DRAG_THRESHOLD = 4;
const canvasViewport = ref<HTMLElement | null>(null);
const canvasStage = ref<HTMLElement | null>(null);
const pageScroll = ref<HTMLElement | null>(null);
const pageStage = ref<HTMLElement | null>(null);
const view = ref<CanvasView>({ ...DEFAULT_VIEW });
const viewportSize = ref<CanvasSize>({ width: 0, height: 0 });
const stageSize = ref<CanvasSize>({ width: 0, height: 0 });
const userChangedView = ref(false);
let hasValidInitialView = false;
let imageLoadCorrectionPending = true;
let resizeObserver: ResizeObserver | null = null;
const spacePressed = ref(false);
const isPanning = ref(false);
const isResizingPanels = ref(false);
const panelWidths = ref<PanelWidths>({ ...DEFAULT_PANEL_WIDTHS });
let panFrom: { pointerId: number; button: number; x: number; y: number; viewX: number; viewY: number; moved: boolean } | null = null;
let resizeFrom: { pointerId: number; boundary: PanelBoundary; x: number; widths: PanelWidths; target: HTMLElement } | null = null;
let suppressClick = false;
const zoomLabel = computed(() => `${Math.round(view.value.scale * 100)}%`);
const workspaceHeight = computed(() => hasSize(viewportSize.value) ? viewportSize.value.height : DEFAULT_WORKSPACE_HEIGHT);
const workspaceWidth = computed(() => treePanelCollapsed.value
  ? collapsedWorkspaceWidth(panelWidths.value)
  : expandedWorkspaceWidth(panelWidths.value));
const canvasStageStyle = computed(() => ({
  width: `${workspaceWidth.value}px`,
  height: `${workspaceHeight.value}px`,
  gridTemplateColumns: treePanelCollapsed.value
    ? `${panelWidths.value.image}px ${TREE_RESTORE_WIDTH}px ${panelWidths.value.property}px`
    : `${panelWidths.value.image}px ${SPLITTER_SIZE}px ${panelWidths.value.tree}px ${SPLITTER_SIZE}px ${panelWidths.value.property}px`,
  transform: `translate3d(${view.value.x}px, ${view.value.y}px, 0) scale(${view.value.scale})`,
}));
const pageStageStyle = computed(() => ({
  aspectRatio: `${props.outline.image.width} / ${props.outline.image.height}`,
}));

function measure(element: HTMLElement | null): CanvasSize {
  if (!element) return { width: 0, height: 0 };
  return { width: element.clientWidth, height: element.clientHeight };
}
function hasSize(size: CanvasSize) {
  return Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0;
}
function fitCanvas(markAsUserAction = true) {
  viewportSize.value = measure(canvasViewport.value);
  stageSize.value = measure(canvasStage.value);
  view.value = fitView(viewportSize.value, stageSize.value, FIT_PADDING);
  if (markAsUserAction) userChangedView.value = true;
}
function zoomBy(step: number) {
  const anchor = { x: viewportSize.value.width / 2, y: viewportSize.value.height / 2 };
  view.value = zoomAt(view.value, view.value.scale + step, anchor);
  userChangedView.value = true;
}
function setActualSize() {
  const anchor = { x: viewportSize.value.width / 2, y: viewportSize.value.height / 2 };
  view.value = zoomAt(view.value, 1, anchor);
  userChangedView.value = true;
}
function pointInViewport(event: MouseEvent | WheelEvent) {
  const rect = canvasViewport.value?.getBoundingClientRect();
  return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
}
function isScrollablePanel(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("[data-scroll-panel='true'], .tree-panel-restore"));
}
function onCanvasWheel(event: WheelEvent) {
  if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return;
  if (isScrollablePanel(event.target) && !event.ctrlKey) return;
  const anchor = pointInViewport(event);
  if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return;
  event.preventDefault();
  const direction = event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
  view.value = zoomAt(view.value, view.value.scale + direction, anchor);
  userChangedView.value = true;
}
function onCanvasDoubleClick(event: MouseEvent) {
  if (event.target === canvasViewport.value) fitCanvas();
}
function measureCanvas() {
  const previousViewport = viewportSize.value;
  const previousStage = stageSize.value;
  viewportSize.value = measure(canvasViewport.value);
  stageSize.value = measure(canvasStage.value);
  if (!hasSize(viewportSize.value) || !hasSize(stageSize.value)) return;
  if (!hasValidInitialView) {
    fitCanvas(false);
    hasValidInitialView = true;
    return;
  }
  const viewportChanged = hasSize(previousViewport)
    && (previousViewport.width !== viewportSize.value.width || previousViewport.height !== viewportSize.value.height);
  if (viewportChanged) {
    view.value = keepViewportCenter(view.value, previousViewport, viewportSize.value);
  }
}
function onImageLoad() {
  if (!imageLoadCorrectionPending) return;
  imageLoadCorrectionPending = false;
  const previousStage = stageSize.value;
  stageSize.value = measure(canvasStage.value);
  viewportSize.value = measure(canvasViewport.value);
  if (!userChangedView.value
    && (!hasValidInitialView || previousStage.width !== stageSize.value.width || previousStage.height !== stageSize.value.height)) {
    fitCanvas(false);
    hasValidInitialView = hasSize(viewportSize.value) && hasSize(stageSize.value);
  }
}
function isEditable(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, button, [contenteditable='true']"));
}
function isDirectPanSurface(target: EventTarget | null) {
  if (target === canvasViewport.value) return true;
  return target instanceof Element && Boolean(target.closest(".page-scroll") && !target.closest(".element-box"));
}
function onKeyDown(event: KeyboardEvent) {
  if (event.code !== "Space" || event.repeat || isEditable(document.activeElement)) return;
  spacePressed.value = true;
  event.preventDefault();
}
function onKeyUp(event: KeyboardEvent) {
  if (event.code === "Space") spacePressed.value = false;
}
function onPanStart(event: PointerEvent) {
  const viewport = canvasViewport.value;
  if (!viewport || panFrom || isResizingPanels.value) return;
  const leftAllowed = event.button === 0 && (!isEditable(document.activeElement) && spacePressed.value || isDirectPanSurface(event.target));
  const middleAllowed = event.button === 1;
  if (!leftAllowed && !middleAllowed) return;
  event.preventDefault();
  viewport.setPointerCapture?.(event.pointerId);
  panFrom = { pointerId: event.pointerId, button: event.button, x: event.clientX, y: event.clientY, viewX: view.value.x, viewY: view.value.y, moved: false };
}
function onPanMove(event: PointerEvent) {
  if (!panFrom || panFrom.pointerId !== event.pointerId) return;
  const dx = event.clientX - panFrom.x;
  const dy = event.clientY - panFrom.y;
  if (!panFrom.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
  panFrom.moved = true;
  isPanning.value = true;
  userChangedView.value = true;
  view.value = { ...view.value, x: panFrom.viewX + dx, y: panFrom.viewY + dy };
}
function endPan(event?: PointerEvent, suppressReleasedClick = true) {
  if (!panFrom || event && panFrom.pointerId !== event.pointerId) return;
  const pointerId = panFrom.pointerId;
  suppressClick = suppressReleasedClick && panFrom.moved && panFrom.button === 0;
  const viewport = canvasViewport.value;
  if (viewport?.hasPointerCapture?.(pointerId)) viewport.releasePointerCapture(pointerId);
  panFrom = null;
  isPanning.value = false;
}
function cancelPan(event?: PointerEvent) {
  if (!panFrom) return;
  endPan(event, false);
  suppressClick = false;
}
function onPanClick(event: MouseEvent) {
  if (!suppressClick) return;
  suppressClick = false;
  event.preventDefault();
  event.stopPropagation();
}
function onResizeStart(boundary: PanelBoundary, event: PointerEvent) {
  event.preventDefault();
  event.stopPropagation();
  if (event.button !== 0 || resizeFrom) return;
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return;
  target.setPointerCapture?.(event.pointerId);
  resizeFrom = { pointerId: event.pointerId, boundary, x: event.clientX, widths: { ...panelWidths.value }, target };
  isResizingPanels.value = true;
}
function onResizeMove(event: PointerEvent) {
  if (!resizeFrom || resizeFrom.pointerId !== event.pointerId) return;
  event.preventDefault();
  event.stopPropagation();
  const scale = Number.isFinite(view.value.scale) && view.value.scale > 0 ? view.value.scale : 1;
  panelWidths.value = resizePanelBoundary(resizeFrom.widths, resizeFrom.boundary, (event.clientX - resizeFrom.x) / scale);
}
function endResize(event?: PointerEvent) {
  event?.preventDefault();
  event?.stopPropagation();
  if (!resizeFrom || event && resizeFrom.pointerId !== event.pointerId) return;
  const { pointerId, target } = resizeFrom;
  resizeFrom = null;
  isResizingPanels.value = false;
  if (event?.type !== "lostpointercapture" && target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);
}
function resetBoundary(boundary: ResettablePanelBoundary, event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  panelWidths.value = resetPanelBoundary(panelWidths.value, boundary);
}
function onPropertyEdgeKeydown(event: KeyboardEvent) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  event.stopPropagation();
  const direction = event.key === "ArrowRight" ? 1 : -1;
  const step = event.shiftKey ? 48 : 16;
  panelWidths.value = resizePanelBoundary(panelWidths.value, "property-edge", direction * step);
}
function collapseTreePanel() {
  endResize();
  treePanelCollapsed.value = true;
}
function onWindowBlur() {
  spacePressed.value = false;
  cancelPan();
  endResize();
}
onMounted(() => {
  measureCanvas();
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onWindowBlur);
  if (typeof ResizeObserver === "undefined") return;
  resizeObserver = new ResizeObserver(measureCanvas);
  if (canvasViewport.value) resizeObserver.observe(canvasViewport.value);
  if (canvasStage.value) resizeObserver.observe(canvasStage.value);
});
onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
  window.removeEventListener("blur", onWindowBlur);
  cancelPan();
  endResize();
});

function expandAncestors(id: string) {
  const ancestors = new Set(ancestorsOf(id));
  if (!ancestors.size) return;
  collapsedIds.value = new Set([...collapsedIds.value].filter(nodeId => !ancestors.has(nodeId)));
}
function revealBox(id: string) {
  const panel = pageScroll.value;
  const target = boxRefs.get(id);
  if (!panel || !target) return;
  const targetTop = target.offsetTop;
  const targetHeight = target.offsetHeight;
  const panelHeight = panel.clientHeight;
  const scrollTop = panel.scrollTop;
  if (![targetTop, targetHeight, panelHeight, scrollTop].every(Number.isFinite) || panelHeight <= 0) return;
  if (targetTop >= scrollTop && targetTop + targetHeight <= scrollTop + panelHeight) return;
  const top = Math.max(0, targetTop - (panelHeight - targetHeight) / 2);
  panel.scrollTo?.({ top, behavior: "auto" });
}
function select(id: string, source: "tree" | "box") {
  if (source === "box") expandAncestors(id);
  emit("select", id);
  nextTick(() => {
    if (source === "tree") revealBox(id);
    else {
      const target = treeRefs.get(id);
      if (typeof target?.scrollIntoView === "function") target.scrollIntoView({ block: "center" });
    }
  });
}
function bindTree(id: string, element: unknown) {
  if (element instanceof HTMLElement) treeRefs.set(id, element);
  else treeRefs.delete(id);
}
function bindBox(id: string, element: unknown) {
  if (element instanceof HTMLElement) boxRefs.set(id, element);
  else boxRefs.delete(id);
}
function restoreTreePanel() {
  treePanelCollapsed.value = false;
  const id = props.selectedId;
  if (!id) return;
  expandAncestors(id);
  nextTick(() => {
    const target = treeRefs.get(id);
    if (typeof target?.scrollIntoView === "function") target.scrollIntoView({ block: "center" });
  });
}
function save() {
  if (!selected.value) return;
  emit("patch", selected.value.id, { kind: editKind.value, text: editText.value, box: { ...editBox.value } });
}
watch(selected, node => {
  if (!node) return;
  editKind.value = node.kind;
  editText.value = node.text ?? "";
  editBox.value = { ...node.box };
}, { immediate: true });
</script>

<template>
  <main class="page-outline" data-test="page-outline">
    <header class="outline-toolbar">
      <div>
        <strong>整页轮廓图</strong>
        <span>可疑项 {{ outline.suspiciousCount }} / {{ outline.elements.length }}</span>
      </div>
      <div class="progress" aria-live="polite">{{ busy ? (progressText || "正在解析全部区域…") : progressText }}</div>
      <button
        v-if="!busy && (failedRegions.length || missingRegions.length)"
        type="button" data-test="retry-failed" @click="emit('retry')"
      >{{ retryLabel }}</button>
    </header>
    <div class="migrated-tools">
      <label class="font-stack-field"><span>目标字体</span>
        <select data-test="font-stack" :value="fontStack || DEFAULT_FONT_STACK.value" @change="emit('fontStack', ($event.target as HTMLSelectElement).value)">
          <option v-for="option in FONT_STACKS" :key="option.id" :value="option.value">{{ option.label }}</option>
        </select>
      </label>
      <button type="button" data-test="export-page" :disabled="exporting" @click="emit('exportPage')">{{ exporting ? "导出中…" : "导出整页代码" }}</button>
      <button type="button" data-test="open-page-compare" @click="emit('openPageCompare')">整页比对</button>
      <button type="button" data-test="refresh-model-config" @click="emit('refreshModelConfig')">刷新模型配置</button>
      <div class="view-controls" data-test="view-controls" aria-label="画布视图控制">
        <button type="button" data-test="zoom-out" aria-label="缩小画布" @click="zoomBy(-ZOOM_STEP)">−</button>
        <output data-test="zoom-level" aria-live="polite">{{ zoomLabel }}</output>
        <button type="button" data-test="zoom-in" aria-label="放大画布" @click="zoomBy(ZOOM_STEP)">+</button>
        <button type="button" data-test="fit-view" @click="fitCanvas()">适应视图</button>
        <button type="button" data-test="actual-size" @click="setActualSize">100%</button>
      </div>
    </div>
    <div v-if="stats" data-test="analysis-stats" class="analysis-stats" :class="{ passed: stats.allPassed }">
      <strong>{{ stats.allPassed ? "分析已完成" : "分析待完善" }}</strong>
      <span>区域 {{ stats.parsedRegions }}/{{ stats.totalRegions }}</span>
      <span>图标 {{ stats.totalIcons }} · SVG {{ stats.libraryIcons }} · PNG {{ stats.cropIcons }} · 待确认 {{ stats.unresolvedIcons }}</span>
      <span>字体 {{ stats.fontStackChosen ? "已选" : "未选" }} · 待测字号 {{ stats.textWithoutSize }}</span>
    </div>
    <ul v-if="stats?.todos.length" data-test="analysis-todos" class="analysis-todos"><li v-for="todo in stats.todos" :key="todo">{{ todo }}</li></ul>
    <p v-if="error" class="error">{{ error }}</p>

    <section
      ref="canvasViewport" class="canvas-viewport" data-test="canvas-viewport"
      :class="{ 'is-panning': isPanning, 'space-pan-ready': spacePressed, 'is-resizing': isResizingPanels }"
      @wheel="onCanvasWheel" @dblclick="onCanvasDoubleClick"
      tabindex="0" aria-label="无限画布工作区"
      @pointerdown="onPanStart" @pointermove="onPanMove"
      @pointerup="endPan" @pointercancel="cancelPan" @lostpointercapture="cancelPan"
      @click.capture="onPanClick" @auxclick.prevent
    >
      <div
        ref="canvasStage" class="outline-workspace canvas-stage" data-test="canvas-stage"
        :class="{ 'tree-panel-collapsed': treePanelCollapsed }" :style="canvasStageStyle"
      >
        <div ref="pageScroll" class="page-scroll" data-test="image-panel" data-scroll-panel="true">
          <div ref="pageStage" class="page-stage" data-test="page-stage" :style="pageStageStyle">
          <img :src="imageSrc" alt="待校准整页截图" @load="onImageLoad" />
          <button
            v-for="node in outline.elements" :key="node.id" :ref="element => bindBox(node.id, element)"
            type="button" class="element-box"
            :class="{ suspicious: node.suspicious, selected: node.id === selectedId, hovered: node.id === hoveredId }"
            :style="boxStyle(node)" :aria-label="`${node.displayName}${node.suspicious ? '，可疑' : ''} 元素框`" :aria-pressed="node.id === selectedId"
            @click="select(node.id, 'box')" @mouseenter="emit('hover', node.id)" @mouseleave="emit('hover', null)"
          />
        </div>
      </div>

      <div
        v-if="!treePanelCollapsed" class="panel-splitter" data-test="splitter-image-tree"
        role="separator" aria-label="调整原图与结构树宽度" aria-orientation="vertical"
        @pointerdown="onResizeStart('image-tree', $event)" @pointermove="onResizeMove"
        @pointerup="endResize" @pointercancel="endResize" @lostpointercapture="endResize"
        @dblclick="resetBoundary('image-tree', $event)"
      />
      <aside v-if="!treePanelCollapsed" class="tree-panel" data-test="tree-panel" data-scroll-panel="true" aria-label="页面结构树">
        <header class="panel-header">
          <strong>结构树</strong>
          <button type="button" data-test="collapse-tree-panel" aria-label="收起结构栏" @click="collapseTreePanel">«</button>
        </header>
        <div class="outline-tree" data-test="outline-tree" role="tree" aria-label="页面元素结构">
          <div
            v-for="node in visibleNodes" :key="node.id" :ref="element => bindTree(node.id, element)"
            class="tree-item" :class="{ suspicious: node.suspicious, selected: node.id === selectedId }"
            role="treeitem" :aria-level="displayDepth(node.id) + 1" :aria-selected="node.id === selectedId"
            :aria-label="`${node.displayName}${node.suspicious ? '，可疑' : ''}`"
            :style="{ paddingLeft: `${7 + displayDepth(node.id) * 14}px` }"
            @mouseenter="emit('hover', node.id)" @mouseleave="emit('hover', null)"
          >
            <button
              v-if="childrenById.has(node.id)" type="button" class="tree-toggle"
              :data-test="`tree-toggle-${node.id}`" :aria-label="`${collapsedIds.has(node.id) ? '展开' : '折叠'} ${node.displayName}`"
              :aria-expanded="!collapsedIds.has(node.id)" @click.stop="toggleNode(node.id)"
            >{{ collapsedIds.has(node.id) ? "›" : "⌄" }}</button>
            <span v-else class="tree-toggle-spacer" />
            <button type="button" class="tree-item-content" @click="select(node.id, 'tree')">
              <span>{{ node.outlineNumber }}</span><strong>{{ node.displayName }}</strong><small>{{ KIND_LABEL[node.kind] }}</small>
            </button>
          </div>
        </div>
      </aside>
      <button
        v-else type="button" class="tree-panel-restore" data-test="restore-tree-panel"
        aria-label="展开结构栏" @click="restoreTreePanel"
      ><span>›</span><span>结构</span></button>

      <div
        v-if="!treePanelCollapsed" class="panel-splitter" data-test="splitter-tree-property"
        role="separator" aria-label="调整结构树与属性栏宽度" aria-orientation="vertical"
        @pointerdown="onResizeStart('tree-property', $event)" @pointermove="onResizeMove"
        @pointerup="endResize" @pointercancel="endResize" @lostpointercapture="endResize"
        @dblclick="resetBoundary('tree-property', $event)"
      />
      <aside class="property-panel" data-test="property-panel" data-scroll-panel="true" aria-label="元素属性编辑">
        <div
          class="property-edge-resizer" data-test="property-edge-resizer"
          role="separator" aria-label="调整属性栏宽度" aria-orientation="vertical"
          tabindex="0" :aria-valuemin="MIN_PANEL_WIDTHS.property" :aria-valuemax="MAX_PROPERTY_WIDTH" :aria-valuenow="Math.round(panelWidths.property)"
          @pointerdown="onResizeStart('property-edge', $event)" @pointermove="onResizeMove"
          @pointerup="endResize" @pointercancel="endResize" @lostpointercapture="endResize"
          @keydown="onPropertyEdgeKeydown"
        />
        <div class="property-content-scroll" data-test="property-content-scroll" data-scroll-panel="true">
        <form v-if="selected" class="calibration" data-test="calibration" @submit.prevent="save">
          <header class="property-heading">
            <div><small>{{ selected.outlineNumber }} · {{ selected.regionName }}</small><strong>{{ selected.displayName }}</strong></div>
            <span v-if="selected.suspicious" class="suspicious-badge">可疑</span>
          </header>
          <label>分类
            <select v-model="editKind" data-test="calibration-kind">
              <option v-for="kind in elementKinds" :key="kind" :value="kind">{{ KIND_LABEL[kind] }}</option>
            </select>
          </label>
          <label>文字<input v-model="editText" data-test="calibration-text" /></label>
          <div class="rect-fields">
            <label v-for="field in ([['x', '横坐标'], ['y', '纵坐标'], ['w', '宽'], ['h', '高']] as const)" :key="field[0]">{{ field[1] }}
              <input v-model.number="editBox[field[0]]" type="number" :min="field[0] === 'w' || field[0] === 'h' ? 4 : 0" />
            </label>
          </div>
          <button type="submit" data-test="save-calibration">保存校准</button>
        </form>
        <div v-else class="property-empty" data-test="property-empty">选择元素后编辑属性</div>
        </div>
        </aside>
      </div>
    </section>
  </main>
</template>

<style scoped>
.page-outline { height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; color: var(--text, #e5e7eb); background: #11151d; }
.outline-toolbar { min-height: 52px; padding: 8px 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid #2a3342; background: #171c25; }
.outline-toolbar div:first-child { display: flex; align-items: baseline; gap: 10px; }
.outline-toolbar span, .progress { color: #93a4bb; font-size: 12px; }
.outline-toolbar button, .calibration button, .migrated-tools button { border: 1px solid #3979d1; border-radius: 5px; padding: 6px 10px; color: #cfe3ff; background: #19365d; cursor: pointer; }
.migrated-tools { min-height: 42px; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 10px; padding: 5px 14px; border-bottom: 1px solid #2a3342; background: #141a24; }.font-stack-field { display: flex; align-items: center; gap: 7px; color: #93a4bb; font-size: 11px; }.font-stack-field select { height: 30px; max-width: 180px; border: 1px solid #354155; border-radius: 5px; color: #dce7f5; background: #101620; }.view-controls { display: flex; align-items: center; gap: 6px; }.view-controls output { min-width: 48px; color: #cfe3ff; text-align: center; font-variant-numeric: tabular-nums; }
.analysis-stats { display: flex; gap: 14px; align-items: center; padding: 7px 14px; border-bottom: 1px solid #4c3818; color: #fbbf24; background: #2a2113; font-size: 11px; }.analysis-stats.passed { color: #86efac; background: #13271d; }.analysis-todos { display: flex; gap: 16px; margin: 0; padding: 5px 24px; overflow-x: auto; color: #93a4bb; background: #151a23; font-size: 10px; }
.error { margin: 0; padding: 6px 14px; color: #ffb4b4; background: #501f28; }
.canvas-viewport { position: relative; flex: 1; min-height: 0; overflow: hidden; background-color: #0c1017; background-image: radial-gradient(circle, #263244 1px, transparent 1px); background-size: 24px 24px; cursor: grab; touch-action: none; }.canvas-viewport.is-panning { cursor: grabbing; }.canvas-viewport.space-pan-ready { cursor: grab; }
.outline-workspace { position: absolute; top: 0; left: 0; display: grid; align-items: stretch; overflow: hidden; transform-origin: 0 0; will-change: transform; box-shadow: 0 12px 42px #000b; }
.page-scroll { min-width: 0; min-height: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; background: #0c1017; }
.panel-splitter { position: relative; min-width: 0; background: #111722; cursor: col-resize; touch-action: none; user-select: none; }
.panel-splitter::after { content: ""; position: absolute; inset: 0 2px; background: #354155; }
.panel-splitter:hover::after, .panel-splitter:focus-visible::after { background: #3b82f6; }
.canvas-viewport.is-resizing, .canvas-viewport.is-resizing * { cursor: col-resize !important; user-select: none !important; }
.page-stage { position: relative; width: 100%; min-width: 0; margin: 0; line-height: 0; }
.page-stage > img { display: block; width: 100%; height: auto; }
.element-box { position: absolute; padding: 0; border: 1px solid var(--kind-color); background: color-mix(in srgb, var(--kind-color) 10%, transparent); cursor: pointer; }
.element-box:hover, .element-box.hovered { border-color: var(--kind-color); background: color-mix(in srgb, var(--kind-color) 22%, transparent); }
.element-box.suspicious { z-index: 2; border: 2px solid #ffb020; background: #ff9d0029; }
.element-box.selected { z-index: 3; border: 2px solid #30d5ff; background: #00bce83b; }
.tree-panel, .property-panel { min-width: 0; min-height: 0; overflow: hidden; border-left: 1px solid #2a3342; background: #151a23; }
.tree-panel { display: flex; flex-direction: column; }
.property-panel { position: relative; overflow: hidden; }
.property-content-scroll { height: 100%; min-height: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; }
.property-edge-resizer { position: absolute; z-index: 3; top: 0; right: 0; bottom: 0; width: 8px; cursor: col-resize; touch-action: none; user-select: none; }
.property-edge-resizer::after { content: ""; position: absolute; top: 0; right: 0; bottom: 0; width: 2px; background: transparent; }
.property-edge-resizer:hover::after, .property-edge-resizer:focus-visible::after { background: #3b82f6; }
.panel-header, .property-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px; border-bottom: 1px solid #2a3342; }
.panel-header button { border: 1px solid #354155; border-radius: 4px; color: #93a4bb; background: #202938; cursor: pointer; }
.property-heading { margin: -10px -10px 2px; }.property-heading div { min-width: 0; display: grid; gap: 3px; }.property-heading small { color: #8192aa; }.property-heading strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.suspicious-badge { border: 1px solid #b66d13; border-radius: 999px; padding: 2px 7px; color: #ffd38a; background: #4a2e0d; font-size: 11px; }
.tree-panel-restore { min-width: 0; border: 0; border-left: 1px solid #2a3342; color: #93a4bb; background: #151a23; cursor: pointer; writing-mode: vertical-rl; }
.outline-tree { flex: 1; min-height: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; padding: 8px; }
.tree-item { width: 100%; display: grid; grid-template-columns: 24px minmax(0, 1fr); align-items: center; border: 1px solid transparent; border-radius: 5px; color: #cad5e3; background: transparent; }
.tree-item:hover { background: #202938; }.tree-item.suspicious { color: #ffd38a; }.tree-item.selected { border-color: #30d5ff; background: #183b4a; }
.tree-toggle, .tree-item-content { border: 0; color: inherit; background: transparent; cursor: pointer; }
.tree-toggle { width: 24px; height: 30px; padding: 0; font-size: 18px; }.tree-toggle-spacer { width: 24px; }
.tree-item-content { min-width: 0; display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; gap: 7px; align-items: center; padding: 7px 7px 7px 0; text-align: left; }
.tree-item-content strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.tree-item small { color: #8192aa; }.calibration { padding: 10px; display: grid; gap: 8px; }
.calibration label { display: grid; gap: 3px; color: #93a4bb; font-size: 11px; }.calibration input, .calibration select { min-width: 0; padding: 5px; border: 1px solid #354155; border-radius: 4px; color: #e7edf6; background: #10151d; }
.rect-fields { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; }
.property-empty { display: grid; min-height: 180px; place-items: center; padding: 24px; color: #8192aa; text-align: center; }

@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; transition: none !important; } }
</style>
