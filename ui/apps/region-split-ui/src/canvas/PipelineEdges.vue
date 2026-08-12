<script setup lang="ts">
import { computed } from "vue";
import type { NodeId, NodePositions } from "./canvas-state.js";

interface NodeSize { width: number; height: number }
interface Edge { from: NodeId; to: NodeId }

const props = defineProps<{
  positions: NodePositions;
  sizes: Record<NodeId, NodeSize>;
  active: Record<string, boolean>;
}>();

const edges: Edge[] = [
  { from: "source", to: "surface" },
  { from: "surface", to: "analyze" },
  { from: "analyze", to: "regions" },
];

const paths = computed(() => edges.map(edge => {
  const from = props.positions[edge.from];
  const to = props.positions[edge.to];
  const fromSize = props.sizes[edge.from];
  const start = { x: from.x + fromSize.width, y: from.y + 21 };
  const end = { x: to.x, y: to.y + 21 };
  const curve = Math.max(72, Math.abs(end.x - start.x) * .42);
  return {
    ...edge,
    active: props.active[`${edge.from}-${edge.to}`] ?? false,
    d: `M ${start.x} ${start.y} C ${start.x + curve} ${start.y}, ${end.x - curve} ${end.y}, ${end.x} ${end.y}`,
  };
}));
</script>

<template>
  <svg class="edges" aria-hidden="true">
    <path
      v-for="edge in paths"
      :key="`${edge.from}-${edge.to}`"
      :d="edge.d"
      :class="{ active: edge.active }"
    />
  </svg>
</template>

<style scoped>
.edges { position: absolute; inset: -4000px; width: 10000px; height: 8000px; overflow: visible; pointer-events: none; }
path { fill: none; stroke: var(--edge-idle); stroke-width: 3; vector-effect: non-scaling-stroke; }
path.active { stroke: var(--edge-active); filter: drop-shadow(0 0 4px #4c8dff88); }
</style>
