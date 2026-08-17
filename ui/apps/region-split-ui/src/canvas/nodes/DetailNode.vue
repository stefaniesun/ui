<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ElementKind, Rect, Region } from "@region-split/core/browser";
import { regionImageUrl } from "../../api.js";
import ElementOverlay from "../../components/ElementOverlay.vue";
import ElementProperties from "../../components/ElementProperties.vue";
import ElementRefactorPanel from "../../components/ElementRefactorPanel.vue";
import ElementTree from "../../components/ElementTree.vue";
import { elementRefactorApi } from "../../element-refactor-api.js";
import { createElementRefactorStore } from "../../element-refactor-state.js";
import { elementNumberMap } from "../../element-tree-numbering.js";
import type { ElementStore } from "../../element-state.js";
import { REFERENCE_SIZE, matchFont, type MetricsSource } from "../../font-metrics.js";

const props = defineProps<{
  projectId: string;
  selectedRegions: Region[];
  elementStore: ElementStore;
  hoveredId?: string | null;
}>();
const emit = defineEmits<{ hover: [id: string | null] }>();
const refactorPanel = ref<InstanceType<typeof ElementRefactorPanel> | null>(null);
const refactorStore = createElementRefactorStore({
  api: elementRefactorApi,
  replaceAppliedTree: (tree, version, rootId) => props.elementStore.replaceFromRefactor(tree, version, rootId),
});
function startRefactor(id: string): boolean {
  if (props.elementStore.busy.value) {
    refactorStore.error.value = "元素仍在载入或解析中，请稍后再试";
    return false;
  }
  if (!region.value || !props.elementStore.tree.value || !props.elementStore.treeVersion.value || props.elementStore.dirty.value) {
    refactorStore.error.value = "请先完成元素解析并保存当前修改";
    return false;
  }
  props.elementStore.editingLocked.value = true;
  refactorStore.open({ projectId: props.projectId, region: region.value, tree: props.elementStore.tree.value, treeVersion: props.elementStore.treeVersion.value, rootId: id });
  return true;
}
function discardRefactor() {
  refactorStore.discard();
  props.elementStore.editingLocked.value = false;
  props.elementStore.select(null);
}
async function sendRefactor(instruction: string) {
  if (!refactorStore.rootId.value) {
    const selectedId = props.elementStore.selectedId.value;
    if (!selectedId || !startRefactor(selectedId)) return;
  }
  if (await refactorStore.send(instruction)) refactorPanel.value?.clearSubmitted();
}
async function applyRefactor() { await refactorStore.apply(); if (!refactorStore.rootId.value) props.elementStore.editingLocked.value = false; }

const single = computed(() =>
  props.selectedRegions.length === 1 ? props.selectedRegions[0]! : null);
const region = computed<Rect | null>(() => single.value?.bounds ?? null);
const sourceUrl = computed(() =>
  region.value ? regionImageUrl(props.projectId, region.value) : "");
const nodes = computed(() => refactorStore.rootId.value
  ? (refactorStore.previewTree.value?.nodes ?? [])
  : props.elementStore.nodes.value);
const selectedReference = computed(() => {
  const selectedId = refactorStore.rootId.value
    ? (refactorStore.session.value?.candidate.rootId ?? refactorStore.rootId.value)
    : props.elementStore.selectedId.value;
  const selected = nodes.value.find((node) => node.id === selectedId);
  if (!selected) return null;
  return { number: elementNumberMap(nodes.value).get(selected.id) ?? "?", displayName: selected.displayName };
});
const propertyNode = computed(() => refactorStore.rootId.value
  ? nodes.value.find((node) => node.id === props.elementStore.selectedId.value)
    ?? nodes.value.find((node) => node.id === (refactorStore.session.value?.candidate.rootId ?? refactorStore.rootId.value))
    ?? null
  : props.elementStore.selectedNode.value);
/** 区域自身的背景色，检测时测出，人工可改 */
const regionBackground = computed(() =>
  props.elementStore.tree.value?.background ?? "#ffffff");
function onRegionBackground(event: Event) {
  const value = (event.target as HTMLInputElement).value.trim();
  if (region.value && /^#[0-9a-fA-F]{6}$/.test(value)) {
    void props.elementStore.setRegionBackground(props.projectId, region.value, value);
  }
}
const parsed = computed(() => props.elementStore.tree.value !== null);
/**
 * 阶段一只检测顶层容器，文字和图标这类小元素达不到最小尺寸门槛。
 * 解析完却一个都没有是正常的，界面必须说清楚，不然看起来像坏了。
 */
