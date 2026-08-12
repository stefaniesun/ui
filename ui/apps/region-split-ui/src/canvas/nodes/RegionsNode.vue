<script setup lang="ts">
import { computed, ref } from "vue";
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
  showCandidateLines: boolean;
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
const sourceUrl = computed(() => props.store.projectId.value ? imageUrl(props.store.projectId.value) : "");

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
  if (!analyzed.value) reportAnalysisError();
}

async function uploadAndAnalyze(file: File | undefined) {
  if (!file || props.store.busy.value) return;
  if (!configured.value) {
    reportConfigurationError();
    return;
  }
  analysisFailed.value = false;
  await props.store.uploadImage(file);
  if (!props.store.projectId.value || !props.store.doc.value?.image || props.store.error.value) return;
  emit("uploaded");
  await props.store.analyze();
  if (!analyzed.value) reportAnalysisError();
}

async function onFile(event: Event) {
  const target = event.target as HTMLInputElement;
  await uploadAndAnalyze(target.files?.[0]);
  target.value = "";
}

async function onDrop(event: DragEvent) {
  await uploadAndAnalyze(event.dataTransfer?.files[0]);
}

defineExpose({ retryAnalysis });
</script>

<template>
  <div class="regions-node" @pointerdown.stop @click.stop @wheel.stop>
    <input ref="input" class="file-input" type="file" accept="image/png,image/jpeg,image/webp" @change="onFile" />

    <div v-if="!props.store.doc.value?.image" class="upload-state" @dragover.prevent @drop.prevent="onDrop">
      <button class="upload-button" :disabled="props.store.busy.value" @click="input?.click()">选择图片</button>
      <span>或拖放图片到这里，上传后将自动 AI 分析</span>
      <button data-test="refresh-model-config" class="text-button" @click="props.store.loadModelConfig()">刷新模型配置</button>
    </div>

    <template v-else>
      <div class="source-preview">
        <img data-test="original-image" :src="sourceUrl" alt="原始效果图" />
      </div>
      <div v-if="props.store.busy.value && !analyzed" data-test="analysis-loading" class="analysis-state">
        AI 正在解析区域
      </div>
      <div v-else-if="analysisFailed" data-test="analysis-failed" class="analysis-state analysis-error">
        <strong>AI 区域分析失败</strong>
        <button @click="retryAnalysis">重新分析</button>
      </div>
      <div v-else-if="analyzed" data-test="analysis-result">
        <ActionBar :store="props.store" />
        <div class="regions-workspace">
          <RegionCanvas
            :store="props.store"
            :hovered-id="props.hoveredId"
            :show-candidate-lines="props.showCandidateLines"
            :show-panels="props.showPanels"
            @hover="emit('hover', $event)"
          />
          <RegionList :store="props.store" :hovered-id="props.hoveredId" @hover="emit('hover', $event)" />
        </div>
      </div>
      <div v-else class="analysis-state">等待 AI 区域分析</div>
    </template>
  </div>
</template>

<style scoped>
.regions-node { margin: -14px; overflow: hidden; border-radius: 0 0 9px 9px; }
.file-input { display: none; }
.upload-state,
.analysis-state { min-height: 540px; display: grid; place-content: center; justify-items: center; gap: 10px; color: var(--muted); background: #0e1118; }
.upload-button,
.analysis-state button { border: 1px solid var(--accent); border-radius: 6px; padding: 9px 16px; color: white; background: var(--accent); cursor: pointer; }
.text-button { border: 0; color: var(--accent); background: transparent; cursor: pointer; }
.source-preview { max-height: 180px; overflow: hidden; border-bottom: 1px solid var(--border); background: #0a0d13; }
.source-preview img { display: block; width: 100%; height: auto; }
.analysis-error { color: #ffb4b4; }
.regions-workspace { display: grid; grid-template-columns: minmax(0, 1fr) 245px; min-height: 560px; }
.regions-workspace :deep(.list) { border-left: 1px solid var(--border); }
</style>
