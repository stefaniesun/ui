<script setup lang="ts">
import { elementKinds, type ElementKind, type ElementNode } from "@region-split/core/browser";

const props = defineProps<{ node: ElementNode | null }>();
const emit = defineEmits<{
  rename: [id: string, displayName: string];
  "set-kind": [id: string, kind: ElementKind];
}>();

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
      <!-- 位置尺寸是测量结果，只读；要改形状请在图上框选新增 -->
      <div class="field">
        <span>位置尺寸</span>
        <code data-test="property-box">{{ props.node.box.x }}, {{ props.node.box.y }} · {{ props.node.box.w }}×{{ props.node.box.h }}</code>
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
</style>
