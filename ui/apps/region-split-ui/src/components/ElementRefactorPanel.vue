<script setup lang="ts">
import { ref } from "vue";
import type { RefactorDiffItem, RefactorSessionResponse } from "@region-split/core/browser";
const props = defineProps<{ session: RefactorSessionResponse | null; messages: Array<{ role: string; content: string }>; diffs: RefactorDiffItem[]; busy: boolean; error: string }>();
const emit = defineEmits<{ send: [instruction: string]; apply: []; reset: []; discard: []; "set-view": [view: "original" | "candidate"] }>();
const instruction = ref("");
function submit() { const value = instruction.value.trim(); if (!value || props.busy) return; emit("send", value); instruction.value = ""; }
</script>
<template>
  <section class="element-refactor-panel" data-test="ai-refactor-panel">
    <header><strong>AI 结构校准</strong><span v-if="session">候选版本 {{ session.candidateVersion }}</span></header>
    <div class="refactor-view-toggle"><button @click="emit('set-view', 'original')">原始</button><button @click="emit('set-view', 'candidate')">候选</button></div>
    <div class="refactor-messages"><p v-for="(message, index) in messages" :key="index" :class="`is-${message.role}`">{{ message.content }}</p></div>
    <p v-if="error" class="error">{{ error }}</p>
    <textarea v-model="instruction" data-test="ai-instruction" placeholder="描述需要补齐或重构的真实组件层级" :disabled="busy" @keydown.ctrl.enter.prevent="submit" />
    <button data-test="ai-send" :disabled="busy || !instruction.trim()" @click="submit">{{ session ? '继续调整' : '生成结构' }}</button>
    <div v-if="session" class="refactor-diffs"><strong>结构差异（{{ diffs.length }}）</strong><p v-for="item in diffs" :key="`${item.nodeId}-${item.kind}`">{{ item.kind }} · {{ item.after?.displayName ?? item.before?.displayName ?? item.nodeId }}</p></div>
    <footer><button :disabled="busy || !session" data-test="ai-apply" @click="emit('apply')">应用变更</button><button :disabled="busy" @click="emit('reset')">重置候选</button><button :disabled="busy" @click="emit('discard')">放弃重构</button></footer>
  </section>
</template>
