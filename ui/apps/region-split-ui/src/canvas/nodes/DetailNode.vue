<script setup lang="ts">
import { computed, watch } from "vue";
import type { ElementKind, Rect, Region } from "@region-split/core/browser";
import ElementOverlay from "../../components/ElementOverlay.vue";
import ElementProperties from "../../components/ElementProperties.vue";
import ElementTree from "../../components/ElementTree.vue";
import type { ElementStore } from "../../element-state.js";

const props = defineProps<{
  projectId: string;
  selectedRegions: Region[];
  elementStore: ElementStore;
  hoveredId?: string | null;
}>();
const emit = defineEmits<{ hover: [id: string | null] }>();

const single = computed(() =>
  props.selectedRegions.length === 1 ? props.selectedRegions[0]! : null);
const region = computed<Rect | null>(() => single.value?.bounds ?? null);
const nodes = computed(() => props.elementStore.nodes.value);
const parsed = computed(() => props.elementStore.tree.value !== null);
/**
 * 阶段一只检测顶层容器，文字和图标这类小元素达不到最小尺寸门槛。
 * 解析完却一个都没有是正常的，界面必须说清楚，不然看起来像坏了。
 */
const emptyResult = computed(() => parsed.value && nodes.value.length === 0);

// 选中的区域一变就重新载入。边界变了 regionKey 就失配，界面自然回到"未解析"——
// 区域范围变了，树本来就该重算。
watch(region, async next => {
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
          :disabled="props.elementStore.busy.value"
          @click="detect"
        >{{ parsed ? "重新解析" : "解析元素" }}</button>
        <span class="label">{{ single?.displayName }}</span>
        <span class="label">{{ region.w }}×{{ region.h }}</span>
        <span v-if="props.elementStore.busy.value" class="label">
          {{ props.elementStore.busyLabel.value }}
        </span>
        <span v-if="props.elementStore.error.value" data-test="detail-error" class="error">
          {{ props.elementStore.error.value }}
        </span>
      </div>

      <section data-test="detail-image" class="image-section">
        <header>区域原图</header>
        <ElementOverlay
          :project-id="props.projectId"
          :region="region"
          :nodes="nodes"
          :selected-id="props.elementStore.selectedId.value"
          :hovered-id="props.hoveredId ?? null"
          @select="props.elementStore.select"
          @hover="emit('hover', $event)"
          @add-container="onAddContainer"
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
          @select="props.elementStore.select"
          @hover="emit('hover', $event)"
          @remove="onRemove"
          @rename="onRenamePrompt"
        />
        <ElementProperties
          :node="props.elementStore.selectedNode.value"
          @rename="onRenameValue"
          @set-kind="onSetKind"
        />
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
.error { margin-left: auto; color: var(--danger); font-size: 10px; }
.image-section { background: #0a0d13; }
.image-section header { height: 26px; display: flex; align-items: center; padding: 0 9px; border-bottom: 1px solid var(--border); color: var(--text-dim); background: var(--bg-node-header); font-size: 10px; }
.empty-result { margin: 0; padding: 8px 10px; border-top: 1px solid var(--border); color: var(--warn); background: #e2a4000f; font-size: 10px; line-height: 1.6; }
/* 上下结构：图占满宽度、高度由区域宽高比决定且不设上限（标注才能纯百分比定位）；
   下段是固定高度的树与属性检查器，不随区域高矮变化。 */
.inspector { height: 320px; display: grid; grid-template-columns: minmax(0, 1fr) 300px; border-top: 1px solid var(--border); }
</style>
