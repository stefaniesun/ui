<script setup lang="ts">
import {
  computed, nextTick, onBeforeUnmount, onMounted, ref, watch,
  type CSSProperties,
} from "vue";
import type { Store } from "../../state.js";
import { imageUrl } from "../../api.js";
import ActionBar from "../../components/ActionBar.vue";
import RegionCanvas from "../../components/RegionCanvas.vue";
import RegionList from "../../components/RegionList.vue";

export interface RegionNodeError {
  title: string;
  message: string;
  configPath?: string;
  retryable: boolean;
}

const props = defineProps<{
  store: Store;
  hoveredId: string | null;
  showPanels: boolean;
}>();
const emit = defineEmits<{
  hover: [id: string | null];
  uploaded: [];
  error: [error: RegionNodeError];
}>();
const input = ref<HTMLInputElement | null>(null);
const analysisFailed = ref(false);
const configured = computed(() => Boolean(
  props.store.modelConfig.value?.baseUrl
  && props.store.modelConfig.value?.model
  && props.store.modelConfig.value?.hasApiKey,
));
const analyzed = computed(() => Boolean(props.store.doc.value?.analyzedAt));
const resultReady = computed(() => analyzed.value && !props.store.busy.value && !analysisFailed.value);
const sourceUrl = computed(() => props.store.projectId.value ? imageUrl(props.store.projectId.value) : "");
const imageAspect = computed(() => {
  const image = props.store.doc.value?.image;
  return image ? `${image.width} / ${image.height}` : "1 / 1";
});
const originalImageEl = ref<HTMLImageElement | null>(null);
const imageDisplayHeight = ref(0);
let imageResizeObserver: ResizeObserver | null = null;

const internalBoundaryGuides = computed(() => {
  const documentHeight = props.store.doc.value?.image.height ?? 0;
  if (!resultReady.value || documentHeight <= 0 || imageDisplayHeight.value <= 0) return [];
  const scale = imageDisplayHeight.value / documentHeight;
  return props.store.regions.value.slice(1).map(region => ({
    id: region.id,
    top: region.bounds.y * scale,
  }));
});

const comparisonImagesStyle = computed<CSSProperties>(() => ({
  "--image-aspect": imageAspect.value,
  gridTemplateColumns: "repeat(2, minmax(0, 430px))",
  gap: "0px",
}));
const guideLayerStyle = computed<CSSProperties>(() => ({
  height: `${imageDisplayHeight.value}px`,
  left: "calc(50% - 32px)",
  pointerEvents: "none",
}));

function guideStyle(top: number): CSSProperties {
  return { top: `${top}px`, width: "32px", pointerEvents: "none" };
}

function measureOriginalImage() {
  imageDisplayHeight.value = originalImageEl.value?.clientHeight ?? 0;
}

function observeOriginalImage() {
  imageResizeObserver?.disconnect();
  imageResizeObserver = null;
  const image = originalImageEl.value;
  if (!image || typeof ResizeObserver === "undefined") {
    measureOriginalImage();
    return;
  }
  imageResizeObserver = new ResizeObserver(measureOriginalImage);
  imageResizeObserver.observe(image);
  measureOriginalImage();
}

watch(sourceUrl, async () => {
  await nextTick();
  observeOriginalImage();
});

onMounted(observeOriginalImage);
onBeforeUnmount(() => imageResizeObserver?.disconnect());

function reportConfigurationError() {
  emit("error", {
    title: "AI 模型未配置",
    message: "使用区域分析功能前必须配置 AI 模型。",
    configPath: props.store.modelConfig.value?.configPath,
    retryable: false,
  });
}

function reportAnalysisError() {
  analysisFailed.value = true;
  emit("error", {
    title: "AI 区域分析失败",
    message: props.store.error.value || "AI 区域分析失败，请检查模型配置后重试。",
    configPath: props.store.modelConfig.value?.configPath,
    retryable: true,
  });
}

async function retryAnalysis() {
  if (props.store.busy.value) return;
  if (!configured.value) {
    reportConfigurationError();
    return;
  }
  analysisFailed.value = false;
  await props.store.analyze();
  if (props.store.error.value || !analyzed.value) reportAnalysisError();
}

async function uploadAndAnalyze(file: File | undefined) {
  if (!file || props.store.busy.value) return;
  if (!props.store.modelConfig.value) await props.store.loadModelConfig();
  if (!configured.value) {
    reportConfigurationError();
    return;
  }
  analysisFailed.value = false;
  await props.store.uploadImage(file);
  if (props.store.error.value || !props.store.projectId.value || !props.store.doc.value?.image) {
    emit("error", {
      title: "图片上传失败",
      message: props.store.error.value || "图片上传或预处理失败，请重新选择图片。",
      retryable: false,
    });
    return;
  }
  emit("uploaded");
  await props.store.analyze();
  if (props.store.error.value || !analyzed.value) reportAnalysisError();
}

async function onFile(event: Event) {
  const target = event.target as HTMLInputElement;
  await uploadAndAnalyze(target.files?.[0]);
  target.value = "";
}

async function onDrop(event: DragEvent) {
  await uploadAndAnalyze(event.dataTransfer?.files[0]);
}

