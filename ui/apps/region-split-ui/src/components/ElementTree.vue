<script setup lang="ts">
import { computed } from "vue";
import { elementTypes, type ElementNode, type ElementType } from "@region-split/core/browser";
import type { Store } from "../state.js";
const props = defineProps<{ store: Store; regionId: string; parentId?: string | null; level?: number }>();
const nodes = computed(() => props.store.elements.value.filter(item => item.regionId === props.regionId && item.parentId === (props.parentId ?? null)));
function descendants(id: string): Set<string> { const found = new Set([id]); let changed = true; while (changed) { changed = false; for (const item of props.store.elements.value) if (item.parentId && found.has(item.parentId) && !found.has(item.id)) { found.add(item.id); changed = true; } } return found; }
function parentOptions(node: ElementNode) { const blocked = descendants(node.id); return props.store.elements.value.filter(item => item.regionId === node.regionId && item.type === "container" && !blocked.has(item.id) && item.bounds.x <= node.bounds.x && item.bounds.y <= node.bounds.y && item.bounds.x + item.bounds.w >= node.bounds.x + node.bounds.w && item.bounds.y + item.bounds.h >= node.bounds.y + node.bounds.h); }
function updateType(id: string, event: Event) { props.store.changeElementType(id, (event.target as HTMLSelectElement).value as ElementType); }
function updateParent(id: string, event: Event) { props.store.reparentElement(id, (event.target as HTMLSelectElement).value || null); }
</script>
<template>
  <ul class="tree" :class="{ nested: (level ?? 1) > 1 }">
    <li v-for="node in nodes" :key="node.id" :data-element-id="node.id" :aria-level="level ?? 1" :aria-selected="store.selectedElementId.value === node.id"
      :class="{ selected: store.selectedElementId.value === node.id, conflict: node.conflict }" role="treeitem" tabindex="0" @keydown.enter.stop="store.selectElement(node.id)" @keydown.space.prevent.stop="store.selectElement(node.id)"
      @click.stop="store.selectElement(node.id)" @mouseenter="store.hoverElement(node.id)" @mouseleave="store.hoverElement(null)">
      <div class="node-row"><span>{{ node.displayName }}</span><small>{{ node.type }}</small></div>
      <div v-if="store.selectedElementId.value === node.id" class="properties" @click.stop>
        <input aria-label="元素名称" :value="node.displayName" @change="store.renameElement(node.id, ($event.target as HTMLInputElement).value)" />
        <select aria-label="元素类型" :value="node.type" @change="updateType(node.id, $event)"><option v-for="type in elementTypes" :key="type" :value="type">{{ type }}</option></select>
        <select aria-label="父元素" :value="node.parentId ?? ''" @change="updateParent(node.id, $event)"><option value="">区域直属</option><option v-for="parent in parentOptions(node)" :key="parent.id" :value="parent.id">{{ parent.displayName }}</option></select>
        <div class="bounds"><input v-for="key in (['x','y','w','h'] as const)" :key="key" :aria-label="`元素${key}`" type="number" step="1" :min="key === 'w' || key === 'h' ? 4 : 0" :value="node.bounds[key]" @change="store.resizeElement(node.id, { ...node.bounds, [key]: Number(($event.target as HTMLInputElement).value) })" /></div>
        <button type="button" aria-label="删除元素" @click="store.deleteElement(node.id)">删除</button>
      </div>
      <ElementTree :store="store" :region-id="regionId" :parent-id="node.id" :level="(level ?? 1) + 1" />
    </li>
  </ul>
</template>
<style scoped>
.tree { list-style: none; margin: 3px 0; padding: 0; }.tree.nested { padding-left: 14px; border-left: 1px solid #d5dce8; }
li { padding: 4px 6px; border-radius: 4px; font-size: 12px; } li.selected { background: #eaf2ff; outline: 1px solid #2f6fed; } li.conflict { color: #b45309; }
.node-row { display: flex; justify-content: space-between; gap: 8px; cursor: pointer; }.node-row small { color: #788397; }
.properties { display: grid; gap: 4px; margin-top: 5px; }.properties input,.properties select,.properties button { min-width: 0; font-size: 11px; }.bounds { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 3px; }
</style>