const emptyResult = computed(() => parsed.value && nodes.value.length === 0);

// 选中的区域一变就重新载入。边界变了 regionKey 就失配，界面自然回到"未解析"——
// 区域范围变了，树本来就该重算。
watch(region, async next => {
  discardRefactor();
  if (next && props.projectId) await props.elementStore.load(props.projectId, next);
}, { immediate: true });

function detect() {
  if (region.value) void props.elementStore.detect(props.projectId, region.value);
}
function onRemove(id: string) {
  if (region.value) void props.elementStore.removeNode(props.projectId, region.value, id);
}
function onSetKind(id: string, kind: ElementKind) {
  if (region.value) void props.elementStore.setKind(props.projectId, region.value, id, kind);
}
function onRenameValue(id: string, displayName: string) {
  if (region.value) void props.elementStore.rename(props.projectId, region.value, id, displayName);
}
function onAddContainer(box: Rect) {
  if (region.value) void props.elementStore.addContainer(props.projectId, region.value, box);
}
function onSetBox(id: string, box: Rect) {
  if (region.value) void props.elementStore.setBox(props.projectId, region.value, id, box);
}
function onSetRadius(id: string, radius: number) {
  if (region.value) void props.elementStore.setRadius(props.projectId, region.value, id, radius);
}
function onSetColor(id: string, color: string) {
  if (region.value) void props.elementStore.setColor(props.projectId, region.value, id, color);
}

/**
 * 取色器：在**上面那张干净原图**上点一个像素，把颜色填给当前选中的元素。
 *
 * 自动测出来的是"整个框的墨色"；遇到渐变、或者框里混了别的颜色导致测偏时，
 * 人工指一个具体像素最直接。
 *
 * 像素值只能从 canvas 读，所以把原图画进一张离屏 canvas 再取。同源图片不会
 * 污染 canvas，getImageData 可用。
 */
const picking = ref(false);
const sourceImg = ref<HTMLImageElement | null>(null);
const hoverColor = ref<{ x: number; y: number; color: string } | null>(null);
let canvas: HTMLCanvasElement | null = null;
let context: CanvasRenderingContext2D | null = null;

/**
 * 每次打开吸管都重画一次，不做跨次缓存。
 *
 * 缓存过一版，结果取到的全是白色——画的时候图还没解码完，之后又因为
 * "src 没变"再不重画。取色一次就几十毫秒，省这一次重画不值得冒这个险。
 *
 * 判断图片可用只看 `complete` 和 `naturalWidth`，**不要用 `img.decode()`**：
 * 实测标签页不可见时它会永远不 resolve，把整个取色流程挂死。
 */
function prepareCanvas(): boolean {
  const img = sourceImg.value;
  if (!img || !img.complete || !img.naturalWidth || !img.naturalHeight) return false;
  canvas ??= document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  context.drawImage(img, 0, 0);
  return true;
}

function togglePicking() {
  if (picking.value) {
    picking.value = false;
    hoverColor.value = null;
    return;
  }
  picking.value = prepareCanvas();
}

watch(sourceUrl, () => { picking.value = false; hoverColor.value = null; });

/**
 * 只数**明显是笔画**的像素：抗锯齿边缘不算，否则覆盖率会随字号漂移。
 * 阈值 40 是实测选的——低于它的边缘像素在小字上占比很高。
 */
const STROKE_THRESHOLD = 40;

