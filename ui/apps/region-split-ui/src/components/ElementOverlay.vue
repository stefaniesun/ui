<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { imageRectToDisplay, normalizeDragRect, type Point } from "../coords.js";
import type { Rect } from "@region-split/core/browser";
import type { Store } from "../state.js";

const props = defineProps<{ store: Store; imageWidth: number; imageHeight: number; displayWidth: number; displayHeight: number; disabled?: boolean }>();
const scaleX = computed(() => props.displayWidth / props.imageWidth || 1);
const scaleY = computed(() => props.displayHeight / props.imageHeight || 1);
const root = ref<HTMLElement>();
let gesture: { pointerId: number; id: string | null; start: Point; last: Point; kind: "move" | "create" | "resize"; original?: Rect } | null = null;

function point(event: PointerEvent): Point {
  const rect = root.value?.getBoundingClientRect();
  return { x: Math.round((event.clientX - (rect?.left ?? 0)) / scaleX.value), y: Math.round((event.clientY - (rect?.top ?? 0)) / scaleY.value) };
}
function startMove(event: PointerEvent, id: string) {
  if (props.disabled || props.store.canvasMode.value !== "select") return;
  event.stopPropagation(); props.store.selectElement(id); props.store.beginElementGesture();
  const start = point(event); gesture = { pointerId: event.pointerId, id, start, last: start, kind: "move" };
  root.value?.setPointerCapture?.(event.pointerId);
}
function startResize(event: PointerEvent, id: string) {
  if (props.disabled) return;
  event.stopPropagation(); const element = props.store.elements.value.find(item => item.id === id); if (!element) return;
  props.store.selectElement(id); props.store.beginElementGesture(); const start = point(event);
  gesture = { pointerId: event.pointerId, id, start, last: start, kind: "resize", original: { ...element.bounds } };
  root.value?.setPointerCapture?.(event.pointerId);
}
function startCreate(event: PointerEvent) {
  if (props.disabled || props.store.canvasMode.value !== "add-element" || event.target !== root.value) return;
  const start = point(event); gesture = { pointerId: event.pointerId, id: null, start, last: start, kind: "create" };
  root.value?.setPointerCapture?.(event.pointerId);
}
function move(event: PointerEvent) {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  const next = point(event);
  if (gesture.kind === "move" && gesture.id) props.store.moveElement(gesture.id, next.x - gesture.last.x, next.y - gesture.last.y);
  if (gesture.kind === "resize" && gesture.id && gesture.original) props.store.resizeElement(gesture.id, { ...gesture.original, w: Math.max(4, gesture.original.w + next.x - gesture.start.x), h: Math.max(4, gesture.original.h + next.y - gesture.start.y) });
  gesture.last = next;
}
function finish(event: PointerEvent) {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  if (gesture.kind === "move" || gesture.kind === "resize") props.store.endElementGesture();
  else {
    const bounds = normalizeDragRect(gesture.start, gesture.last);
    const region = props.store.regions.value.find(item => bounds.y >= item.bounds.y && bounds.y + bounds.h <= item.bounds.y + item.bounds.h);
    if (region && bounds.w >= 4 && bounds.h >= 4) props.store.addElement({ id: `element-${crypto.randomUUID()}`, regionId: region.id, parentId: null, displayName: "新元素", type: "other", bounds, confidence: 1, conflict: false, source: "manual" });
    props.store.setCanvasMode("select");
  }
  gesture = null;
}
function cancel() { if (gesture?.kind === "move" || gesture?.kind === "resize") props.store.endElementGesture(); gesture = null; }
onBeforeUnmount(cancel);
</script>

<template>
  <div ref="root" class="element-overlay" :class="{ disabled }" @pointerdown="startCreate" @pointermove="move" @pointerup="finish" @pointercancel="cancel">
    <div v-for="element in store.elements.value" :key="element.id" class="element-box"
      :class="{ selected: store.selectedElementId.value === element.id, conflict: element.conflict, hovered: store.hoveredElementId.value === element.id }"
      :data-element-id="element.id" :aria-label="`元素 ${element.displayName}`" :aria-selected="store.selectedElementId.value === element.id" role="button" tabindex="0" @keydown.enter.stop="store.selectElement(element.id)" @keydown.space.prevent.stop="store.selectElement(element.id)"
      :style="{ left: `${imageRectToDisplay(element.bounds, scaleX, scaleY).x}px`, top: `${imageRectToDisplay(element.bounds, scaleX, scaleY).y}px`, width: `${imageRectToDisplay(element.bounds, scaleX, scaleY).w}px`, height: `${imageRectToDisplay(element.bounds, scaleX, scaleY).h}px` }"
      @pointerdown="startMove($event, element.id)" @mouseenter="store.hoverElement(element.id)" @mouseleave="store.hoverElement(null)">
      <span class="element-label">{{ element.displayName }} · {{ element.type }}</span>
      <button v-if="store.selectedElementId.value === element.id" type="button" class="resize-handle" aria-label="缩放元素" @pointerdown.stop="startResize($event, element.id)" />
    </div>
  </div>
</template>

<style scoped>
.element-overlay { position: absolute; inset: 0; z-index: 4; }
.element-overlay.disabled { pointer-events: none; }
.element-box { position: absolute; box-sizing: border-box; border: 1px solid #1677ff; background: #1677ff12; cursor: move; }
.element-box.selected { border-width: 2px; box-shadow: 0 0 0 1px #fff; }
.element-box.hovered { background: #1677ff25; }
.element-box.conflict { border-color: #d97706; background: #f59e0b18; }
.element-label { position: absolute; left: -1px; top: -17px; padding: 1px 4px; background: #1677ff; color: white; font-size: 10px; line-height: 14px; white-space: nowrap; }
.element-box.conflict .element-label { background: #d97706; }
.resize-handle { position: absolute; right: -5px; bottom: -5px; width: 10px; height: 10px; padding: 0; border: 1px solid #1677ff; background: white; cursor: nwse-resize; }
</style>
