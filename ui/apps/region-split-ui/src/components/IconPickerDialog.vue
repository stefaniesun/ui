<script setup lang="ts">
import type { PageElementPatch, PageOutlineElement } from "@region-split/core/browser";
import { computed, onMounted, ref } from "vue";
import { assetUrl, svgDataUrl, type IconCandidate, type StoreApi } from "../api.js";

const props = defineProps<{ projectId: string; element: PageOutlineElement; api: Pick<StoreApi, "searchIcons"> }>();
const emit = defineEmits<{ confirm: [patch: PageElementPatch]; cancel: [] }>();
const query = ref("");
const candidates = ref<IconCandidate[]>([]);
const selectedId = ref<string | null>(null);
const searching = ref(false);
const error = ref("");
const sourceRef = computed(() => {
  const decision = props.element.iconDecision;
  if (decision?.kind === "library" && decision.sourceAssetRef) return decision.sourceAssetRef;
  if (decision?.kind === "crop" && decision.assetRef) return decision.assetRef;
  return props.element.asset?.ref ?? null;
});
const sourceUrl = computed(() => sourceRef.value ? assetUrl(props.projectId, sourceRef.value) : null);
async function search() {
  const value = query.value.trim();
  if (!value) { candidates.value = []; return; }
  searching.value = true; error.value = "";
  try { candidates.value = (await props.api.searchIcons(value, 30)).candidates; selectedId.value = null; }
  catch (cause) { error.value = cause instanceof Error ? cause.message : "搜索图标失败"; candidates.value = []; }
  finally { searching.value = false; }
}
function confirmLibrary() {
  if (!selectedId.value || !query.value.trim()) return;
  emit("confirm", { iconDecision: { kind: "library", iconId: selectedId.value, query: query.value.trim(), candidates: candidates.value.map(item => item.id), keywords: props.element.iconDecision?.keywords ?? [], by: "human" } });
}
function confirmCrop() {
  if (!sourceRef.value) return;
  emit("confirm", { iconDecision: { kind: "crop", assetRef: sourceRef.value, reason: "人工选择使用原图切片", by: "human" } });
}
onMounted(() => {
  query.value = props.element.iconDecision?.keywords?.find(keyword => /[A-Za-z]/.test(keyword)) ?? "";
  if (query.value) void search();
});
</script>

<template>
  <div class="icon-picker-backdrop" data-test="icon-picker" role="presentation" @click.self="emit('cancel')">
    <section class="icon-picker" role="dialog" aria-modal="true" aria-label="选择图标">
      <aside class="icon-source"><strong>原图切片</strong><img v-if="sourceUrl" :src="sourceUrl" data-test="picker-source" alt="图标原图切片" /><p v-else>暂无原图切片</p></aside>
      <div class="icon-search"><button type="button" class="dialog-close" aria-label="关闭" @click="emit('cancel')">×</button>
        <form @submit.prevent="search"><input v-model="query" data-test="icon-query" placeholder="输入英文关键词" /><button type="submit">搜索</button></form>
        <p v-if="!query" data-test="keyword-hint">模型没给英文关键词，请手动搜索</p><p v-if="error" class="error">{{ error }}</p><p v-if="searching">搜索中…</p>
        <div class="icon-grid"><button v-for="candidate in candidates" :key="candidate.id" type="button" :class="{ selected: selectedId === candidate.id }" @click="selectedId = candidate.id"><img :src="svgDataUrl(candidate.svg)" :alt="candidate.name" /><span>{{ candidate.name }}</span></button></div>
        <p v-if="query && !searching && !candidates.length && !error">未找到匹配图标</p>
      </div>
      <footer><button type="button" :disabled="!sourceRef" @click="confirmCrop">用原图切片</button><button type="button" @click="emit('cancel')">取消</button><button type="button" data-test="confirm-icon" :disabled="!selectedId" @click="confirmLibrary">确定</button></footer>
    </section>
  </div>
</template>

<style scoped>
.icon-picker-backdrop { position: fixed; z-index: 50; inset: 0; display: grid; place-items: center; padding: 24px; background: #000a; }
.icon-picker { width: min(920px, 94vw); max-height: 86vh; display: grid; grid-template-columns: 230px 1fr; grid-template-rows: minmax(0, 1fr) auto; overflow: hidden; border: 1px solid #3b475a; border-radius: 10px; color: #e7edf6; background: #151a23; box-shadow: 0 24px 80px #000c; }
.icon-source { display: grid; align-content: start; gap: 12px; padding: 18px; border-right: 1px solid #2a3342; }.icon-source img { width: 100%; max-height: 280px; object-fit: contain; background: #0b1017; }
.icon-search { position: relative; min-height: 420px; overflow-y: auto; padding: 18px; }.icon-search form { display: flex; gap: 8px; }.icon-search input { flex: 1; }.dialog-close { position: absolute; top: 6px; right: 8px; }
.icon-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 10px; margin-top: 16px; }.icon-grid button { display: grid; place-items: center; gap: 5px; padding: 10px; color: inherit; background: #10151d; border: 1px solid #354155; }.icon-grid button.selected { border-color: #30d5ff; background: #183b4a; }.icon-grid img { width: 60px; height: 60px; object-fit: contain; }
footer { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 8px; padding: 12px 18px; border-top: 1px solid #2a3342; }.error { color: #ff9a9a; }
</style>
