<script setup lang="ts">
withDefaults(defineProps<{
  label?: string;
  mode?: "overlay" | "inline";
}>(), {
  label: "AI 正在解析",
  mode: "overlay",
});
</script>

<template>
  <div
    data-test="ai-processing-indicator"
    class="ai-processing"
    :class="`is-${mode}`"
    role="status"
    aria-live="polite"
    :aria-label="label"
  >
    <span data-test="ai-processing-scan" class="scan-line" aria-hidden="true" />
    <span data-test="ai-processing-focus" class="focus-frame" aria-hidden="true">
      <i class="corner corner-tl" /><i class="corner corner-tr" />
      <i class="corner corner-bl" /><i class="corner corner-br" />
    </span>
    <span class="status-label">
      <strong>{{ label }}</strong>
      <span class="status-dots" aria-hidden="true">
        <i v-for="index in 3" :key="index" data-test="ai-processing-dot" />
      </span>
    </span>
  </div>
</template>

<style scoped>
.ai-processing { --ai-glow: #43a5ff; position: relative; isolation: isolate; overflow: hidden; color: #dceeff; background: #07111dcc; }
.is-overlay { position: absolute; z-index: 12; inset: 0; display: grid; place-items: center; backdrop-filter: blur(1px); }
.is-inline { min-height: 92px; display: grid; place-items: center; border: 1px solid color-mix(in srgb, var(--ai-glow) 28%, transparent); border-radius: 7px; background: #07111d99; }
.scan-line { position: absolute; z-index: -1; top: 0; right: 0; left: 0; height: 2px; background: linear-gradient(90deg, transparent, var(--ai-glow) 18%, #b8e3ff 50%, var(--ai-glow) 82%, transparent); box-shadow: 0 0 14px 3px #2497ff8c; animation: ai-scan 2.1s ease-in-out infinite alternate; }
.focus-frame { position: absolute; z-index: -1; width: min(42%, 150px); aspect-ratio: 1.8; animation: ai-focus 1.6s ease-in-out infinite; }
.corner { position: absolute; width: 18px; height: 18px; border-color: var(--ai-glow); filter: drop-shadow(0 0 5px #2497ff); }
.corner-tl { top: 0; left: 0; border-top: 2px solid; border-left: 2px solid; }
.corner-tr { top: 0; right: 0; border-top: 2px solid; border-right: 2px solid; }
.corner-bl { bottom: 0; left: 0; border-bottom: 2px solid; border-left: 2px solid; }
.corner-br { right: 0; bottom: 0; border-right: 2px solid; border-bottom: 2px solid; }
.status-label { display: flex; align-items: baseline; gap: 7px; padding: 7px 12px; border: 1px solid #4ba9ff66; border-radius: 999px; background: #07111dd9; box-shadow: 0 6px 24px #0008, inset 0 0 18px #2698ff14; }
.status-label strong { font-size: 11px; font-weight: 600; letter-spacing: .04em; }
.status-dots { display: inline-flex; gap: 3px; }
.status-dots i { width: 4px; height: 4px; border-radius: 50%; background: var(--ai-glow); animation: ai-dot 1s ease-in-out infinite; }
.status-dots i:nth-child(2) { animation-delay: .16s; }
.status-dots i:nth-child(3) { animation-delay: .32s; }
@keyframes ai-scan { from { top: 0; opacity: .35; } to { top: calc(100% - 2px); opacity: 1; } }
@keyframes ai-focus { 0%, 100% { opacity: .5; transform: scale(.96); } 50% { opacity: 1; transform: scale(1.04); } }
@keyframes ai-dot { 0%, 60%, 100% { opacity: .25; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }
@media (prefers-reduced-motion: reduce) {
  .scan-line, .focus-frame, .status-dots i { animation: none; }
  .scan-line { top: 50%; opacity: .7; }
}
</style>
