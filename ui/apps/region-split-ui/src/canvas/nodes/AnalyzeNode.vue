<script setup lang="ts">
import { computed } from "vue";
import type { UiStore } from "../../state.js";

const props = defineProps<{ store: UiStore }>();
const configured = computed(() => props.store.modelConfig.value !== null);
const analyzed = computed(() => props.store.document.value?.analysisState === "analyzed");

async function analyze() {
  if (!props.store.image.value || props.store.busy.value) return;
  if (props.store.regions.value.length > 0 && analyzed.value && !confirm("重新分析会覆盖当前区域，是否继续？")) return;
  await props.store.analyze();
}
</script>

<template>
  <div class="analyze-node">
    <div class="model-card" :class="{ configured }">
      <div class="model-icon">AI</div>
      <div>
        <strong>{{ configured ? props.store.modelConfig.value?.model : "尚未配置模型" }}</strong>
        <small>{{ configured ? "模型连接已就绪" : "配置后可识别语义区域" }}</small>
      </div>
      <span class="state-dot" />
    </div>

    <button v-if="!configured" class="configure" :disabled="props.store.busy.value" @click="props.store.openModelConfig()">配置模型</button>
    <button v-else class="analyze" :disabled="!props.store.image.value || props.store.busy.value" @click="analyze">
      {{ props.store.busy.value ? props.store.busyLabel.value : analyzed ? "重新分析" : "开始 AI 分段" }}
    </button>

    <div class="flow-status">
      <div :class="{ done: props.store.image.value }"><i />接收图片</div>
      <div :class="{ done: props.store.candidateLines.value.length }"><i />读取表面线索</div>
      <div :class="{ done: analyzed }"><i />生成区域文档</div>
    </div>

    <div v-if="props.store.image.value" class="result-summary">
      <span>当前区域</span><strong>{{ props.store.regions.value.length }}</strong>
      <span>分析状态</span><strong :class="{ warning: props.store.needsAnalysis.value }">{{ analyzed ? "已分析" : "待分析" }}</strong>
    </div>
    <p v-if="props.store.error.value" class="error">{{ props.store.error.value }}</p>
  </div>
</template>

<style scoped>
.analyze-node { display: grid; gap: 12px; }
.model-card { display: grid; grid-template-columns: 38px 1fr auto; gap: 10px; align-items: center; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-inset); }
.model-icon { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 8px; color: var(--text-faint); background: var(--bg-node-header); font-weight: 700; }
.model-card.configured .model-icon { color: white; background: var(--accent); }.model-card strong,.model-card small { display: block; }.model-card strong { font-size: 12px; }.model-card small { margin-top: 3px; color: var(--text-faint); font-size: 10px; }
.state-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--warn); }.configured .state-dot { background: var(--ok); box-shadow: 0 0 7px #3ecf8e88; }
.configure,.analyze { width: 100%; min-height: 38px; }.analyze { border-color: var(--accent); background: var(--accent); color: white; }.configure { border-color: var(--warn); color: var(--warn); }
.flow-status { display: grid; gap: 3px; padding: 10px; border-radius: 7px; background: var(--bg-inset); }
.flow-status div { display: flex; align-items: center; gap: 8px; min-height: 28px; color: var(--text-faint); font-size: 11px; }.flow-status i { width: 7px; height: 7px; border-radius: 50%; background: var(--edge-idle); }.flow-status .done { color: var(--text-dim); }.flow-status .done i { background: var(--ok); }
.result-summary { display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 11px; border: 1px solid var(--border); border-radius: 7px; color: var(--text-faint); font-size: 11px; }.result-summary strong { color: var(--text); }.result-summary .warning { color: var(--warn); }
.error { margin: 0; color: var(--danger); font-size: 11px; }
</style>
