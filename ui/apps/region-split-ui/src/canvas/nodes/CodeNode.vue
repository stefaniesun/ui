<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { Rect, Region } from "@region-split/core/browser";
import { regionImageUrl } from "../../api.js";

const props = defineProps<{
  projectId: string;
  selectedRegions: Region[];
  api: { getCode(projectId: string, y: number, h: number): Promise<{ html: string; css: string }> };
}>();
const single = computed(() => props.selectedRegions.length === 1 ? props.selectedRegions[0]! : null);
const region = computed<Rect | null>(() => single.value?.bounds ?? null);
const code = ref<{ html: string; css: string } | null>(null);
const error = ref("");
const busy = ref(false);
const opacity = ref(50);
watch(region, () => { code.value = null; error.value = ""; });
const srcdoc = computed(() => code.value
  ? `<!doctype html><meta charset="utf-8"><style>*{margin:0;padding:0}html,body{overflow:hidden}${code.value.css}</style>${code.value.html}`
  : "");
const sourceUrl = computed(() => region.value ? regionImageUrl(props.projectId, region.value) : "");

async function generate() {
  const rect = region.value;
  if (!rect || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    code.value = await props.api.getCode(props.projectId, rect.y, rect.h);
  } catch (err) {
    const message = (err as Error).message;
    error.value = message.includes("not parsed") ? "这个区域还没有元素树，先在区域详情里解析元素" : message;
    code.value = null;
  } finally {
    busy.value = false;
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
    <p v-if="!single" class="hint">{{ props.selectedRegions.length > 1 ? "请选择单个区域" : "选择一个区域生成代码" }}</p>
    <template v-else>
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
      <section v-if="code && region" class="compare">
        <header>生成结果叠在原图上——拖滑块看哪里错位</header>
        <div class="stack" :style="{ aspectRatio: `${region.w} / ${region.h}` }">
          <img class="source" :src="sourceUrl" alt="区域原图">
          <iframe data-test="code-frame" class="frame" :srcdoc="srcdoc" :style="{ opacity: opacity / 100 }" title="生成结果" sandbox="" />
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.code-node { display: flex; flex-direction: column; }
.hint { margin: 0; padding: 18px 12px; color: var(--text-dim); font-size: 11px; }
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
