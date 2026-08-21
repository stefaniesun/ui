<script setup lang="ts">
import type { Point } from "./canvas-state.js";

const props = withDefaults(defineProps<{
  nodeId: string;
  title: string;
  position: Point;
  width?: number;
  height?: number;
  minHeight?: number;
  resizable?: boolean;
  status?: "idle" | "active" | "done" | "warn";
  input?: boolean;
  output?: boolean;
  closable?: boolean;
  highlighted?: boolean;
  accentColor?: string;
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
  resizeStart: [event: PointerEvent, nodeId: string, direction: "right" | "bottom" | "corner"];
  close: [nodeId: string];
}>();
</script>

<template>
  <article
    class="pipeline-node"
    :class="[`status-${props.status}`, { 'is-highlighted': props.highlighted }]"
    :style="{
      left: `${props.position.x}px`,
      top: `${props.position.y}px`,
      width: `${props.width}px`,
      height: props.height ? `${props.height}px` : undefined,
      minHeight: `${props.minHeight}px`,
      '--node-accent': props.accentColor ?? 'var(--accent)',
    }"
    :data-node-id="props.nodeId"
  >
    <span
      v-if="props.input"
      class="port input-port"
      data-port="input"
      :style="{ borderColor: props.accentColor ?? 'var(--border-strong)' }"
      aria-hidden="true"
    />
    <header class="node-header" @pointerdown.stop="emit('dragStart', $event, props.nodeId)">
      <span
        class="status-dot"
        :style="props.status === 'active' ? { backgroundColor: props.accentColor ?? 'var(--accent)' } : undefined"
      />
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
    <template v-if="props.resizable">
      <span data-test="node-resize-right" class="node-resizer resize-right" @pointerdown.stop.prevent="emit('resizeStart', $event, props.nodeId, 'right')" />
      <span data-test="node-resize-bottom" class="node-resizer resize-bottom" @pointerdown.stop.prevent="emit('resizeStart', $event, props.nodeId, 'bottom')" />
      <span data-test="node-resize-corner" class="node-resizer resize-corner" @pointerdown.stop.prevent="emit('resizeStart', $event, props.nodeId, 'corner')" />
    </template>
    <span v-if="props.output" class="port output-port" data-port="output" aria-hidden="true" />
  </article>
</template>

<style scoped>
.pipeline-node { position: absolute; overflow: visible; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-node); color: var(--text); box-shadow: 0 14px 36px #0008; }
.pipeline-node[style*="--node-accent: #"] { border-top: 3px solid var(--node-accent); }
.pipeline-node.status-active { border-color: var(--node-accent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--node-accent) 28%, transparent), 0 14px 36px #0009; }
.pipeline-node.is-highlighted { border-color: var(--node-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--node-accent) 28%, transparent), 0 14px 36px #0009; }
.node-header { height: 42px; display: flex; align-items: center; gap: 9px; padding: 0 13px; border-bottom: 1px solid var(--border); border-radius: 9px 9px 0 0; background: var(--bg-node-header); cursor: grab; user-select: none; }
.node-header:active { cursor: grabbing; }
.node-header strong { font-size: 13px; letter-spacing: .01em; }
.header-meta { margin-left: auto; color: var(--text-dim); font-size: 11px; }
.close-node { width: 24px; height: 24px; padding: 0; border: 0; border-radius: 5px; color: var(--text-dim); background: transparent; font-size: 18px; line-height: 24px; cursor: pointer; }
.close-node:hover { color: var(--text); background: var(--bg-inset); }
.status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-faint); }
.status-done .status-dot { background: var(--ok); box-shadow: 0 0 8px #3ecf8e88; }
.status-active .status-dot { background: var(--node-accent); box-shadow: 0 0 8px color-mix(in srgb, var(--node-accent) 65%, transparent); }
.status-warn .status-dot { background: var(--warn); }
.node-body { min-height: inherit; height: calc(100% - 42px); padding: 14px; overflow: hidden; }
.node-resizer { position: absolute; z-index: 30; touch-action: none; }
.resize-right { top: 42px; right: -5px; bottom: 10px; width: 10px; cursor: ew-resize; }
.resize-bottom { right: 10px; bottom: -5px; left: 0; height: 10px; cursor: ns-resize; }
.resize-corner { right: -6px; bottom: -6px; width: 16px; height: 16px; border-right: 2px solid var(--node-accent); border-bottom: 2px solid var(--node-accent); cursor: nwse-resize; }
.port { position: absolute; top: 21px; z-index: 3; width: 12px; height: 12px; border: 2px solid var(--border-strong); border-radius: 50%; background: var(--bg-canvas); transform: translateY(-50%); }
.input-port { left: -7px; }
.output-port { right: -7px; }
.status-active .port, .status-done .port { border-color: var(--node-accent); }
</style>
