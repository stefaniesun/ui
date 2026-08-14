<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, watch } from "vue";
import {
  MIN_BOX_SIZE, elementKinds,
  type ElementKind, type ElementNode, type Rect,
} from "@region-split/core/browser";

const props = defineProps<{ node: ElementNode | null }>();
const emit = defineEmits<{
  rename: [id: string, displayName: string];
  "set-kind": [id: string, kind: ElementKind];
  "set-scroll": [id: string, axis: "x" | "y", value: boolean];
  "set-box": [id: string, box: Rect];
  "set-radius": [id: string, radius: number];
  "set-color": [id: string, color: string];
}>();

// 滚动是容器的属性，叶子上没有意义
const isContainer = computed(() =>
  props.node?.kind === "component" || props.node?.kind === "grid");

/** 圆角只对容器和位图有意义：文字和图标是内容本身，圆角属于承载它的盒子 */
const hasRadius = computed(() => props.node?.kind === "component"
  || props.node?.kind === "grid" || props.node?.kind === "image");
const radius = computed(() => props.node?.style.borderRadius ?? 0);

/** 颜色是"墨色"：文字的字色、图标的线条色、装饰的颜色。容器的颜色是背景色，另有一行。 */
const hasColor = computed(() => props.node?.kind === "text"
  || props.node?.kind === "icon" || props.node?.kind === "decoration");
const color = computed(() => props.node?.style.color ?? "#000000");

const KIND_LABEL: Record<ElementKind, string> = {
  component: "组件", grid: "网格", text: "文字",
  icon: "图标", image: "图片", decoration: "装饰",
};

function onRename(event: Event) {
  const value = (event.target as HTMLInputElement).value.trim();
  if (props.node && value) emit("rename", props.node.id, value);
}
function onKind(event: Event) {
  const value = (event.target as HTMLSelectElement).value as ElementKind;
  if (props.node) emit("set-kind", props.node.id, value);
}

/**
 * 输入框绑在本地草稿上，而不是直接绑 props。
 *
 * 直接绑 props 会脱节：改动被 clampBox 收拢或拒绝时属性值可能原样不动，
 * Vue 就不重渲染，输入框里留着刚打进去的脏值——实测输入 -9999 被拒后
 * 框里还显示 -9999，而真实值是 74。草稿跟着 props 走就不会有这个问题。
 */
const draft = reactive({ x: 0, y: 0, w: 0, h: 0 });
watch(() => props.node, node => {
  if (node) Object.assign(draft, node.box);
}, { immediate: true, deep: true });

/** 提交一个新框，钳制交给 store；提交后强制回同步一次草稿 */
function submit(box: Rect) {
  if (!props.node) return;
  emit("set-box", props.node.id, box);
  // 钳制后的结果**可能与原值相同**（比如已经贴着父边还想再往左），
  // 这时 props 不变、watch 不触发，输入框会留着刚打进去的越界值。
  void nextTick(() => {
    if (props.node) Object.assign(draft, props.node.box);
  });
}

/**
 * 输入框改动。校验读输入框原值而不是 draft：
 * `v-model.number` 对空串不会给出 NaN，光判断 draft 拦不住"清空输入框"。
 */
function onBox(axis: "x" | "y" | "w" | "h", event: Event) {
  const raw = (event.target as HTMLInputElement).value.trim();
  const value = Number(raw);
  if (!props.node) return;
  if (raw === "" || !Number.isFinite(value)) {
    Object.assign(draft, props.node.box);          // 非法输入立刻回弹
    return;
  }
  submit({ ...props.node.box, [axis]: value });
}

function onRadius(event: Event) {
  const raw = (event.target as HTMLInputElement).value.trim();
  const value = Number(raw);
  if (!props.node) return;
  if (raw === "" || !Number.isFinite(value)) return;
  emit("set-radius", props.node.id, value);
}

