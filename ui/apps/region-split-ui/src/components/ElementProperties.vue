<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, watch } from "vue";
import {
  MIN_BOX_SIZE, elementKinds,
  type ElementKind, type ElementNode, type Rect,
} from "@region-split/core/browser";
import { supportsBorderRadius } from "../element-state.js";

const props = defineProps<{
  node: ElementNode | null;
  disabled?: boolean;
  picking?: boolean;
  fontNote?: string;
}>();
const emit = defineEmits<{
  rename: [id: string, displayName: string];
  "set-kind": [id: string, kind: ElementKind];
  "set-scroll": [id: string, axis: "x" | "y", value: boolean];
  "set-box": [id: string, box: Rect];
  "set-radius": [id: string, radius: number];
  "set-color": [id: string, color: string];
  "toggle-picking": [];
  "set-font": [id: string, font: { fontSize?: number; fontWeight?: number }];
  "measure-font": [];
}>();

// 滚动是容器的属性，叶子上没有意义
const isContainer = computed(() =>
  props.node?.kind === "component" || props.node?.kind === "grid");

/** 圆角仅由用户为图片和组件手动开启。 */
const hasRadius = computed(() => props.node ? supportsBorderRadius(props.node.kind) : false);
const radius = computed(() => props.node?.style.borderRadius ?? 0);
const radiusEnabled = computed(() => hasRadius.value && radius.value > 0);

/** 颜色是"墨色"：文字的字色、图标的线条色、装饰的颜色。容器的颜色是背景色，另有一行。 */
const hasColor = computed(() => props.node?.kind === "text"
  || props.node?.kind === "icon" || props.node?.kind === "decoration");
const color = computed(() => props.node?.style.color ?? "#000000");

/** 字号字重只对文字有意义 */
const isText = computed(() => props.node?.kind === "text");
const fontSize = computed(() => props.node?.style.fontSize ?? 0);
const fontWeight = computed(() => props.node?.style.fontWeight ?? 400);
const WEIGHTS = [300, 400, 500, 600, 700, 800];

/**
 * 框没通过校验就不给测字号——在一个圈错的框上量出来的字号是错的，
 * 写进去比空着更糟：后面的全页字号归拢会被它带偏。
 *
 * 这三支文案与 ElementTree.vue 的 suspectTitle 是两份并行的三分支文案，
 * 改一处务必去看另一处是否也要改，否则两处说法会打架。
 */
const fontBlocked = computed(() => {
  const check = props.node?.textBox;
  if (!check || check.ok) return "";
  switch (check.reason) {
    case "no-ink": return "这个框里没有墨迹，先确认它是不是文字";
    case "multi-band": return "这个框不止一行文字，先把框改对再测字号";
    default: return "这个框里的内容不像字形，先确认它是不是文字";
  }
});

function onFontSize(event: Event) {
  if (props.disabled) return;
  const raw = (event.target as HTMLInputElement).value.trim();
  const value = Number(raw);
  if (props.node && raw !== "" && Number.isFinite(value) && value > 0) {
    emit("set-font", props.node.id, { fontSize: value });
  }
}
function onFontWeight(event: Event) {
  if (props.disabled) return;
  const value = Number((event.target as HTMLSelectElement).value);
  if (props.node && Number.isFinite(value)) {
    emit("set-font", props.node.id, { fontWeight: value });
  }
}

const KIND_LABEL: Record<ElementKind, string> = {
  component: "组件", grid: "网格", text: "文字",
  icon: "图标", image: "图片", decoration: "装饰",
};

function onRename(event: Event) {
  if (props.disabled) return;
  const value = (event.target as HTMLInputElement).value.trim();
  if (props.node && value) emit("rename", props.node.id, value);
}
function onKind(event: Event) {
  if (props.disabled) return;
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
  if (props.disabled || !props.node) return;
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
  if (props.disabled) return;
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
  if (props.disabled) return;
  const raw = (event.target as HTMLInputElement).value.trim();
  const value = Number(raw);
  if (!props.node) return;
  if (raw === "" || !Number.isFinite(value)) return;
  emit("set-radius", props.node.id, value);
}

