<script setup lang="ts">
import type { Store } from "../state.js";

const props = defineProps<{ store: Store }>();
</script>

<template>
  <!--
    分析期间盖住内容区。store 里的各个动作本来就有 busy 守卫，不会写坏数据，
    但没有遮罩时画布和列表照样能点，用户会以为编辑生效了、实际全被丢弃。
    遮罩只盖内容区不盖工具栏：工具栏的按钮已按 busy 逐个禁用，盖住反而看不到状态。
  -->
  <div v-if="props.store.busy.value" data-test="busy-overlay" class="overlay">
    <div class="panel">
      <span class="spinner" />
      <span class="label">{{ props.store.busyLabel.value }}</span>
      <span class="hint">分析期间无法编辑，完成后自动解锁</span>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  /* 与 main / aside 占同一个网格区域，自动覆盖它们，不必写死头部高度 */
  grid-row: 2;
  grid-column: 1 / -1;
  z-index: 5;
  background: #f0f1f3cc;
  backdrop-filter: blur(1px);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: progress;
}
.panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px 28px;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 2px 16px #00000022;
}
.spinner {
  width: 22px;
  height: 22px;
  border: 2px solid #d7dae0;
  border-top-color: #2f6fed;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.label { font-size: 13px; color: #333; }
.hint { font-size: 12px; color: #888; }

@keyframes spin { to { transform: rotate(360deg); } }

/* 尊重系统的减少动效设置 */
@media (prefers-reduced-motion: reduce) {
  .spinner { animation: none; border-top-color: #d7dae0; }
}
</style>
