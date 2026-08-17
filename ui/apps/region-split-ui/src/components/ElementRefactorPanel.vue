<script setup lang="ts">
import { ref } from "vue";
import type { RefactorDiffItem, RefactorSessionResponse } from "@region-split/core/browser";
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
    <div v-if="session" class="refactor-view-toggle"><button @click="emit('set-view', 'original')">原始</button><button @click="emit('set-view', 'candidate')">候选</button></div>
    <div v-if="messages.length" class="refactor-messages"><p v-for="(message, index) in messages" :key="index" :class="`is-${message.role}`">{{ message.content }}</p></div>
    <p v-if="error" class="error">{{ error }}</p>
    <textarea v-model="instruction" data-test="ai-instruction" placeholder="描述需要补齐或重构的真实组件层级，可直接引用元素编号" :disabled="busy || !selectedReference" @keydown.ctrl.enter.prevent="submit" />
    <button data-test="ai-send" :disabled="busy || !selectedReference || !instruction.trim()" @click="submit">{{ session ? '继续调整' : '生成结构' }}</button>
    <div v-if="session" class="refactor-diffs"><strong>结构差异（{{ diffs.length }}）</strong><p v-for="item in diffs" :key="`${item.nodeId}-${item.kind}`">{{ item.kind }} · {{ item.after?.displayName ?? item.before?.displayName ?? item.nodeId }}</p></div>
    <footer v-if="session"><button :disabled="busy" data-test="ai-apply" @click="emit('apply')">应用变更</button><button :disabled="busy" @click="emit('reset')">重置候选</button><button :disabled="busy" @click="emit('discard')">放弃重构</button></footer>
  </section>
</template>

<style scoped>
.element-refactor-panel { min-height: 150px; max-height: 240px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; padding: 10px; overflow: hidden; border-top: 1px solid var(--border); background: var(--bg-node); }
header, .refactor-view-toggle, .refactor-messages, .error, .refactor-diffs, footer { grid-column: 1 / -1; }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--text-faint); font-size: 10px; }
header strong { color: var(--text); font-size: 11px; }
.refactor-messages, .refactor-diffs { max-height: 70px; overflow: auto; }
.refactor-messages p, .refactor-diffs p { margin: 3px 0; color: var(--text-dim); font-size: 10px; }
textarea { min-height: 54px; resize: vertical; }
footer { display: flex; gap: 6px; }
.error { margin: 0; color: var(--danger); font-size: 10px; }
</style>
