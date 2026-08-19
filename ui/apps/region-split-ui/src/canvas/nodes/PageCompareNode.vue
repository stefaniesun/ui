<script setup lang="ts">
import { computed, ref } from "vue";
import { imageUrl, type PageCodeOutput } from "../../api.js";
import { pagePreviewDocument } from "../../page-preview.js";

const props = defineProps<{
  projectId: string;
  api: { getPageCode(projectId: string): Promise<PageCodeOutput> };
  imageSize: { w: number; h: number };
}>();

const code = ref<PageCodeOutput | null>(null);
const error = ref("");
const busy = ref(false);
const opacity = ref(50);
const srcdoc = computed(() => code.value ? pagePreviewDocument(code.value) : "");

async function build() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    code.value = await props.api.getPageCode(props.projectId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? "整页代码生成失败");
    error.value = message.includes("not parsed") || message.includes("没有解析")
      ? "还有区域没有解析，整页要等所有区域都解析完"
      : message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="page-compare" @pointerdown.stop @click.stop>
    <div class="bar">
      <button data-test="build-page" :disabled="busy" @click="build">
        {{ busy ? "生成中…" : code ? "重新生成" : "生成整页比对" }}
      </button>
      <label v-if="code" class="slider">
        叠加
        <input data-test="page-opacity" type="range" min="0" max="100" :value="opacity" @input="opacity = Number(($event.target as HTMLInputElement).value)">
        <span class="value">{{ opacity }}%</span>
      </label>
      <span v-if="error" data-test="page-error" class="error">{{ error }}</span>
    </div>

    <section v-if="code" class="compare">
      <header>生成结果叠在原图上——拖滑块看哪里错位</header>
      <div class="scroll">
        <div data-test="page-stack" class="stack" :style="{ aspectRatio: `${props.imageSize.w} / ${props.imageSize.h}` }">
          <img class="source" :src="imageUrl(props.projectId)" alt="整页原图">
          <iframe data-test="page-frame" class="frame" :srcdoc="srcdoc" :style="{ opacity: opacity / 100 }" title="整页生成结果" sandbox="">
          </iframe>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page-compare { display: flex; flex-direction: column; }
.bar { display: flex; align-items: center; gap: 8px; padding: 7px 9px; border-bottom: 1px solid var(--border); font-size: 10px; }
.slider { display: flex; align-items: center; gap: 5px; color: var(--text-dim); }
.slider input { width: 110px; }
.slider .value { width: 30px; }
.error { margin-left: auto; color: var(--danger); }
.compare header { height: 26px; display: flex; align-items: center; padding: 0 9px; border-bottom: 1px solid var(--border); color: var(--text-dim); background: var(--bg-node-header); font-size: 10px; }
.scroll { max-height: 620px; overflow-y: auto; }
.stack { position: relative; width: 100%; background: #0a0d13; }
.source { display: block; width: 100%; height: auto; }
.frame { position: absolute; left: 0; top: 0; width: 100%; height: 100%; border: 0; background: transparent; }
</style>