function onColor(event: Event) {
  const value = (event.target as HTMLInputElement).value.trim();
  if (props.node && /^#[0-9a-fA-F]{6}$/.test(value)) emit("set-color", props.node.id, value);
}

function nudgeRadius(delta: number) {
  if (props.node) emit("set-radius", props.node.id, radius.value + delta);
}

/** 按住不放时连续微调，与区域那层的边界按钮行为一致 */
const REPEAT_MS = 120;
let repeatTimer: number | undefined;

function nudge(axis: "x" | "y" | "w" | "h", delta: number) {
  if (!props.node) return;
  submit({ ...props.node.box, [axis]: props.node.box[axis] + delta });
}

function startNudge(axis: "x" | "y" | "w" | "h", delta: number) {
  nudge(axis, delta);
  window.clearInterval(repeatTimer);
  repeatTimer = window.setInterval(() => nudge(axis, delta), REPEAT_MS);
}
function startRadius(delta: number) {
  nudgeRadius(delta);
  window.clearInterval(repeatTimer);
  repeatTimer = window.setInterval(() => nudgeRadius(delta), REPEAT_MS);
}
function stopNudge() {
  window.clearInterval(repeatTimer);
  repeatTimer = undefined;
}
onBeforeUnmount(stopNudge);
</script>

<template>
  <div class="properties">
    <p v-if="!props.node" class="empty">选择一个元素查看属性</p>
    <template v-else>
      <label class="field">
        <span class="name">名称</span>
        <input data-test="property-name" :value="props.node.displayName" @change="onRename" />
      </label>
      <label class="field">
        <span class="name">类型</span>
        <select data-test="property-kind" :value="props.node.kind" @change="onKind">
          <option v-for="kind in elementKinds" :key="kind" :value="kind">
            {{ KIND_LABEL[kind] }}
          </option>
        </select>
      </label>

      <!-- 位置尺寸是测量结果，但测量会出错，所以必须能人工微调。
           越界或压到兄弟时由 clampBox 收拢或拒绝，这里不做校验。 -->
      <div class="field">
        <span class="name">位置</span>
        <span class="axes">
          <label>X<input
            v-model.number="draft.x" data-test="property-x" type="number"
            @change="onBox('x', $event)"
          /></label>
          <label>Y<input
            v-model.number="draft.y" data-test="property-y" type="number"
            @change="onBox('y', $event)"
          /></label>
        </span>
      </div>
      <div class="field">
        <span class="name">移动</span>
        <span class="pad">
          <button
            data-test="nudge-left" title="左移（按住连续）"
            @pointerdown="startNudge('x', -1)" @pointerup="stopNudge" @pointerleave="stopNudge"
          >←</button>
          <button
            data-test="nudge-up" title="上移（按住连续）"
            @pointerdown="startNudge('y', -1)" @pointerup="stopNudge" @pointerleave="stopNudge"
          >↑</button>
          <button
            data-test="nudge-down" title="下移（按住连续）"
            @pointerdown="startNudge('y', 1)" @pointerup="stopNudge" @pointerleave="stopNudge"
          >↓</button>
          <button
            data-test="nudge-right" title="右移（按住连续）"
            @pointerdown="startNudge('x', 1)" @pointerup="stopNudge" @pointerleave="stopNudge"
          >→</button>
        </span>
      </div>

      <div class="field">
        <span class="name">尺寸</span>
        <span class="axes">
          <label>W<input
            v-model.number="draft.w" data-test="property-w" type="number" :min="MIN_BOX_SIZE"
            @change="onBox('w', $event)"
          /></label>
          <label>H<input
            v-model.number="draft.h" data-test="property-h" type="number" :min="MIN_BOX_SIZE"
            @change="onBox('h', $event)"
          /></label>
        </span>
      </div>
      <div class="field">
        <span class="name">缩放</span>
        <span class="pad">
          <button
            data-test="nudge-narrower" title="变窄（按住连续）"
            @pointerdown="startNudge('w', -1)" @pointerup="stopNudge" @pointerleave="stopNudge"
          >宽−</button>
          <button
            data-test="nudge-wider" title="变宽（按住连续）"
            @pointerdown="startNudge('w', 1)" @pointerup="stopNudge" @pointerleave="stopNudge"
          >宽＋</button>
          <button
            data-test="nudge-shorter" title="变矮（按住连续）"
            @pointerdown="startNudge('h', -1)" @pointerup="stopNudge" @pointerleave="stopNudge"
          >高−</button>
          <button
            data-test="nudge-taller" title="变高（按住连续）"
            @pointerdown="startNudge('h', 1)" @pointerup="stopNudge" @pointerleave="stopNudge"
          >高＋</button>
        </span>
      </div>

      <div v-if="hasRadius" class="field">
        <span class="name">圆角</span>
        <span class="axes">
          <label><input
            data-test="property-radius" type="number" min="0" :value="radius"
            @change="onRadius"
          /></label>
        </span>
        <span class="pad radius-pad">
          <button
            data-test="radius-minus" title="减小圆角（按住连续）"
            @pointerdown="startRadius(-1)" @pointerup="stopNudge" @pointerleave="stopNudge"
          >−</button>
          <button
            data-test="radius-plus" title="增大圆角（按住连续）"
            @pointerdown="startRadius(1)" @pointerup="stopNudge" @pointerleave="stopNudge"
          >＋</button>
        </span>
      </div>

      <div v-if="hasColor" class="field">
        <span class="name">颜色</span>
        <span class="axes">
          <input
            data-test="property-color-swatch" class="picker" type="color"
            :value="color" @input="onColor"
          />
          <input data-test="property-color" :value="color" @change="onColor" />
        </span>
      </div>

      <div class="field">
        <span class="name">背景色</span>
        <code>
          <i
            v-if="props.node.style.background"
            class="swatch"
            :style="{ background: props.node.style.background }"
          />
          {{ props.node.style.background ?? "—" }}
        </code>
      </div>
      <div class="field">
        <span class="name">主色占比</span>
        <code>{{ props.node.uniformity.toFixed(2) }}</code>
      </div>

      <!-- 布局量是切分的副产品：方向即 flex-direction，间隙即 gap -->
      <template v-if="props.node.layout">
        <div class="field">
          <span class="name">布局</span>
          <code data-test="property-layout">
            {{ props.node.layout.direction === "row" ? "横排 →" : "竖排 ↓" }}
            · gap {{ props.node.layout.gap }}
          </code>
        </div>
        <div class="field">
          <span class="name">内边距</span>
          <code data-test="property-padding">
            {{ props.node.layout.padding.top }} {{ props.node.layout.padding.right }}
            {{ props.node.layout.padding.bottom }} {{ props.node.layout.padding.left }}
          </code>
        </div>
      </template>
      <div v-if="props.node.repeat" class="field">
        <span class="name">重复</span>
        <code data-test="property-repeat">
          ×{{ props.node.repeat.count }} · 间距 {{ Math.round(props.node.repeat.pitch) }}
        </code>
      </div>
      <div v-if="isContainer" class="field">
        <span class="name">滚动</span>
        <span class="toggles">
          <button
            data-test="property-scroll-x"
            :class="{ on: props.node.scrollX }"
            title="横向滚动"
            @click="emit('set-scroll', props.node.id, 'x', !props.node.scrollX)"
          >X</button>
          <button
            data-test="property-scroll-y"
            :class="{ on: props.node.scrollY }"
            title="纵向滚动"
            @click="emit('set-scroll', props.node.id, 'y', !props.node.scrollY)"
          >Y</button>
        </span>
      </div>
      <div class="field">
        <span class="name">来源</span>
        <code>{{ props.node.source === "manual" ? "人工新增" : "自动检测" }}</code>
      </div>
    </template>
  </div>
</template>

<style scoped>
.properties { height: 100%; padding: 8px; overflow: auto; border-left: 1px solid var(--border); background: var(--bg-node); }
.empty { padding: 24px 8px; color: var(--text-faint); font-size: 10px; text-align: center; }
.field { display: flex; align-items: center; gap: 8px; min-height: 30px; margin-bottom: 4px; font-size: 10px; }
/* 只有左侧那一列标签定宽。早先写成 .field > span 会连 .axes / .pad 一起命中，
   把输入框挤成看不见的小方块。 */
.field > .name { flex: none; width: 56px; color: var(--text-faint); }
.field input, .field select { flex: 1; min-width: 0; height: 26px; min-height: 26px; font-size: 10px; }
.field code { flex: 1; min-width: 0; display: flex; align-items: center; gap: 5px; overflow: hidden; color: var(--text-dim); text-overflow: ellipsis; white-space: nowrap; }
.swatch { flex: none; width: 11px; height: 11px; border: 1px solid var(--border-strong); border-radius: 3px; }
.axes { flex: 1; min-width: 0; display: flex; gap: 6px; }
.axes label { flex: 1; min-width: 0; display: flex; align-items: center; gap: 4px; color: var(--text-faint); }
.axes input { width: 100%; min-width: 0; padding: 0 5px; }
.pad { flex: 1; min-width: 0; display: flex; gap: 4px; }
.pad button { flex: 1; min-width: 0; height: 26px; min-height: 26px; padding: 0; border-radius: 5px; color: var(--text-dim); font-size: 10px; }
.pad button:active { border-color: var(--accent); color: var(--accent); }
.radius-pad { flex: none; width: 84px; }
.picker { flex: none; width: 30px; padding: 0 2px; }
.toggles { display: flex; gap: 4px; }
.toggles button { min-height: 0; padding: 2px 8px; border-radius: 4px; color: var(--text-faint); font-size: 9px; }
.toggles button.on { border-color: var(--accent); color: var(--accent); }
</style>
