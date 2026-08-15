<script setup lang="ts">
import { computed, ref } from "vue";
import type { ElementNode, Rect } from "@region-split/core/browser";
import { regionImageUrl } from "../api.js";
import { supportsBorderRadius } from "../element-state.js";

const props = defineProps<{
  projectId: string;
  region: Rect;
  nodes: ElementNode[];
  selectedId: string | null;
  hoveredId: string | null;
}>();
const emit = defineEmits<{
  select: [id: string];
  hover: [id: string | null];
  "add-container": [box: Rect];
}>();

/** 小于这个像素的拖拽当作误触 */
const MIN_DRAG = 8;

const stageEl = ref<HTMLElement | null>(null);
const dragBox = ref<Rect | null>(null);
let dragStart: { x: number; y: number } | null = null;

const src = computed(() => regionImageUrl(props.projectId, props.region));

/**
 * 全部按百分比定位，不做任何 ResizeObserver 测量。
 * 前提是图始终占满容器宽度、容器宽高比等于区域宽高比——所以这里绝不能给图加
 * max-height 配 object-fit，那会让图的渲染矩形不再等于容器矩形，标注就必须
 * 改回测量式定位。
 */
function boxStyle(box: Rect, radius = 0) {
  // 圆角按显示比例换算，标注框才会和图上的实际弧度对得上
  const scale = props.region.w > 0 ? 100 / props.region.w : 0;
  return {
    left: `${((box.x - props.region.x) / props.region.w) * 100}%`,
    top: `${((box.y - props.region.y) / props.region.h) * 100}%`,
    width: `${(box.w / props.region.w) * 100}%`,
    height: `${(box.h / props.region.h) * 100}%`,
    ...(radius > 0 ? { borderRadius: `${radius * scale}cqw` } : {}),
  };
}

function toImage(event: PointerEvent): { x: number; y: number } {
  const rect = stageEl.value!.getBoundingClientRect();
  const scaleX = rect.width > 0 ? props.region.w / rect.width : 1;
  const scaleY = rect.height > 0 ? props.region.h / rect.height : 1;
  return {
    x: props.region.x + Math.round((event.clientX - rect.left) * scaleX),
    y: props.region.y + Math.round((event.clientY - rect.top) * scaleY),
  };
}

function onDown(event: PointerEvent) {
  if (event.button !== 0) return;
  dragStart = toImage(event);
  dragBox.value = null;
  stageEl.value?.setPointerCapture?.(event.pointerId);
}

function onMove(event: PointerEvent) {
  if (!dragStart) return;
  const now = toImage(event);
  dragBox.value = {
    x: Math.min(dragStart.x, now.x), y: Math.min(dragStart.y, now.y),
    w: Math.abs(now.x - dragStart.x), h: Math.abs(now.y - dragStart.y),
  };
}

function onUp() {
  const box = dragBox.value;
  dragStart = null;
  dragBox.value = null;
  if (box && box.w >= MIN_DRAG && box.h >= MIN_DRAG) emit("add-container", box);
}

function onCancel() {
  dragStart = null;
  dragBox.value = null;
}

defineExpose({ cancel: onCancel });
</script>

<template>
  <div
    ref="stageEl"
    data-test="element-stage"
    class="stage"
    :style="{ aspectRatio: `${props.region.w} / ${props.region.h}` }"
    @pointerdown.stop="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onCancel"
  >
    <img class="crop" :src="src" alt="区域原图" />
    <div
      v-for="node in props.nodes"
      :key="node.id"
      data-test="element-box"
      class="box"
      :class="[`kind-${node.kind}`, {
        selected: node.id === props.selectedId,
        hovered: node.id === props.hoveredId,
      }]"
      :style="boxStyle(
        node.box,
        supportsBorderRadius(node.kind) ? (node.style.borderRadius ?? 0) : 0,
      )"
      @click.stop="emit('select', node.id)"
      @mouseenter="emit('hover', node.id)"
      @mouseleave="emit('hover', null)"
    />
    <div v-if="dragBox" class="draft" :style="boxStyle(dragBox)" />
  </div>
</template>

<style scoped>
.stage { container-type: inline-size; position: relative; width: 100%; overflow: hidden; background: #0a0d13; cursor: crosshair; touch-action: none; }
.crop { display: block; width: 100%; height: auto; }
.box { position: absolute; border: 1px solid #4c8dff88; }
.box.kind-image { border-style: dashed; border-color: #e2a400cc; }
.box.kind-grid { border-color: #3ecf8ecc; }
.box.hovered { background: #4c8dff1a; }
.box.selected { border: 2px solid var(--accent); background: #4c8dff28; }
.draft { position: absolute; border: 1px dashed var(--accent); background: #4c8dff22; pointer-events: none; }
</style>