/** 从原图裁图里量一个框的真实墨迹高度与覆盖率 */
function inkStats(box: Rect): { height: number; coverage: number } | null {
  if (!context || !region.value) return null;
  const x0 = box.x - region.value.x;
  const y0 = box.y - region.value.y;
  if (box.w <= 0 || box.h <= 0) return null;
  const data = context.getImageData(x0, y0, box.w, box.h).data;

  const counts = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    const key = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let backgroundKey = 0;
  let best = -1;
  for (const [key, count] of counts) if (count > best) { best = count; backgroundKey = key; }
  const bg = [(backgroundKey >> 16) & 0xff, (backgroundKey >> 8) & 0xff, backgroundKey & 0xff];

  let count = 0, minX = box.w, maxX = -1, minY = box.h, maxY = -1;
  for (let y = 0; y < box.h; y++) {
    for (let x = 0; x < box.w; x++) {
      const i = (y * box.w + x) * 4;
      const away = Math.max(
        Math.abs(data[i]! - bg[0]!), Math.abs(data[i + 1]! - bg[1]!),
        Math.abs(data[i + 2]! - bg[2]!));
      if (away <= STROKE_THRESHOLD) continue;
      count++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (count === 0 || maxX < minX) return null;
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  return { height: h, coverage: count / (w * h) };
}

/** 用页面自己的 canvas 当渲染源——浏览器里装的才是用户真正看到的字体 */
function createMetricsSource(): MetricsSource | null {
  const surface = document.createElement("canvas");
  const paint = surface.getContext("2d", { willReadFrequently: true });
  if (!paint) return null;
  const family = "sans-serif";
  return {
    inkHeightAtReference(text, weight) {
      paint.font = `${weight} ${REFERENCE_SIZE}px ${family}`;
      const m = paint.measureText(text);
      return m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    },
    coverage(text, weight, size) {
      const pad = Math.ceil(size * 0.6);
      paint.font = `${weight} ${size}px ${family}`;
      const width = Math.ceil(paint.measureText(text).width) + pad * 2;
      const height = Math.ceil(size * 2) + pad * 2;
      surface.width = Math.max(1, width);
      surface.height = Math.max(1, height);
      paint.fillStyle = "#ffffff";
      paint.fillRect(0, 0, surface.width, surface.height);
      paint.fillStyle = "#000000";
      paint.font = `${weight} ${size}px ${family}`;
      paint.textBaseline = "alphabetic";
      paint.fillText(text, pad, pad + size);
      const data = paint.getImageData(0, 0, surface.width, surface.height).data;
      let count = 0, minX = surface.width, maxX = -1, minY = surface.height, maxY = -1;
      for (let y = 0; y < surface.height; y++) {
        for (let x = 0; x < surface.width; x++) {
          const i = (y * surface.width + x) * 4;
          if (255 - data[i]! <= STROKE_THRESHOLD) continue;
          count++;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
      if (count === 0 || maxX < minX) return 0;
      return count / ((maxX - minX + 1) * (maxY - minY + 1));
    },
  };
}

const fontNote = ref("");

/** 对选中的文字叶子做一次渲染比对，写回字号字重 */
function measureFont() {
  const node = props.elementStore.selectedNode.value;
  if (!node || !region.value) return;
  if (!prepareCanvas()) { fontNote.value = "原图还没加载好"; return; }
  const stats = inkStats(node.box);
  if (!stats) { fontNote.value = "这个框里没有笔画像素"; return; }
  const source = createMetricsSource();
  if (!source) { fontNote.value = "浏览器不支持 canvas 测量"; return; }
  const match = matchFont(source, node.displayName, stats.height, stats.coverage);
  if (!match) { fontNote.value = "这段文字量不出来"; return; }
  fontNote.value = match.margin < 0.02
    ? `字重把握不大（与次优仅差 ${match.margin.toFixed(3)}），请人工确认`
    : `误差 ${match.error.toFixed(3)}，领先次优 ${match.margin.toFixed(3)}`;
  void props.elementStore.setFont(props.projectId, region.value, node.id, {
    fontSize: match.fontSize, fontWeight: match.fontWeight,
  });
}

function onSetFont(id: string, font: { fontSize?: number; fontWeight?: number }) {
  if (region.value) void props.elementStore.setFont(props.projectId, region.value, id, font);
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && picking.value) {
    picking.value = false;
    hoverColor.value = null;
  }
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

function sampleAt(event: MouseEvent): string | null {
  const img = sourceImg.value;
  if (!img || !context || !img.naturalWidth) return null;
  const rect = img.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const x = Math.floor((event.clientX - rect.left) / rect.width * img.naturalWidth);
  const y = Math.floor((event.clientY - rect.top) / rect.height * img.naturalHeight);
  if (x < 0 || y < 0 || x >= img.naturalWidth || y >= img.naturalHeight) return null;
  const [r, g, b] = context.getImageData(x, y, 1, 1).data;
  return `#${[r, g, b].map(v => (v ?? 0).toString(16).padStart(2, "0")).join("")}`;
}

function onSourceMove(event: MouseEvent) {
  if (!picking.value) return;
  const color = sampleAt(event);
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  hoverColor.value = color
    ? { x: event.clientX - rect.left, y: event.clientY - rect.top, color }
    : null;
}

function onSourceClick(event: MouseEvent) {
  if (!picking.value) return;
  const color = sampleAt(event);
  const selected = props.elementStore.selectedNode.value;
  if (color && selected) onSetColor(selected.id, color);
  picking.value = false;
  hoverColor.value = null;
}
function onSetScroll(id: string, axis: "x" | "y", value: boolean) {
  if (region.value) {
    void props.elementStore.setScroll(props.projectId, region.value, id, axis, value);
  }
}

/** 树上双击只给 id，名字从当前节点取 */
function onRenamePrompt(id: string) {
  const current = nodes.value.find(node => node.id === id);
  const next = window.prompt("元素名称", current?.displayName ?? "");
  if (next !== null) onRenameValue(id, next);
}
</script>

<template>
  <div class="detail-node" @pointerdown.stop @click.stop>
    <p v-if="props.selectedRegions.length === 0" class="hint">选择一个区域查看详情</p>
    <p v-else-if="props.selectedRegions.length > 1" class="hint">请选择单个区域</p>
    <template v-else-if="region">
      <div class="bar">
        <button
          data-test="detect-elements"
          :disabled="props.elementStore.busy.value || refactorStore.rootId.value !== null"
          @click="detect"
        >{{ parsed ? "重新解析" : "解析元素" }}</button>
        <span class="label">{{ single?.displayName }}</span>
        <span class="label">{{ region.w }}×{{ region.h }}</span>
        <span v-if="parsed" class="region-bg" title="区域背景色">
          <span class="label">背景</span>
          <input
            data-test="region-background-swatch" class="picker" type="color"
            :value="regionBackground" :disabled="refactorStore.rootId.value !== null" @input="onRegionBackground"
          />
          <input
            data-test="region-background" class="hex"
            :value="regionBackground" :disabled="refactorStore.rootId.value !== null" @change="onRegionBackground"
          />
        </span>
        <span v-if="props.elementStore.busy.value" class="label">
          {{ props.elementStore.busyLabel.value }}
        </span>
        <span v-if="props.elementStore.error.value" data-test="detail-error" class="error">
          {{ props.elementStore.error.value }}
        </span>
      </div>

      <!-- 上下两张图：上面是干净的原图，下面是带标注的解析图。
           调整结构时要能立刻看出"标注有没有框对"，只有一张叠了标注的图对不了。 -->
      <section data-test="detail-source" class="image-section">
        <header>
          区域原图
          <span v-if="picking" data-test="picking-hint" class="hint-inline">
            在图上点一个像素取色，Esc 取消
          </span>
        </header>
        <div
          class="source-frame"
          :class="{ picking }"
          :style="{ aspectRatio: `${region.w} / ${region.h}` }"
          @mousemove="onSourceMove"
          @mouseleave="hoverColor = null"
          @click="onSourceClick"
        >
          <img ref="sourceImg" class="source-crop" :src="sourceUrl" alt="区域原图" />
          <span
            v-if="hoverColor"
            data-test="pick-preview"
            class="pick-preview"
            :style="{ left: `${hoverColor.x}px`, top: `${hoverColor.y}px` }"
          >
            <i :style="{ background: hoverColor.color }" />{{ hoverColor.color }}
          </span>
        </div>
      </section>

      <section data-test="detail-image" class="image-section">
        <header>元素解析图</header>
        <ElementOverlay
          :project-id="props.projectId"
          :region="region"
          :nodes="nodes"
          :selected-id="props.elementStore.selectedId.value"
          :hovered-id="props.hoveredId ?? null"
          @select="refactorStore.rootId.value ? undefined : props.elementStore.select($event)"
          @hover="emit('hover', $event)"
          @add-container="refactorStore.rootId.value ? undefined : onAddContainer($event)"
        />
      </section>

      <p v-if="emptyResult" data-test="empty-result" class="empty-result">
        本区域未检出顶层容器——文字和图标这类小元素要等下一步的递归切分。
        可以在上图直接框选，手动补一个容器。
      </p>

      <section data-test="detail-inspector" class="inspector">
        <ElementTree
          :nodes="nodes"
          :selected-id="props.elementStore.selectedId.value"
          :hovered-id="props.hoveredId ?? null"
          :refactor-root-id="refactorStore.rootId.value"
          :locked="refactorStore.rootId.value !== null"
          @select="refactorStore.rootId.value ? undefined : props.elementStore.select($event)"
          @hover="emit('hover', $event)"
          @remove="onRemove"
          @rename="onRenamePrompt"
          @start-refactor="startRefactor"
        />
        <ElementProperties
          :node="propertyNode"
          :disabled="refactorStore.rootId.value !== null"
          @rename="onRenameValue"
          @set-kind="onSetKind"
          @set-scroll="onSetScroll"
          @set-box="onSetBox"
          @set-radius="onSetRadius"
          @set-color="onSetColor"
          @set-font="onSetFont"
          @measure-font="measureFont"
          :font-note="fontNote"
          :picking="picking"
          @toggle-picking="togglePicking"
        />
        <ElementRefactorPanel
          v-if="parsed"
          ref="refactorPanel"
          :session="refactorStore.session.value"
          :messages="refactorStore.messages.value"
          :diffs="refactorStore.diffs.value"
          :busy="refactorStore.busy.value"
          :error="refactorStore.error.value"
          :selected-reference="selectedReference"
          @send="sendRefactor"
          @apply="applyRefactor"
          @reset="refactorStore.reset"
          @discard="discardRefactor"
          @set-view="refactorStore.view.value = $event"
        />
        <button
          v-if="!refactorStore.rootId.value && props.elementStore.undoSnapshot.value"
          class="undo-refactor"
          data-test="undo-ai-refactor"
          @click="region && props.elementStore.undoRefactor(props.projectId, region)"
        >撤销 AI 重构</button>
      </section>
    </template>
  </div>
</template>

<style scoped>
.detail-node { margin: -14px; overflow: hidden; border-radius: 0 0 9px 9px; background: var(--bg-inset); }
.hint { min-height: 380px; display: grid; place-content: center; margin: 0; color: var(--text-faint); background: #0e1118; font-size: 11px; }
.bar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--border); background: var(--bg-node-header); }
.bar button { height: 28px; min-height: 28px; padding: 0 12px; font-size: 11px; }
.label { color: var(--text-faint); font-size: 10px; }
.region-bg { display: flex; align-items: center; gap: 5px; }
.region-bg .picker { width: 28px; height: 24px; min-height: 24px; padding: 0 2px; }
.region-bg .hex { width: 76px; height: 24px; min-height: 24px; padding: 0 5px; font-size: 10px; }
.error { margin-left: auto; color: var(--danger); font-size: 10px; }
.image-section { background: #0a0d13; }
.image-section + .image-section { box-shadow: inset 0 1px var(--border); }
/* 与 ElementOverlay 的 .stage 保持同宽同比例，上下两张图才能逐像素对齐 */
.source-frame { position: relative; width: 100%; overflow: hidden; background: #0a0d13; }
.source-crop { display: block; width: 100%; height: auto; }
.source-frame.picking { cursor: crosshair; }
.hint-inline { margin-left: 8px; color: var(--accent); }
.pick-preview { position: absolute; z-index: 5; display: flex; align-items: center; gap: 5px; padding: 3px 6px; border-radius: 5px; background: #16181dee; color: white; font-size: 10px; pointer-events: none; transform: translate(12px, 12px); }
.pick-preview i { width: 11px; height: 11px; border: 1px solid #ffffff55; border-radius: 3px; }
.image-section header { height: 26px; display: flex; align-items: center; padding: 0 9px; border-bottom: 1px solid var(--border); color: var(--text-dim); background: var(--bg-node-header); font-size: 10px; }
.empty-result { margin: 0; padding: 8px 10px; border-top: 1px solid var(--border); color: var(--warn); background: #e2a4000f; font-size: 10px; line-height: 1.6; }
/* 上下结构：图占满宽度、高度由区域宽高比决定且不设上限（标注才能纯百分比定位）；
   下段是固定高度的树与属性检查器，不随区域高矮变化。 */
.inspector { height: 500px; display: grid; grid-template-columns: minmax(0, 1fr) 300px; grid-template-rows: minmax(0, 1fr) auto; border-top: 1px solid var(--border); }
.inspector > .element-refactor-panel { grid-column: 1 / -1; }
.undo-refactor { position: absolute; right: 8px; transform: translateY(8px); }
</style>
