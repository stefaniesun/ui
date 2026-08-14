<script setup lang="ts">
import { computed, nextTick, reactive, watch } from "vue";
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
}>();

// 滚动是容器的属性，叶子上没有意义
const isContainer = computed(() =>
  props.node?.kind === "component" || props.node?.kind === "grid");

const KIND_LABEL: Record<ElementKind, string> = {
  component: "组件", grid: "网格", text: "文字",
  icon: "图标", image: "图片", decoration: "装饰",
};

function onRename(event: Event) {
  const value = (event.target as HTMLInputElement).value.trim();
  if (props.node && value) emit("rename", props.node.id, value);
}
/**
 * 输入框绑在本地草稿上，而不是直接绑 props。
 *
 * 直接绑 props 会脱节：改动被 clampBox 收拢或拒绝时属性值可能原样不动，
 * Vue 就不重渲染，输入框里留着刚打进去的脏值——实测输入 -9999 被拒后
 * 框里还显示 -9999，而真实值是 80。草稿跟着 props 走就不会有这个问题。
 */
const draft = reactive({ x: 0, y: 0, w: 0, h: 0 });
watch(() => props.node, node => {
  if (node) Object.assign(draft, node.box);
}, { immediate: true, deep: true });

/**
 * 单个分量改动后连同其余三个一起提交，钳制交给 store。
 *
 * 校验读输入框原值而不是 draft：`v-model.number` 对空串不会给出 NaN，
 * 光判断 draft 拦不住"清空输入框"这种最常见的手滑。
 */
function onBox(axis: "x" | "y" | "w" | "h", event: Event) {
  const raw = (event.target as HTMLInputElement).value.trim();
  const value = Number(raw);
  if (!props.node) return;
  if (raw === "" || !Number.isFinite(value)) {
    Object.assign(draft, props.node.box);          // 非法输入立刻回弹
    return;
  }
  emit("set-box", props.node.id, { ...props.node.box, [axis]: value });
  // 提交后强制回同步一次。钳制后的结果**可能与原值相同**（比如已经贴着父边
  // 还想再往左），这时 props 不变、watch 不触发，输入框就会留着刚打进去的
  // 越界值。这一步兜住那种情况；真的改动了则同步到新值，同样正确。
  void nextTick(() => {
    if (props.node) Object.assign(draft, props.node.box);
  });
}
function onKind(event: Event) {
  const value = (event.target as HTMLSelectElement).value as ElementKind;
  if (props.node) emit("set-kind", props.node.id, value);
}
</script>

<template>
  <div class="properties">
    <p v-if="!props.node" class="empty">选择一个元素查看属性</p>
    <template v-else>
      <label class="field">
        <span>名称</span>
        <input data-test="property-name" :value="props.node.displayName" @change="onRename" />
      </label>
      <label class="field">
        <span>类型</span>
        <select data-test="property-kind" :value="props.node.kind" @change="onKind">
          <option v-for="kind in elementKinds" :key="kind" :value="kind">
            {{ KIND_LABEL[kind] }}
          </option>
        </select>
      </label>
      <!-- 位置尺寸是测量结果，但测量会出错，所以必须能人工微调。
           越界或压到兄弟时由 clampBox 收拢或拒绝，这里不做校验。 -->
      <div class="field">
        <span>位置</span>
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
        <span>尺寸</span>
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
        <span>背景色</span>
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
        <span>主色占比</span>
        <code>{{ props.node.uniformity.toFixed(2) }}</code>
      </div>
      <!-- 布局量是切分的副产品：方向即 flex-direction，间隙即 gap -->
      <template v-if="props.node.layout">
        <div class="field">
          <span>布局</span>
          <code data-test="property-layout">
            {{ props.node.layout.direction === "row" ? "横排 →" : "竖排 ↓" }}
            · gap {{ props.node.layout.gap }}
          </code>
        </div>
        <div class="field">
          <span>内边距</span>
          <code data-test="property-padding">
            {{ props.node.layout.padding.top }} {{ props.node.layout.padding.right }}
            {{ props.node.layout.padding.bottom }} {{ props.node.layout.padding.left }}
          </code>
        </div>
      </template>
      <div v-if="props.node.repeat" class="field">
        <span>重复</span>
        <code data-test="property-repeat">
          ×{{ props.node.repeat.count }} · 间距 {{ Math.round(props.node.repeat.pitch) }}
        </code>
      </div>
      <div v-if="isContainer" class="field">
        <span>滚动</span>
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
        <span>来源</span>
        <code>{{ props.node.source === "manual" ? "人工新增" : "自动检测" }}</code>
      </div>
    </template>
  </div>
</template>

<style scoped>
.properties { height: 100%; padding: 8px; overflow: auto; border-left: 1px solid var(--border); background: var(--bg-node); }
.empty { padding: 24px 8px; color: var(--text-faint); font-size: 10px; text-align: center; }
.field { display: flex; align-items: center; gap: 8px; min-height: 30px; margin-bottom: 4px; font-size: 10px; }
.field > span { flex: none; width: 56px; color: var(--text-faint); }
.field input, .field select { flex: 1; min-width: 0; height: 26px; min-height: 26px; font-size: 10px; }
.field code { flex: 1; min-width: 0; display: flex; align-items: center; gap: 5px; overflow: hidden; color: var(--text-dim); text-overflow: ellipsis; white-space: nowrap; }
.swatch { flex: none; width: 11px; height: 11px; border: 1px solid var(--border-strong); border-radius: 3px; }
.axes { flex: 1; min-width: 0; display: flex; gap: 6px; }
.axes label { flex: 1; min-width: 0; display: flex; align-items: center; gap: 4px; color: var(--text-faint); }
.axes input { width: 100%; min-width: 0; height: 26px; min-height: 26px; padding: 0 5px; font-size: 10px; }
.toggles { display: flex; gap: 4px; }
.toggles button { min-height: 0; padding: 2px 8px; border-radius: 4px; color: var(--text-faint); font-size: 9px; }
.toggles button.on { border-color: var(--accent); color: var(--accent); }
</style>
