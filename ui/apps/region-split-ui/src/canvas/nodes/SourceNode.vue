<script setup lang="ts">
import { ref } from "vue";
import type { UiStore } from "../../state.js";
import { imageUrl } from "../../api.js";

const props = defineProps<{ store: UiStore }>();
const emit = defineEmits<{ uploaded: [projectId: string] }>();
const dragging = ref(false);

async function upload(file?: File) {
  if (!file || props.store.busy.value) return;
  const projectId = await props.store.uploadImage(file);
  emit("uploaded", projectId);
}
function onInput(event: Event) { void upload((event.target as HTMLInputElement).files?.[0]); }
function onDrop(event: DragEvent) {
  dragging.value = false;
  void upload(event.dataTransfer?.files?.[0]);
}
</script>

<template>
  <div class="source-node">
    <label
      class="drop-zone"
      :class="{ dragging, populated: props.store.image.value }"
      @dragenter.prevent="dragging = true"
      @dragover.prevent
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <input type="file" accept="image/*" :disabled="props.store.busy.value" @change="onInput" />
      <template v-if="props.store.image.value">
        <img :src="imageUrl(props.store.projectId.value)" :alt="props.store.image.value.fileName" />
        <span class="replace-hint">拖入或点击替换图片</span>
      </template>
      <template v-else>
        <span class="upload-icon">＋</span>
        <strong>拖入 UI 效果图</strong>
        <small>或点击选择图片</small>
      </template>
    </label>
    <dl v-if="props.store.image.value" class="metadata">
      <div><dt>文件</dt><dd :title="props.store.image.value.fileName">{{ props.store.image.value.fileName }}</dd></div>
      <div><dt>尺寸</dt><dd>{{ props.store.image.value.width }} × {{ props.store.image.value.height }}</dd></div>
      <div><dt>格式</dt><dd>{{ props.store.image.value.mime }}</dd></div>
    </dl>
  </div>
</template>

<style scoped>
.source-node { display: grid; gap: 12px; }
.drop-zone { position: relative; min-height: 332px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; overflow: hidden; border: 1px dashed var(--border-strong); border-radius: 8px; color: var(--text-dim); background: var(--bg-inset); cursor: pointer; }
.drop-zone:hover, .drop-zone.dragging { border-color: var(--accent); background: var(--accent-soft); }
.drop-zone input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.drop-zone img { width: 100%; max-height: 350px; object-fit: contain; }
.upload-icon { font-size: 30px; color: var(--accent); }
.drop-zone strong { color: var(--text); font-size: 14px; }
.drop-zone small { color: var(--text-faint); }
.replace-hint { position: absolute; right: 8px; bottom: 8px; padding: 4px 7px; border-radius: 5px; background: #16181ddd; color: var(--text-dim); font-size: 10px; }
.metadata { margin: 0; display: grid; gap: 6px; }
.metadata div { display: grid; grid-template-columns: 48px minmax(0, 1fr); gap: 8px; font-size: 11px; }
dt { color: var(--text-faint); } dd { margin: 0; overflow: hidden; color: var(--text-dim); text-overflow: ellipsis; white-space: nowrap; }
</style>
