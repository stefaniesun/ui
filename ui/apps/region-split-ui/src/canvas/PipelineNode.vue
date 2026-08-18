<script setup lang="ts">
import type { Point } from "./canvas-state.js";

const props = withDefaults(defineProps<{
  nodeId: string;
  title: string;
  position: Point;
  width?: number;
  minHeight?: number;
  status?: "idle" | "active" | "done" | "warn";
  input?: boolean;
  output?: boolean;
  closable?: boolean;
  highlighted?: boolean;
}>(), {
  width: 440,
  minHeight: 320,
  status: "idle",
  input: true,
  output: true,
  closable: false,
  highlighted: false,
});

const emit = defineEmits<{
  dragStart: [event: PointerEvent, nodeId: string];
  close: [nodeId: string];
}>();
</script>

<template>
  <article
    class="pipeline-node"
    :class="[`status-${props.status}`, { 'is-highlighted': props.highlighted }]"
    :style="{ left: `${props.position.x}px`, top: `${props.position.y}px`, width: `${props.width}px`, minHeight: `${props.minHeight}px` }"
    :data-node-id="props.nodeId"
    @pointerdown.stop
  >
    <span v-if="props.input" class="port input-port" aria-hidden="true" />
    <header class="node-header" @pointerdown.stop="emit('dragStart', $event, props.nodeId)">
      <span class="status-dot" />
      <strong>{{ props.title }}</strong>
      <span class="header-meta"><slot name="status" /></span>
      <button
        v-if="props.closable"
        data-test="close-node"
        class="close-node"
        type="button"
        aria-label="关闭节点"
        @pointerdown.stop
        @click.stop="emit('close', props.nodeId)"
      >×</button>
    </header>
    <div class="node-body"><slot /></div>
    <span v-if="props.output" class="port output-port" aria-hidden="true" />
  </article>
</template>

<style scoped>
.pipeline-node { position: absolute; overflow: visible; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-node); color: var(--text); box-shadow: 0 14px 36px #0008; }
.pipeline-node.status-active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent-soft), 0 14px 36px #0009; }
.pipeline-node.is-highlighted { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft), 0 14px 36px #0009; }
.node-header { height: 42px; display: flex; align-items: center; gap: 9px; padding: 0 13px; border-bottom: 1px solid var(--border); border-radius: 9px 9px 0 0; background: var(--bg-node-header); cursor: grab; user-select: none; }
.node-header:active { cursor: grabbing; }
.node-header strong { font-size: 13px; letter-spacing: .01em; }
.header-meta { margin-left: auto; color: var(--text-dim); font-size: 11px; }
.close-node { width: 24px; height: 24px; padding: 0; border: 0; border-radius: 5px; color: var(--text-dim); background: transparent; font-size: 18px; line-height: 24px; cursor: pointer; }
.close-node:hover { color: var(--text); background: var(--bg-inset); }
.status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-faint); }
.status-done .status-dot { background: var(--ok); box-shadow: 0 0 8px #3ecf8e88; }
.status-active .status-dot { background: var(--accent); box-shadow: 0 0 8px #4c8dffaa; }
.status-warn .status-dot { background: var(--warn); }
.node-body { min-height: inherit; padding: 14px; overflow: hidden; }
.port { position: absolute; top: 21px; z-index: 3; width: 12px; height: 12px; border: 2px solid var(--border-strong); border-radius: 50%; background: var(--bg-canvas); transform: translateY(-50%); }
.input-port { left: -7px; }
.output-port { right: -7px; }
.status-active .port, .status-done .port { border-color: var(--accent); }
</style>
