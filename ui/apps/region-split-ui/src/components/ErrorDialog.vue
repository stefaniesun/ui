<script setup lang="ts">
const props = withDefaults(defineProps<{
  title: string;
  message: string;
  configPath?: string;
  retryable?: boolean;
}>(), { retryable: false });
const emit = defineEmits<{ close: []; retry: [] }>();
</script>

<template>
  <div class="dialog-backdrop" @pointerdown.stop @click.stop @wheel.stop>
    <section role="dialog" aria-modal="true" aria-labelledby="error-dialog-title" class="dialog-panel">
      <header>
        <span class="error-mark">!</span>
        <h2 id="error-dialog-title">{{ props.title }}</h2>
      </header>
      <p class="message">{{ props.message }}</p>
      <div v-if="props.configPath" class="config-path">
        <span>模型配置路径</span>
        <code>{{ props.configPath }}</code>
      </div>
      <footer>
        <button data-test="close-error" class="secondary" @click="emit('close')">关闭</button>
        <button v-if="props.retryable" data-test="retry-error" class="primary" @click="emit('retry')">重新分析</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.dialog-backdrop { position: absolute; inset: 0; z-index: 100; display: grid; place-items: center; padding: 24px; background: #05070bb8; backdrop-filter: blur(3px); }
.dialog-panel { width: min(440px, 100%); padding: 18px; border: 1px solid #71434a; border-radius: 10px; color: var(--text); background: #1b1e25; box-shadow: 0 24px 80px #000b; }
header { display: flex; align-items: center; gap: 10px; }
.error-mark { width: 25px; height: 25px; display: grid; place-items: center; border-radius: 50%; color: #fff; background: var(--danger); font-weight: 800; }
h2 { margin: 0; font-size: 15px; }
.message { margin: 14px 0; color: var(--text-dim); line-height: 1.6; }
.config-path { display: grid; gap: 6px; padding: 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-inset); }
.config-path span { color: var(--text-faint); font-size: 10px; }
code { overflow-wrap: anywhere; color: var(--text-dim); font-size: 11px; }
footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
button { min-width: 88px; }
.primary { border-color: var(--accent); color: white; background: var(--accent); }
.secondary { color: var(--text-dim); background: var(--bg-node-header); }
</style>
