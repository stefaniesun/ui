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
  /** 取色进行中：让出所有指针交互，只报坐标 */
  picking?: boolean;
}>();
const emit = defineEmits<{
  select: [id: string];
  hover: [id: string | null];
  "add-container": [box: Rect];
  /** 图上一点的原图坐标 + 相对舞台的偏移（后者只用于摆提示气泡） */
  "pick-hover": [point: { x: number; y: number; offsetX: number; offsetY: number } | null];
  pick: [point: { x: number; y: number }];
}>();

/** 小于这个像素的拖拽当作误触 */
const MIN_DRAG = 8;

const fitEl = ref<HTMLElement | null>(null);
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

/** 只用到 clientX/clientY，取色走的是 MouseEvent，所以别把类型收窄成 PointerEvent */
function toImage(event: { clientX: number; clientY: number }): { x: number; y: number } {
  const rect = stageEl.value!.getBoundingClientRect();
  const scaleX = rect.width > 0 ? props.region.w / rect.width : 1;
  const scaleY = rect.height > 0 ? props.region.h / rect.height : 1;
  return {
    x: props.region.x + Math.round((event.clientX - rect.left) * scaleX),
    y: props.region.y + Math.round((event.clientY - rect.top) * scaleY),
  };
}

/**
 * 取色的落点在这张解析图上——它底下铺的就是区域原图，和之前那张被移除的
 * "区域原图"预览是同一个 URL，所以取到的像素一样。
 * 这里只报坐标，不处理画布状态；采样必须使用原图的自然尺寸，由调用方提供。
 */
function onPickMove(event: MouseEvent) {
  if (!props.picking) return;
  const rect = fitEl.value!.getBoundingClientRect();
  emit("pick-hover", {
    ...toImage(event),
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
  });
}

function onPickLeave() {
  if (props.picking) emit("pick-hover", null);
}

function onPickClick(event: MouseEvent) {
  if (props.picking) emit("pick", toImage(event));
}

function onDown(event: PointerEvent) {
  // 取色时不框选新容器，否则一次点击既取色又建了个框
  if (props.picking || event.button !== 0) return;
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
  <div ref="fitEl" data-test="element-fit" class="fit">
    <div
      ref="stageEl"
      data-test="element-stage"
      class="stage"
      :class="{ picking: props.picking }"
      :style="{
        aspectRatio: `${props.region.w} / ${props.region.h}`,
        '--region-ratio': props.region.w / props.region.h,
      }"
      @pointerdown.stop="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onCancel"
      @mousemove="onPickMove"
      @mouseleave="onPickLeave"
      @click="onPickClick"
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
  </div>
</template>

<style scoped>
.fit { container-type: size; width: 100%; height: 100%; display: grid; place-items: center; overflow: hidden; }
.stage { container-type: inline-size; position: relative; width: min(100cqw, calc(100cqh * var(--region-ratio))); max-width: 100%; max-height: 100%; overflow: hidden; background: #0a0d13; cursor: crosshair; touch-action: none; }
.crop { display: block; width: 100%; height: 100%; }
/* 取色时标注框必须让开，否则点在框上就被它 @click.stop 吃掉，取不到色 */
.stage.picking .box { pointer-events: none; }
.box { position: absolute; border: 1px solid #4c8dff88; }
.box.kind-image { border-style: dashed; border-color: #e2a400cc; }
.box.kind-grid { border-color: #3ecf8ecc; }
.box.hovered { background: #4c8dff1a; }
.box.selected { border: 2px solid var(--accent); background: #4c8dff28; }
.draft { position: absolute; border: 1px dashed var(--accent); background: #4c8dff22; pointer-events: none; }
</style>
