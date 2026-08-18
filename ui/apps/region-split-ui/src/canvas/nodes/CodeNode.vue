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
const generationKey = computed(() => {
  const rect = props.region.bounds;
  return `${props.projectId}:${props.region.id}:${rect.x}:${rect.y}:${rect.w}:${rect.h}`;
});
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
watch(generationKey, () => {
  requestVersion += 1;
  code.value = null;
  error.value = "";
  busy.value = false;
  void generate();
}, { immediate: true });

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
    <div v-if="busy && !code" data-test="code-loading" class="loading" role="status" aria-live="polite">
      <span class="spinner" aria-hidden="true" />
      <strong>正在生成代码</strong>
      <span class="loading-dots" aria-hidden="true"><i /><i /><i /></span>
      <small>正在分析区域结构并生成 HTML 与 CSS，请稍候</small>
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
.loading { min-height: 230px; display: grid; grid-template-columns: auto auto auto; align-content: center; justify-content: center; align-items: center; gap: 10px; color: var(--text); background: radial-gradient(circle at center, color-mix(in srgb, var(--accent) 9%, transparent), transparent 55%); }
.spinner { width: 20px; height: 20px; box-sizing: border-box; border: 2px solid var(--border-strong); border-top-color: var(--accent); border-radius: 50%; animation: spin .8s linear infinite; }
.loading strong { font-size: 12px; }
.loading small { grid-column: 1 / -1; color: var(--text-faint); text-align: center; }
.loading-dots { display: flex; align-items: center; gap: 3px; }
.loading-dots i { width: 4px; height: 4px; border-radius: 50%; background: var(--accent); animation: pulse 1s ease-in-out infinite; }
.loading-dots i:nth-child(2) { animation-delay: .15s; }.loading-dots i:nth-child(3) { animation-delay: .3s; }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse { 0%, 60%, 100% { opacity: .25; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }
@media (prefers-reduced-motion: reduce) { .spinner, .loading-dots i { animation: none; } }
.compare header { height: 26px; display: flex; align-items: center; padding: 0 9px; border-bottom: 1px solid var(--border); color: var(--text-dim); background: var(--bg-node-header); font-size: 10px; }
.stack { position: relative; width: 100%; overflow: hidden; background: #0a0d13; }
.source { display: block; width: 100%; height: auto; }
.frame { position: absolute; left: 0; top: 0; width: 100%; height: 100%; border: 0; background: transparent; }
</style>
