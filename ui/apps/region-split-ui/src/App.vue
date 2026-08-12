<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { httpApi } from "./api.js";
import BusyOverlay from "./components/BusyOverlay.vue";
import ImageCanvas from "./components/ImageCanvas.vue";
import RegionList from "./components/RegionList.vue";
import Toolbar from "./components/Toolbar.vue";
import { createStore } from "./state.js";

const store = createStore(httpApi);

// hover 联动状态放在 App 层（不进 store）：列表 hover 一行 -> 画布对应色块高亮，
// 画布 hover 一个色块 -> 列表对应行高亮。两个组件各自也响应自己的鼠标事件，
// 互相之间只通过这一个 ref 同步。
const hoveredId = ref<string | null>(null);

async function onPickFile(file: File) {
  await store.uploadImage(file);
  if (store.projectId.value) location.hash = store.projectId.value;
}

function onKeydown(event: KeyboardEvent) {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
  if (event.key === "ArrowUp") { event.preventDefault(); store.nudge(-1); return; }
  if (event.key === "ArrowDown") { event.preventDefault(); store.nudge(1); return; }
  // Esc 先退出拆分模式，没在拆分才清空选中——否则拆到一半按 Esc 会连选中一起丢掉
  if (event.key === "Escape") {
    event.preventDefault();
    if (store.mode.value === "split") store.cancelSplit();
    else store.clearSelection();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) store.redo(); else store.undo();
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("beforeunload", store.flushPersist);
  void store.loadModelConfig();
  const hash = location.hash.slice(1);
  if (hash) void store.load(hash);
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("beforeunload", store.flushPersist);
});
</script>

<template>
  <div class="layout">
    <header><Toolbar :store="store" @pick-file="onPickFile" /></header>
    <main>
      <ImageCanvas :store="store" :hovered-id="hoveredId" @hover="id => (hoveredId = id)" />
    </main>
    <aside>
      <RegionList :store="store" :hovered-id="hoveredId" @hover="id => (hoveredId = id)" />
    </aside>
    <BusyOverlay :store="store" />
  </div>
</template>

<style>
html, body, #app { height: 100%; margin: 0; font-family: system-ui, sans-serif; font-size: 13px; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) 260px; grid-template-rows: auto minmax(0, 1fr); height: 100%; }
header { grid-column: 1 / -1; border-bottom: 1px solid #ddd; }
main { min-width: 0; overflow: auto; background: #f0f1f3; }
aside { border-left: 1px solid #ddd; overflow: auto; background: #fff; }

@media (max-width: 900px) {
  .layout { grid-template-columns: minmax(0, 1fr) 220px; }
}
</style>
