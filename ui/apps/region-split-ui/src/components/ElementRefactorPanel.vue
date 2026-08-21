<script setup lang="ts">
import { ref } from "vue";
import type { RefactorDiffItem, RefactorSessionResponse } from "@region-split/core/browser";
import AiProcessingIndicator from "./AiProcessingIndicator.vue";
export interface SelectedElementReference { number: string; displayName: string }
const props = defineProps<{
  session: RefactorSessionResponse | null;
  messages: Array<{ role: string; content: string }>;
  diffs: RefactorDiffItem[];
  busy: boolean;
  error: string;
  selectedReference: SelectedElementReference | null;
}>();
const emit = defineEmits<{ send: [instruction: string]; apply: []; reset: []; discard: []; "set-view": [view: "original" | "candidate"] }>();
const instruction = ref("");
const pendingInstruction = ref("");
function submit() {
  const value = instruction.value.trim();
  if (!value || props.busy || !props.selectedReference) return;
  pendingInstruction.value = value;
  emit("send", value);
}
function clearSubmitted() {
  if (instruction.value.trim() === pendingInstruction.value) instruction.value = "";
  pendingInstruction.value = "";
}
defineExpose({ clearSubmitted });
</script>
<template>
  <section class="element-refactor-panel" data-test="ai-refactor-panel">
    <header>
      <strong>AI 结构校准</strong>
      <span v-if="session">候选版本 {{ session.candidateVersion }}</span>
      <span v-else-if="selectedReference" data-test="ai-selected-reference">当前选择：{{ selectedReference.number }} {{ selectedReference.displayName }}</span>
      <span v-else data-test="ai-empty-selection">请选择元素后开始 AI 重构</span>
    </header>
    <div data-test="ai-conversation-scroll" class="conversation-scroll">
      <div v-if="session" class="refactor-view-toggle"><button @click="emit('set-view', 'original')">原始</button><button @click="emit('set-view', 'candidate')">候选</button></div>
      <div v-if="messages.length" class="refactor-messages"><p v-for="(message, index) in messages" :key="index" :class="`is-${message.role}`">{{ message.content }}</p></div>
      <AiProcessingIndicator v-if="busy" mode="inline" label="AI 正在校准结构" />
      <p v-if="error" class="error">{{ error }}</p>
      <div v-if="session" class="refactor-diffs"><strong>结构差异（{{ diffs.length }}）</strong><p v-for="item in diffs" :key="`${item.nodeId}-${item.kind}`">{{ item.kind }} · {{ item.after?.displayName ?? item.before?.displayName ?? item.nodeId }}</p></div>
    </div>
    <footer v-if="session"><button :disabled="busy" data-test="ai-apply" @click="emit('apply')">应用变更</button><button :disabled="busy" @click="emit('reset')">重置候选</button><button :disabled="busy" @click="emit('discard')">放弃重构</button></footer>
    <div data-test="ai-composer" class="composer">
      <textarea v-model="instruction" data-test="ai-instruction" placeholder="描述需要补齐或重构的真实组件层级，可直接引用元素编号" :disabled="busy || !selectedReference" @keydown.ctrl.enter.prevent="submit" />
      <button data-test="ai-send" :disabled="busy || !selectedReference || !instruction.trim()" @click="submit">{{ session ? '继续调整' : '生成结构' }}</button>
    </div>
  </section>
</template>

<style scoped>
.element-refactor-panel { min-height: 150px; max-height: 240px; display: flex; flex-direction: column; gap: 10px; padding: 12px; overflow: hidden; border-top: 1px solid var(--border); background: var(--bg-node); }
header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; color: var(--text-faint); font-size: 10px; line-height: 1.4; }
header strong { flex: 0 0 auto; color: var(--text); font-size: 11px; }
.conversation-scroll { min-height: 0; flex: 1; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; }
.refactor-messages p, .refactor-diffs p { margin: 3px 0; color: var(--text-dim); font-size: 10px; line-height: 1.5; }
.composer { min-width: 0; flex: 0 0 auto; display: flex; flex-wrap: wrap; gap: 8px; align-items: stretch; }
textarea { min-width: 0; min-height: 72px; flex: 1 1 140px; resize: none; }
.composer button { flex: 0 1 auto; align-self: stretch; white-space: nowrap; }
footer { flex: 0 0 auto; display: flex; flex-wrap: wrap; gap: 6px; }
.error { margin: 0; color: var(--danger); font-size: 10px; }
</style>
