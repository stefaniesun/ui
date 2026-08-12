<script setup lang="ts">
import { computed } from "vue";
import { MIN_REGION_HEIGHT } from "@region-split/core/browser";
import type { Store } from "../state.js";

const props = defineProps<{ store: Store }>();
const emit = defineEmits<{ pickFile: [file: File] }>();

const selected = computed(() => props.store.selectedRegion.value);
const multi = computed(() => props.store.selectedIds.value.length > 1);
const splitting = computed(() => props.store.mode.value === "split");
// 拆出两个块各自至少要 MIN_REGION_HEIGHT，否则进了拆分模式点哪都无效——
// 和 [▲][▼] 一样，在选区不满足条件时直接禁用按钮。
const canSplit = computed(() => (selected.value?.bounds.h ?? 0) >= MIN_REGION_HEIGHT * 2);
// 配置文件的完整路径由服务端给出（它才知道自己在读哪个文件），
// 界面上只显示文件名，完整路径放进 title。
const configFileName = computed(() => {
  const path = props.store.modelConfig.value?.configPath;
  return path ? path.split(/[\\/]/).pop() : "region-split.config.json";
});

function onFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) emit("pickFile", file);
}

function onAnalyze() {
  if (!window.confirm("重新分析会覆盖当前所有人工调整，继续？")) return;
  void props.store.analyze();
}

// [▲][▼] 长按连续触发：mousedown 后延迟 400ms 开始，此后每 60ms 触发一次，
// mouseup/mouseleave 停止。单击（未触发长按）仍只调整一次。因为 mousedown
// 后浏览器必然还会补发一次 click，一旦长按已经至少重复过一次，要吞掉那次
// 尾随的 click，否则会变成多调整一次。
const REPEAT_DELAY_MS = 400;
const REPEAT_INTERVAL_MS = 60;
let repeatDelayTimer: ReturnType<typeof setTimeout> | null = null;
let repeatIntervalTimer: ReturnType<typeof setInterval> | null = null;
let suppressNextClick = false;

function clearRepeatTimers() {
  if (repeatDelayTimer) { clearTimeout(repeatDelayTimer); repeatDelayTimer = null; }
  if (repeatIntervalTimer) { clearInterval(repeatIntervalTimer); repeatIntervalTimer = null; }
}

function startPress(delta: number) {
  suppressNextClick = false;
  clearRepeatTimers();
  repeatDelayTimer = setTimeout(() => {
    suppressNextClick = true;
    props.store.nudge(delta);
    repeatIntervalTimer = setInterval(() => props.store.nudge(delta), REPEAT_INTERVAL_MS);
  }, REPEAT_DELAY_MS);
}

function endPress() {
  clearRepeatTimers();
}

function onNudgeClick(delta: number) {
  if (suppressNextClick) { suppressNextClick = false; return; }
  props.store.nudge(delta);
}
</script>

<template>
  <div class="toolbar">
    <div class="row global">
      <input
        type="file" accept="image/*" data-test="file"
        :disabled="props.store.busy.value"
        @change="onFile"
      />
      <button
        data-test="analyze"
        :disabled="!props.store.projectId.value || !props.store.isModelConfigured.value || props.store.busy.value"
        @click="onAnalyze"
      >{{ props.store.busy.value ? "分析中…" : "重新分析" }}</button>
      <span v-if="props.store.busy.value" data-test="busy" class="busy">处理中…</span>
      <span class="spacer" />
      <span
        v-if="!props.store.isModelConfigured.value"
        data-test="model-warning"
        class="warning"
        :title="`在 ${props.store.modelConfig.value?.configPath ?? 'region-split.config.json'} 中配置模型后重启服务`"
      >
        未配置模型：请编辑 {{ configFileName }}
      </span>
      <span v-else data-test="model-name" class="model-name">
        {{ props.store.modelConfig.value?.model }}
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
          :disabled="!props.store.canMerge.value || props.store.busy.value"
          :title="props.store.canMerge.value ? '' : '只能合并相邻区域'"
          @click="props.store.merge()"
        >合并</button>
      </template>
      <template v-else-if="selected">
        <span>已选：{{ selected.displayName }}</span>
        <button
          data-test="nudge-up"
          :disabled="!props.store.canNudge.value || props.store.busy.value"
          @click="onNudgeClick(-1)"
          @mousedown="startPress(-1)"
          @mouseup="endPress"
          @mouseleave="endPress"
        >▲</button>
        <button
          data-test="nudge-down"
          :disabled="!props.store.canNudge.value || props.store.busy.value"
          @click="onNudgeClick(1)"
          @mousedown="startPress(1)"
          @mouseup="endPress"
          @mouseleave="endPress"
        >▼</button>
        <span class="hint">微调下边界</span>
        <button data-test="split" :disabled="!canSplit || props.store.busy.value" @click="props.store.beginSplit()">拆分</button>
        <button data-test="rename" :disabled="props.store.busy.value" @click="props.store.startRename(selected.id)">重命名</button>
        <button
          data-test="ai-rename"
          :disabled="!props.store.isModelConfigured.value || props.store.busy.value"
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
.warning { font-size: 12px; color: #e2a400; cursor: help; }
.model-name { font-size: 12px; color: #888; }
.busy { font-size: 12px; color: #2f6fed; }
.error { margin-left: 12px; color: #d0454c; }
button:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
