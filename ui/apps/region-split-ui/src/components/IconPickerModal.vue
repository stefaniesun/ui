<script setup lang="ts">
import { ref, watch } from "vue";
import type { IconCandidate } from "../api.js";

const props = withDefaults(defineProps<{
  open: boolean;
  cropSrc?: string;
  currentIconId?: string;
  initialQuery?: string;
  initialCandidates?: IconCandidate[];
  searchIcons: (query: string, limit: number) => Promise<{ candidates: IconCandidate[] }>;
}>(), { initialQuery: "", initialCandidates: () => [] });
const emit = defineEmits<{
  close: [];
  confirm: [iconId: string, candidates: string[], query: string];
  useCrop: [];
}>();

const query = ref("");
const candidates = ref<IconCandidate[]>([]);
const selectedId = ref("");
const busy = ref(false);
const error = ref("");

watch(() => props.open, open => {
  if (!open) return;
  query.value = props.initialQuery;
  candidates.value = [...props.initialCandidates];
  selectedId.value = props.currentIconId ?? "";
  error.value = "";
  if (query.value) void search();
}, { immediate: true });

async function search() {
  const value = query.value.trim();
  if (!value) return;
  busy.value = true;
  error.value = "";
  try {
    candidates.value = (await props.searchIcons(value, 24)).candidates;
    selectedId.value = candidates.value.some(candidate => candidate.id === props.currentIconId)
      ? props.currentIconId ?? "" : "";
  } catch (reason) {
    error.value = (reason as Error).message;
  } finally {
    busy.value = false;
  }
}

function confirm() {
  if (!selectedId.value) return;
  emit("confirm", selectedId.value, candidates.value.map(candidate => candidate.id), query.value.trim());
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" data-test="icon-picker-modal" class="mask" @click.self="emit('close')">
      <section class="dialog" role="dialog" aria-modal="true" aria-label="挑选图标">
        <header><strong>挑选图标</strong><button type="button" aria-label="关闭" @click="emit('close')">×</button></header>
        <div class="comparison">
          <aside class="crop-column">
            <strong>原图切片</strong>
            <img v-if="cropSrc" data-test="picker-crop" :src="cropSrc" alt="原图切片" />
            <span v-else class="crop-empty">暂无裁片预览</span>
          </aside>
          <div class="candidate-column">
            <div class="search-row">
              <input v-model="query" data-test="icon-picker-query" placeholder="输入英文关键词，如 user、home" @keydown.enter.prevent="search" />
              <button data-test="icon-picker-search" type="button" :disabled="busy || !query.trim()" @click="search">{{ busy ? "搜索中" : "搜索" }}</button>
            </div>
            <p v-if="!initialQuery" data-test="picker-hint" class="hint">模型没给可用英文关键词，请手动搜索。</p>
            <p v-if="error" class="error">{{ error }}</p>
            <p v-else-if="!candidates.length" class="empty">没有匹配的图标，请换一个英文关键词，或使用原图切片。</p>
            <div v-else data-test="icon-picker-grid" class="grid">
              <button
                v-for="candidate in candidates" :key="candidate.id" type="button"
                :data-test="`icon-candidate-${candidate.id}`" :class="{ selected: selectedId === candidate.id }"
                :title="candidate.id" @click="selectedId = candidate.id"
              >
                <span v-html="candidate.svg" /><small>{{ candidate.name }}</small>
              </button>
            </div>
          </div>
        </div>
        <footer>
          <button data-test="icon-picker-use-crop" type="button" @click="emit('useCrop')">用原图切片</button>
          <span class="spacer" />
          <button type="button" @click="emit('close')">取消</button>
          <button data-test="icon-picker-confirm" type="button" :disabled="!selectedId" @click="confirm">确认替换</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.mask { position: fixed; z-index: 1000; inset: 0; display: grid; place-items: center; padding: 24px; background: #05080dc7; backdrop-filter: blur(4px); }
.dialog { width: min(720px, 92vw); max-height: 82vh; display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--border); border-radius: 10px; color: var(--text); background: var(--bg-node); box-shadow: 0 20px 70px #000b; }
header, footer, .search-row { display: flex; align-items: center; gap: 8px; padding: 12px; }
header { justify-content: space-between; border-bottom: 1px solid var(--border); }
footer { border-top: 1px solid var(--border); }
.comparison { min-height: 360px; display: grid; grid-template-columns: 180px minmax(0, 1fr); overflow: hidden; }
.crop-column { display: flex; flex-direction: column; gap: 10px; padding: 14px; border-right: 1px solid var(--border); background: var(--bg-inset); }
.crop-column img { width: 100%; aspect-ratio: 1; object-fit: contain; border: 1px solid var(--border); border-radius: 7px; background: #fff; image-rendering: auto; }
.crop-empty { display: grid; flex: 1; place-items: center; color: var(--text-dim); text-align: center; }
.candidate-column { min-width: 0; display: flex; flex-direction: column; overflow: hidden; }
.search-row input { min-width: 0; flex: 1; }
.hint { margin: 0 12px; color: var(--warning, #d5a72d); font-size: 11px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 8px; padding: 12px; overflow: auto; }
.grid button { min-width: 0; padding: 10px 6px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg-inset); }
.grid button.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.grid :deep(svg) { width: 30px; height: 30px; fill: currentColor; }
.grid small { display: block; margin-top: 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty, .error { margin: 0; padding: 28px 14px; text-align: center; }
.error { color: var(--danger); }
.spacer { flex: 1; }
</style>
