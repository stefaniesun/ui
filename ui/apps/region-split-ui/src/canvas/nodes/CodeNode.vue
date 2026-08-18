<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { Region } from "@region-split/core/browser";
import { regionImageUrl } from "../../api.js";

const props = defineProps<{
  projectId: string;
  region: Region;
  api: { getCode(projectId: string, y: number, h: number): Promise<{ html: string; css: string }> };
}>();
const bounds = computed(() => props.region.bounds);
const code = ref<{ html: string; css: string } | null>(null);
const error = ref("");
const busy = ref(false);
const opacity = ref(50);
let requestVersion = 0;
watch(bounds, () => { requestVersion += 1; code.value = null; error.value = ""; busy.value = false; });
const srcdoc = computed(() => code.value
  ? `<!doctype html><meta charset="utf-8"><style>*{margin:0;padding:0}html,body{overflow:hidden}${code.value.css}</style>${code.value.html}`
  : "");
const sourceUrl = computed(() => regionImageUrl(props.projectId, bounds.value));

async function generate() {
  if (busy.value) return;
  const rect = bounds.value;
  const version = ++requestVersion;
  busy.value = true;
  error.value = "";
  try {
    const result = await props.api.getCode(props.projectId, rect.y, rect.h);
    if (version === requestVersion) code.value = result;
  } catch (err) {
    if (version !== requestVersion) return;
    const message = (err as Error).message;
    error.value = message.includes("not parsed") ? "这个区域还没有元素树，先在区域详情里解析元素" : message;
    code.value = null;
  } finally {
    if (version === requestVersion) busy.value = false;
  }
}
function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="code-node" @pointerdown.stop @click.stop>
    <div class="bar">
      <button data-test="generate-code" :disabled="busy" @click="generate">{{ busy ? "生成中…" : "生成代码" }}</button>
      <template v-if="code">
        <label class="slider">叠加
          <input data-test="overlay-opacity" type="range" min="0" max="100" :value="opacity" @input="opacity = Number(($event.target as HTMLInputElement).value)">
          <span class="value">{{ opacity }}%</span>
        </label>
        <button @click="download('index.html', code.html)">下载 HTML</button>
        <button @click="download('style.css', code.css)">下载 CSS</button>
      </template>
      <span v-if="error" data-test="code-error" class="error">{{ error }}</span>
    </div>
    <section v-if="code" class="compare">
      <header>生成结果叠在原图上——拖滑块看哪里错位</header>
      <div class="stack" :style="{ aspectRatio: `${bounds.w} / ${bounds.h}` }">
        <img class="source" :src="sourceUrl" alt="区域原图">
        <iframe data-test="code-frame" class="frame" :srcdoc="srcdoc" :style="{ opacity: opacity / 100 }" title="生成结果" sandbox="" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.code-node { display: flex; flex-direction: column; }
.bar { display: flex; align-items: center; gap: 8px; padding: 7px 9px; border-bottom: 1px solid var(--border); font-size: 10px; }
.slider { display: flex; align-items: center; gap: 5px; color: var(--text-dim); }
.slider input { width: 110px; }
.slider .value { width: 30px; }
.error { margin-left: auto; color: var(--danger); }
.compare header { height: 26px; display: flex; align-items: center; padding: 0 9px; border-bottom: 1px solid var(--border); color: var(--text-dim); background: var(--bg-node-header); font-size: 10px; }
.stack { position: relative; width: 100%; overflow: hidden; background: #0a0d13; }
.source { display: block; width: 100%; height: auto; }
.frame { position: absolute; left: 0; top: 0; width: 100%; height: 100%; border: 0; background: transparent; }
</style>