function onRadiusToggle(event: Event) {
  if (props.disabled || !props.node) return;
  const enabled = (event.target as HTMLInputElement).checked;
  emit("set-radius", props.node.id, enabled ? (radius.value > 0 ? radius.value : 8) : 0);
}

function onColor(event: Event) {
  if (props.disabled) return;
  const value = (event.target as HTMLInputElement).value.trim();
  if (props.node && /^#[0-9a-fA-F]{6}$/.test(value)) emit("set-color", props.node.id, value);
}

function nudgeRadius(delta: number) {
  if (props.disabled) return;
  if (props.node) emit("set-radius", props.node.id, radius.value + delta);
}

/** 按住不放时连续微调，与区域那层的边界按钮行为一致 */
const REPEAT_MS = 120;
let repeatTimer: number | undefined;

function nudge(axis: "x" | "y" | "w" | "h", delta: number) {
  if (props.disabled || !props.node) return;
  submit({ ...props.node.box, [axis]: props.node.box[axis] + delta });
}

function startNudge(axis: "x" | "y" | "w" | "h", delta: number) {
  if (props.disabled) return;
  nudge(axis, delta);
  window.clearInterval(repeatTimer);
  repeatTimer = window.setInterval(() => nudge(axis, delta), REPEAT_MS);
}
function startRadius(delta: number) {
  if (props.disabled) return;
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
  <div class="properties" :class="{ disabled: props.disabled }">
    <p v-if="!props.node" class="empty">选择一个元素查看属性</p>
    <template v-else>
      <label class="field">
        <span class="name">名称</span>
        <input data-test="property-name" :value="props.node.displayName" :disabled="props.disabled" @change="onRename" />
      </label>
      <label class="field">
        <span class="name">类型</span>
        <select data-test="property-kind" :value="props.node.kind" :disabled="props.disabled" @change="onKind">
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
            v-model.number="draft.x" data-test="property-x" type="number" :disabled="props.disabled"
            @change="onBox('x', $event)"
          /></label>
          <label>Y<input
            v-model.number="draft.y" data-test="property-y" type="number" :disabled="props.disabled"
            @change="onBox('y', $event)"
          /></label>
        </span>
      </div>
      <div class="field">
        <span class="name">移动</span>
        <span class="pad">
          <button
            data-test="nudge-left" title="左移（按住连续）"
            :disabled="props.disabled" @pointerdown="startNudge('x', -1)" @pointerup="stopNudge" @pointerleave="stopNudge"
          >←</button>
          <button
            data-test="nudge-up" title="上移（按住连续）"
            :disabled="props.disabled" @pointerdown="startNudge('y', -1)" @pointerup="stopNudge" @pointerleave="stopNudge"
          >↑</button>
          <button
            data-test="nudge-down" title="下移（按住连续）"
            :disabled="props.disabled" @pointerdown="startNudge('y', 1)" @pointerup="stopNudge" @pointerleave="stopNudge"
          >↓</button>
          <button
            data-test="nudge-right" title="右移（按住连续）"
            :disabled="props.disabled" @pointerdown="startNudge('x', 1)" @pointerup="stopNudge" @pointerleave="stopNudge"
          >→</button>
        </span>
      </div>

      <div class="field">
        <span class="name">尺寸</span>
        <span class="axes">
          <label>W<input
            v-model.number="draft.w" data-test="property-w" type="number" :min="MIN_BOX_SIZE" :disabled="props.disabled"
            @change="onBox('w', $event)"
          /></label>
          <label>H<input
            v-model.number="draft.h" data-test="property-h" type="number" :min="MIN_BOX_SIZE" :disabled="props.disabled"
            @change="onBox('h', $event)"
          /></label>
        </span>
      </div>
      <div class="field">
        <span class="name">缩放</span>
        <span class="pad">
          <button
            data-test="nudge-narrower" title="变窄（按住连续）"
            :disabled="props.disabled" @pointerdown="startNudge('w', -1)" @pointerup="stopNudge" @pointerleave="stopNudge"
          >宽−</button>
          <button
            data-test="nudge-wider" title="变宽（按住连续）"
            :disabled="props.disabled" @pointerdown="startNudge('w', 1)" @pointerup="stopNudge" @pointerleave="stopNudge"
          >宽＋</button>
          <button
            data-test="nudge-shorter" title="变矮（按住连续）"
            :disabled="props.disabled" @pointerdown="startNudge('h', -1)" @pointerup="stopNudge" @pointerleave="stopNudge"
          >高−</button>
          <button
            data-test="nudge-taller" title="变高（按住连续）"
            :disabled="props.disabled" @pointerdown="startNudge('h', 1)" @pointerup="stopNudge" @pointerleave="stopNudge"
          >高＋</button>
        </span>
      </div>

      <div v-if="hasRadius" class="field">
        <span class="name">圆角</span>
        <span class="axes">
          <label class="toggle">
            <input
              data-test="border-radius-toggle" type="checkbox" :checked="radiusEnabled" :disabled="props.disabled"
              @change="onRadiusToggle"
            />
            <span>{{ radiusEnabled ? "开启" : "关闭" }}</span>
          </label>
          <label v-if="radiusEnabled"><input
            data-test="property-radius" type="number" min="0" :value="radius" :disabled="props.disabled"
            @change="onRadius"
          /></label>
        </span>
        <span v-if="radiusEnabled" class="pad radius-pad">
          <button
            data-test="radius-minus" title="减小圆角（按住连续）"
            :disabled="props.disabled" @pointerdown="startRadius(-1)" @pointerup="stopNudge" @pointerleave="stopNudge"
          >−</button>
          <button
            data-test="radius-plus" title="增大圆角（按住连续）"
            :disabled="props.disabled" @pointerdown="startRadius(1)" @pointerup="stopNudge" @pointerleave="stopNudge"
          >＋</button>
        </span>
      </div>

      <div v-if="hasColor" class="field">
        <span class="name">颜色</span>
        <span class="axes">
          <input
            data-test="property-color-swatch" class="picker" type="color" :disabled="props.disabled"
            :value="color" @input="onColor"
          />
          <input data-test="property-color" :value="color" :disabled="props.disabled" @change="onColor" />
          <button
            data-test="pick-color"
            class="picker-button"
            :class="{ on: props.picking }"
            title="在上方原图上点像素取色"
            :disabled="props.disabled"
            @click="!props.disabled && emit('toggle-picking')"
          >吸管</button>
        </span>
      </div>

      <template v-if="isText">
        <div class="field">
          <span class="name">字号</span>
          <span class="axes">
            <input
              data-test="property-font-size" type="number" min="1" step="0.5" :disabled="props.disabled"
              :value="fontSize || ''" placeholder="未测" @change="onFontSize"
            />
            <select data-test="property-font-weight" :value="fontWeight" :disabled="props.disabled" @change="onFontWeight">
              <option v-for="w in WEIGHTS" :key="w" :value="w">{{ w }}</option>
            </select>
          </span>
        </div>
        <div class="field">
          <span class="name" />
          <span class="axes">
            <button data-test="measure-font" class="wide" :disabled="props.disabled || fontBlocked !== ''" @click="!props.disabled && fontBlocked === '' && emit('measure-font')">
              渲染比对测字号字重
            </button>
          </span>
        </div>
        <p v-if="fontBlocked" data-test="font-blocked" class="note blocked">{{ fontBlocked }}</p>
        <p v-if="props.fontNote" data-test="font-note" class="note">{{ props.fontNote }}</p>
      </template>

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
.properties { pointer-events: auto; }
.properties.disabled { opacity: .7; }
.properties.disabled input, .properties.disabled select, .properties.disabled button { pointer-events: none; }
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
.picker-button { flex: none; min-height: 0; height: 26px; padding: 0 8px; border-radius: 5px; color: var(--text-dim); font-size: 10px; }
.picker-button.on { border-color: var(--accent); color: var(--accent); }
.axes .wide { flex: 1; height: 26px; min-height: 26px; border-radius: 5px; color: var(--text-dim); font-size: 10px; }
.note { margin: 0 0 6px 64px; color: var(--text-faint); font-size: 9px; line-height: 1.5; }
.blocked { color: var(--warn); }
.toggles { display: flex; gap: 4px; }
.toggles button { min-height: 0; padding: 2px 8px; border-radius: 4px; color: var(--text-faint); font-size: 9px; }
.toggles button.on { border-color: var(--accent); color: var(--accent); }
</style>
