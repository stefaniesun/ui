<script setup lang="ts">
import { ref } from "vue";
import type { Store } from "../../state.js";
import ActionBar from "../../components/ActionBar.vue";
import RegionCanvas from "../../components/RegionCanvas.vue";
import RegionList from "../../components/RegionList.vue";

const props = defineProps<{
  store: Store;
  hoveredId: string | null;
  showCandidateLines: boolean;
  showPanels: boolean;
}>();
const emit = defineEmits<{ hover: [id: string | null] }>();
const splitting = ref(false);
</script>

<template>
  <div class="regions-node">
    <ActionBar v-model:splitting="splitting" :store="props.store" />
    <div class="regions-workspace">
      <RegionCanvas
        v-model:splitting="splitting"
        :store="props.store"
        :hovered-id="props.hoveredId"
        :show-candidate-lines="props.showCandidateLines"
        :show-panels="props.showPanels"
        @hover="emit('hover', $event)"
      />
      <RegionList :store="props.store" :hovered-id="props.hoveredId" @hover="emit('hover', $event)" />
    </div>
  </div>
</template>

<style scoped>
.regions-node { margin: -14px; overflow: hidden; border-radius: 0 0 9px 9px; }
.regions-workspace { display: grid; grid-template-columns: minmax(0, 1fr) 245px; min-height: 560px; }
.regions-workspace :deep(.list) { border-left: 1px solid var(--border); }
</style>