defineExpose({ retryAnalysis, markAnalysisFailed: reportAnalysisError });
</script>

<template>
  <div class="regions-node" @pointerdown.stop @click.stop>
    <input ref="input" class="file-input" type="file" accept="image/png,image/jpeg,image/webp" @change="onFile" />

    <div v-if="!props.store.doc.value?.image" class="upload-state" @dragover.prevent @drop.prevent="onDrop">
      <button class="upload-button" :disabled="props.store.busy.value" @click="input?.click()">选择图片</button>
      <span>或拖放图片到这里，上传后将自动 AI 分析</span>
      <button data-test="refresh-model-config" class="text-button" @click="props.store.loadModelConfig()">刷新模型配置</button>
    </div>

    <template v-else>
      <ActionBar v-if="resultReady" :store="props.store" />
      <div data-test="comparison-workspace" class="comparison-workspace">
        <div class="comparison-images" :style="comparisonImagesStyle">
          <section class="image-panel">
            <header>原始效果图</header>
            <div class="image-frame">
              <img
                ref="originalImageEl"
                data-test="original-image"
                class="comparison-image"
                :src="sourceUrl"
                alt="原始效果图"
                @load="measureOriginalImage"
              />
            </div>
          </section>
          <section class="image-panel analysis-panel">
            <header>区域分析图</header>
            <RegionCanvas
              v-if="resultReady"
              data-test="analysis-result"
              :store="props.store"
              :hovered-id="props.hoveredId"
              :show-panels="props.showPanels"
              @hover="emit('hover', $event)"
            />
            <div v-else class="image-frame analysis-placeholder">
              <img data-test="analysis-image" class="comparison-image placeholder-image" :src="sourceUrl" alt="区域分析底图" />
              <div v-if="props.store.busy.value" data-test="analysis-loading" class="analysis-state">AI 正在解析区域</div>
              <div v-else-if="analysisFailed" data-test="analysis-failed" class="analysis-state analysis-error">
                <strong>AI 区域分析失败</strong>
                <button @click="retryAnalysis">重新分析</button>
              </div>
              <div v-else class="analysis-state">等待 AI 区域分析</div>
            </div>
          </section>
          <div
            v-if="internalBoundaryGuides.length"
            data-test="boundary-guides"
            class="boundary-guides"
            :style="guideLayerStyle"
            aria-hidden="true"
          >
            <span
              v-for="guide in internalBoundaryGuides"
              :key="guide.id"
              data-test="boundary-guide"
              class="boundary-guide"
              :style="guideStyle(guide.top)"
            />
          </div>
        </div>
        <aside class="region-list-column">
          <RegionList
            v-if="resultReady"
            :store="props.store"
            :hovered-id="props.hoveredId"
            @hover="emit('hover', $event)"
          />
          <div v-else class="list-placeholder">分析完成后显示区域列表</div>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.regions-node { margin: -14px; overflow: hidden; border-radius: 0 0 9px 9px; }
.file-input { display: none; }
.upload-state { min-height: 540px; display: grid; place-content: center; justify-items: center; gap: 10px; color: var(--muted); background: #0e1118; }
.upload-button,
.analysis-state button { border: 1px solid var(--accent); border-radius: 6px; padding: 9px 16px; color: white; background: var(--accent); cursor: pointer; }
.text-button { border: 0; color: var(--accent); background: transparent; cursor: pointer; }
.comparison-workspace { display: grid; grid-template-columns: minmax(0, 1fr) 245px; align-items: start; background: var(--bg-inset); }
.comparison-images { position: relative; display: grid; grid-template-columns: repeat(2, minmax(0, 430px)); gap: 0; align-items: start; }
.boundary-guides {
  position: absolute; z-index: 6; top: 28px; left: calc(50% - 32px); width: 32px;
  overflow: visible; pointer-events: none;
}
.boundary-guide {
  position: absolute; left: 0; height: 1px; background: #4c8dff66; pointer-events: none;
}
.image-panel { min-width: 0; margin: 0; padding: 0; overflow: hidden; background: #0a0d13; }
.image-panel + .image-panel { box-shadow: inset 1px 0 var(--border); }
.image-panel header { height: 28px; display: flex; align-items: center; padding: 0 9px; border-bottom: 1px solid var(--border); color: var(--text-dim); background: var(--bg-node-header); font-size: 10px; }
.image-frame { position: relative; width: 100%; aspect-ratio: var(--image-aspect); margin: 0; padding: 0; overflow: hidden; background: #0a0d13; }
.comparison-image { display: block; width: 100%; height: auto; }
.analysis-placeholder { display: grid; }
.analysis-placeholder > * { grid-area: 1 / 1; }
.placeholder-image { opacity: .2; }
.analysis-state { z-index: 1; display: grid; place-content: center; justify-items: center; gap: 10px; color: var(--muted); background: #0e1118cc; }
.analysis-error { color: #ffb4b4; }
.region-list-column { min-height: 100%; border-left: 1px solid var(--border); background: var(--bg-node); }
.list-placeholder { min-height: 420px; display: grid; place-items: center; padding: 20px; color: var(--text-faint); font-size: 10px; text-align: center; }
.region-list-column :deep(.list) { min-height: 100%; }
</style>
