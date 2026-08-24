<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{ busy: boolean }>();
const emit = defineEmits<{ upload: [file: File] }>();
const input = ref<HTMLInputElement | null>(null);

function submit(file?: File) {
  if (!props.busy && file) emit("upload", file);
}
function onChange(event: Event) {
  submit((event.target as HTMLInputElement).files?.[0]);
}
function onDrop(event: DragEvent) {
  event.preventDefault();
  submit(event.dataTransfer?.files[0]);
}
</script>

<template>
  <main class="upload-workspace" aria-labelledby="upload-title">
    <section class="phone-upload" aria-label="手机截图上传预览">
      <header class="phone-status-bar"><span>9:41</span><span aria-hidden="true">● ◒ ▰</span></header>
      <div class="phone-screen">
        <div
          class="upload-drop-zone" :class="{ disabled: busy }"
          role="region" aria-label="图片拖放区域"
          @dragover.prevent @drop="onDrop"
        >
          <span class="upload-icon" aria-hidden="true">＋</span>
          <h1 id="upload-title">上传页面截图</h1>
          <strong>拖放 PNG、JPG 或 WebP</strong>
          <p>推荐 375px 宽的手机长截图，上传后将自动进行 AI 分析。</p>
          <button type="button" class="upload-button" :disabled="busy" @click="input?.click()">
            {{ busy ? "正在上传…" : "选择图片" }}
          </button>
          <input
            ref="input" class="visually-hidden" type="file"
            accept="image/png,image/jpeg,image/webp" :disabled="busy" @change="onChange"
          />
        </div>
      </div>
      <span class="phone-home-indicator" aria-hidden="true"></span>
    </section>
  </main>
</template>

<style scoped>
.upload-workspace { height: 100%; min-height: 0; display: grid; place-items: center; overflow: auto; padding: 24px; color: #d9e5f4; background: radial-gradient(circle at 50% 38%, #1a253a 0, #0c1119 54%); }
.phone-upload { height: min(78vh, 680px); max-height: calc(100vh - 48px); aspect-ratio: 9 / 18.5; display: grid; grid-template-rows: 34px 1fr 24px; overflow: hidden; border: 8px solid #05070b; border-radius: min(5vh, 42px); background: #0f1622; box-shadow: 0 20px 64px #000b, inset 0 0 0 1px #39445a; }
.phone-status-bar { display: flex; align-items: center; justify-content: space-between; padding: 7px 19px 0; color: #cbd5e1; font-size: 10px; font-weight: 700; }
.phone-screen { min-height: 0; display: grid; place-items: center; padding: clamp(14px, 3vh, 24px); }
.upload-drop-zone { width: 100%; height: 100%; display: grid; place-content: center; justify-items: center; gap: 11px; padding: 22px 18px; border: 1px dashed #4c6584; border-radius: 22px; color: #91a3bb; text-align: center; background: linear-gradient(180deg, #182236d9, #111925d9); }.upload-drop-zone.disabled { opacity: .62; }.upload-drop-zone h1 { margin: 3px 0 0; color: #eff6ff; font-size: 19px; }.upload-drop-zone strong { color: #d8e4f2; font-size: 13px; }.upload-drop-zone p { max-width: 230px; margin: 0; font-size: 11px; line-height: 1.65; }
.upload-icon { width: 50px; height: 50px; display: grid; place-items: center; margin-bottom: 6px; border: 1px solid #405a7a; border-radius: 50%; color: #66a9ff; background: #14253b; font-size: 29px; font-weight: 200; }
.upload-button { margin-top: 8px; border: 1px solid #3979d1; border-radius: 8px; padding: 10px 21px; color: white; background: #2563a9; cursor: pointer; }.upload-button:disabled { cursor: wait; opacity: .65; }
.phone-home-indicator { width: 92px; height: 4px; align-self: center; justify-self: center; border-radius: 999px; background: #8792a4; opacity: .68; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
@media (max-height: 620px) { .upload-workspace { padding: 12px; }.phone-upload { height: calc(100vh - 24px); }.upload-drop-zone { gap: 7px; }.upload-icon { width: 40px; height: 40px; font-size: 23px; } }
</style>
