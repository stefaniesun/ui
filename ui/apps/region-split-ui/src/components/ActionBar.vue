<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import type { Store } from "../state.js";

const props = defineProps<{ store: Store }>();
const renaming = ref(false);
const name = ref("");
const locked = computed(() => props.store.busy.value || props.store.needsAnalysis.value);
const editingLocked = computed(() => locked.value || props.store.mode.value === "split");
let repeatTimer: number | undefined;

function beginRename() {
  const region = props.store.regions.value.find(item => item.id === props.store.selectedIds.value[0]);
  name.value = region?.displayName ?? "";
  renaming.value = true;
}
function commitRename() {
  const id = props.store.selectedIds.value[0];
  if (!locked.value && id && name.value.trim()) props.store.rename(id, name.value.trim());
  renaming.value = false;
}
function startNudge(delta: number) {
  void props.store.nudge(delta);
  window.clearInterval(repeatTimer);
  repeatTimer = window.setInterval(() => void props.store.nudge(delta), 120);
}
function stopNudge() { window.clearInterval(repeatTimer); repeatTimer = undefined; }
onBeforeUnmount(stopNudge);
</script>

<template>
  <div class="action-bar" @pointerdown.stop>
    <button :disabled="!props.store.canUndo.value || editingLocked" title="撤销 (Ctrl+Z)" @click="props.store.undo()">↶</button>
    <button :disabled="!props.store.canRedo.value || editingLocked" title="重做 (Ctrl+Shift+Z)" @click="props.store.redo()">↷</button>
    <span class="divider" />
    <button :disabled="props.store.selectedIds.value.length !== 1 || editingLocked" title="边界上移" @pointerdown="startNudge(-1)" @pointerup="stopNudge" @pointerleave="stopNudge">↑</button>
    <button :disabled="props.store.selectedIds.value.length !== 1 || editingLocked" title="边界下移" @pointerdown="startNudge(1)" @pointerup="stopNudge" @pointerleave="stopNudge">↓</button>
    <button :class="{ active: props.store.mode.value === 'split' }" :disabled="props.store.selectedIds.value.length !== 1 || locked" @click="props.store.mode.value === 'split' ? props.store.cancelSplit() : props.store.beginSplit()">{{ props.store.mode.value === 'split' ? '取消拆分' : '拆分' }}</button>
    <button :disabled="!props.store.canMerge.value || editingLocked" @click="props.store.merge()">合并</button>
    <button :disabled="props.store.selectedIds.value.length !== 1 || editingLocked" @click="beginRename">重命名</button>
    <form v-if="renaming" class="rename" @submit.prevent="commitRename">
      <input v-model="name" aria-label="区域名称" :disabled="locked" autofocus @keydown.escape="renaming = false" />
      <button type="submit" :disabled="locked">确定</button>
    </form>
    <span class="selection-info">已选 {{ props.store.selectedIds.value.length }}</span>
  </div>
</template>

<style scoped>
.action-bar { min-height: 42px; display: flex; align-items: center; gap: 5px; padding: 6px 8px; border-bottom: 1px solid var(--border); background: var(--bg-node-header); }
button { min-width: 34px; height: 28px; min-height: 28px; padding: 0 9px; font-size: 11px; }.active { border-color: var(--accent); color: white; background: var(--accent); }
.divider { width: 1px; height: 20px; margin: 0 3px; background: var(--border); }.selection-info { margin-left: auto; color: var(--text-faint); font-size: 10px; }
.rename { display: flex; gap: 4px; }.rename input { width: 120px; height: 28px; min-height: 28px; font-size: 11px; }
</style>
