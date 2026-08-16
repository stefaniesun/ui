<script setup lang="ts">
import { computed } from "vue";
import type { ElementKind, ElementNode } from "@region-split/core/browser";

const props = defineProps<{
  nodes: ElementNode[];
  selectedId: string | null;
  hoveredId: string | null;
  refactorRootId?: string | null;
  locked?: boolean;
}>();
const emit = defineEmits<{
  select: [id: string];
  hover: [id: string | null];
  remove: [id: string];
  rename: [id: string];
  "start-refactor": [id: string];
}>();

const KIND_LABEL: Record<ElementKind, string> = {
  component: "组件", grid: "网格", text: "文字",
  icon: "图标", image: "图片", decoration: "装饰",
};

/** 按父子关系展平成深度优先序，深度用于缩进 */
const rows = computed(() => {
  const childrenOf = new Map<string | null, ElementNode[]>();
  for (const node of props.nodes) {
    const list = childrenOf.get(node.parentId) ?? [];
    list.push(node);
    childrenOf.set(node.parentId, list);
  }
  const out: { node: ElementNode; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const node of childrenOf.get(parentId) ?? []) {
      out.push({ node, depth });
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
});
</script>

<template>
  <div class="element-tree">
    <p v-if="rows.length === 0" class="empty">尚未解析</p>
    <div
      v-for="{ node, depth } in rows"
      :key="node.id"
      data-test="element-row"
      class="row"
      :class="{
        selected: node.id === props.selectedId,
        hovered: node.id === props.hoveredId,
        uncertain: node.classification === 'uncertain',
        'refactor-root': node.id === props.refactorRootId,
        locked: props.locked && node.id !== props.refactorRootId,
      }"
      :style="{ '--depth': depth }"
      @click="emit('select', node.id)"
      @mouseenter="emit('hover', node.id)"
      @mouseleave="emit('hover', null)"
    >
      <span class="kind" :class="`kind-${node.kind}`">{{ KIND_LABEL[node.kind] }}</span>
      <span
        data-test="element-name"
        class="name"
        @dblclick.stop="emit('rename', node.id)"
      >{{ node.displayName }}</span>
      <span v-if="node.repeat" data-test="element-repeat" class="meta">
        ×{{ node.repeat.count }}
      </span>
      <span v-if="node.layout" data-test="element-layout" class="meta">
        {{ node.layout.direction === "row" ? "→" : "↓" }}{{ node.layout.gap }}
      </span>
      <span v-if="node.scrollX || node.scrollY" class="meta scroll">
        {{ node.scrollX ? "↔" : "" }}{{ node.scrollY ? "↕" : "" }}
      </span>
      <button
        v-if="node.id === props.selectedId && !props.locked"
        data-test="start-ai-refactor"
        class="ai-refactor"
        title="通过 AI 重新分析此节点及全部子节点"
        @click.stop="emit('start-refactor', node.id)"
      >AI</button>
      <button
        v-if="node.id === props.selectedId && !props.locked"
        data-test="element-remove"
        class="remove"
        title="删除这一层，子节点上提"
        @click.stop="emit('remove', node.id)"
      >×</button>
    </div>
  </div>
</template>

<style scoped>
.element-tree { height: 100%; padding: 6px; overflow: auto; background: var(--bg-node); }
.empty { padding: 24px; color: var(--text-faint); font-size: 10px; text-align: center; }
.row.refactor-root { border-color: var(--accent); }
.row.locked { opacity: .38; }
.ai-refactor { margin-left: auto; border: 1px solid var(--accent); border-radius: 4px; background: transparent; color: var(--accent); font-size: 9px; }
.row { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; padding: 5px 6px 5px calc(6px + var(--depth) * 14px); border: 1px solid transparent; border-radius: 5px; background: var(--bg-inset); color: var(--text-dim); cursor: pointer; font-size: 11px; }
.row.hovered { border-color: var(--border-strong); background: #303540; }
.row.selected { border-color: var(--accent); background: var(--accent-soft); }
.row.uncertain { box-shadow: inset 0 0 0 1px var(--warn); }
.kind { flex: none; padding: 1px 5px; border: 1px solid var(--border-strong); border-radius: 4px; color: var(--text-faint); font-size: 9px; }
.kind-grid { border-color: var(--ok); color: var(--ok); }
.kind-image { border-color: var(--warn); color: var(--warn); }
.name { flex: 1; min-width: 0; overflow: hidden; color: var(--text); text-overflow: ellipsis; white-space: nowrap; }
.meta { flex: none; color: var(--text-faint); font-size: 9px; }
.meta.scroll { color: var(--accent); }
.remove { flex: none; min-height: 0; padding: 0 6px; border-color: var(--danger); color: var(--danger); }
</style>
