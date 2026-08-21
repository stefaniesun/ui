<script setup lang="ts">
import { computed } from "vue";
import type { Store } from "../state.js";
import AiProcessingIndicator from "./AiProcessingIndicator.vue";

const props = defineProps<{ label?: string; store?: Store }>();
const displayLabel = computed(() => props.label ?? props.store?.busyLabel.value ?? "处理中…");
const isAiOperation = computed(() => /^AI(?:\s|正在|分析|生成|解析|校准)/i.test(displayLabel.value));
</script>

<template>
  <div data-test="busy-overlay" class="overlay" role="status">
    <AiProcessingIndicator v-if="isAiOperation" :label="displayLabel" />
    <div v-else class="panel">
      <span class="spinner" />
      <strong>{{ displayLabel }}</strong>
      <span>处理中，画布暂时锁定</span>
    </div>
  </div>
</template>

<style scoped>
.overlay { position: absolute; z-index: 100; inset: 0; display: grid; place-items: center; background: #101217bb; backdrop-filter: blur(3px); cursor: progress; }
.panel { min-width: 230px; display: flex; flex-direction: column; align-items: center; gap: 9px; padding: 24px 28px; border: 1px solid var(--border-strong); border-radius: 10px; color: var(--text); background: var(--bg-node); box-shadow: 0 18px 48px #000a; }
.panel span:last-child { color: var(--text-faint); font-size: 10px; }.panel strong { font-size: 12px; }
.spinner { width: 26px; height: 26px; border: 2px solid var(--border-strong); border-top-color: var(--accent); border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
</style>
