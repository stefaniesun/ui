<script setup lang="ts">
import { computed } from "vue";
import type { Store } from "../state.js";

const props = defineProps<{ store: Store }>();
const emit = defineEmits<{ pickFile: [file: File] }>();

const selected = computed(() => props.store.selectedRegion.value);
const multi = computed(() => props.store.selectedIds.value.length > 1);
const splitting = computed(() => props.store.mode.value === "split");

function onFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) emit("pickFile", file);
}

function onAnalyze() {
  if (!window.confirm("重新分析会覆盖当前所有人工调整，继续？")) return;
  void props.store.analyze();
}
</script>

<template>
  <div class="toolbar">
    <div class="row global">
      <input type="file" accept="image/*" data-test="file" @change="onFile" />
      <button
        data-test="analyze"
        :disabled="!props.store.projectId.value || !props.store.isModelConfigured.value"
        @click="onAnalyze"
      >重新分析</button>
      <span class="spacer" />
      <button data-test="model-config" @click="props.store.openConfigDialog()">模型配置</button>
      <span v-if="!props.store.isModelConfigured.value" data-test="model-warning" class="warning">
        未配置模型
      </span>
      <button data-test="undo" :disabled="!props.store.canUndo.value" @click="props.store.undo()">撤销</button>
      <button data-test="redo" :disabled="!props.store.canRedo.value" @click="props.store.redo()">重做</button>
    </div>

    <div class="row context">
      <template v-if="splitting">
        <span>拆分「{{ selected?.displayName }}」—— 移动鼠标选择位置，点击确认</span>
        <button data-test="cancel-split" @click="props.store.cancelSplit()">取消</button>
      </template>
      <template v-else-if="multi">
        <span>已选 {{ props.store.selectedIds.value.length }} 个区域</span>
        <button
          data-test="merge"
          :disabled="!props.store.canMerge.value"
          :title="props.store.canMerge.value ? '' : '只能合并相邻区域'"
          @click="props.store.merge()"
        >合并</button>
      </template>
      <template v-else-if="selected">
        <span>已选：{{ selected.displayName }}</span>
        <button data-test="nudge-up" :disabled="!props.store.canNudge.value" @click="props.store.nudge(-1)">▲</button>
        <button data-test="nudge-down" :disabled="!props.store.canNudge.value" @click="props.store.nudge(1)">▼</button>
        <span class="hint">微调下边界</span>
        <button data-test="split" @click="props.store.beginSplit()">拆分</button>
        <button data-test="rename" @click="props.store.startRename(selected.id)">重命名</button>
        <button
          data-test="ai-rename"
          :disabled="!props.store.isModelConfigured.value"
          @click="props.store.aiRename(selected.id)"
        >AI 重命名</button>
      </template>
    </div>

    <div class="row status" data-test="status">
      <template v-if="selected">
        y {{ selected.bounds.y }} → {{ selected.bounds.y + selected.bounds.h }} &nbsp; h {{ selected.bounds.h }}
      </template>
      <template v-else>↑↓ 微调下边界 · Ctrl+Z 撤销</template>
      <span v-if="props.store.error.value" class="error">{{ props.store.error.value }}</span>
    </div>
  </div>
</template>

<style scoped>
.toolbar { display: flex; flex-direction: column; }
.row { display: flex; align-items: center; gap: 8px; padding: 6px 10px; }
.global { border-bottom: 1px solid #eee; }
.context { min-height: 32px; border-bottom: 1px solid #eee; }
.status { font-size: 12px; color: #666; }
.spacer { flex: 1; }
.hint { font-size: 12px; color: #888; }
.warning { font-size: 12px; color: #e2a400; }
.error { margin-left: 12px; color: #d0454c; }
button:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
