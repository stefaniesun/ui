<script setup lang="ts">
import { computed, nextTick, ref, watch, type ComponentPublicInstance } from "vue";
import type { RegionExpandDirection, Store } from "../state.js";

const props = defineProps<{ store: Store; hoveredId?: string | null }>();
const emit = defineEmits<{ hover: [id: string | null] }>();

const editingId = ref<string | null>(null);
const draft = ref("");
const inputEl = ref<HTMLInputElement>();
// 不能用字符串 ref="inputEl"：这个 <input> 嵌在 v-for 的 <li> 里，字符串 ref
// 在 v-for 作用域内会被 Vue 收集成数组，inputEl.value 就成了数组而不是元素，
// .focus() 会直接抛错。函数 ref 没有这个数组聚合行为，按需手动赋值即可。
function setInputRef(el: Element | ComponentPublicInstance | null) {
  inputEl.value = (el instanceof HTMLInputElement ? el : undefined);
}

// 内部（列表自身鼠标悬停）状态优先；未悬停时回退到外部（画布）传入的 hoveredId，
// 这样列表可以同时响应"悬停自己"和"悬停画布对应色块"两种来源。
const internalHoverId = ref<string | null>(null);
const activeHoverId = computed(() => internalHoverId.value ?? props.hoveredId ?? null);

const rowRefs = new Map<string, HTMLElement>();
function setRowRef(id: string, el: Element | ComponentPublicInstance | null) {
  if (el instanceof HTMLElement) rowRefs.set(id, el);
  else rowRefs.delete(id);
}

const singleSelectedId = computed(() =>
  props.store.selectedIds.value.length === 1 ? props.store.selectedIds.value[0]! : null);

// 选中项变为单选时，把对应行滚动进可视区域。用 flush: "post" 而不是在回调里
// 再套一层 nextTick——嵌套 nextTick 注册的 .then 排在测试里 await 的
// wrapper.vm.$nextTick() 之后，断言会先于滚动调用执行；post watcher 本身就在
// DOM patch 之后、flush 完成前同步运行，时序才是对的。
watch(singleSelectedId, id => {
  if (!id) return;
  const el = rowRefs.get(id);
  // jsdom（测试环境）默认不实现 scrollIntoView；不加这层保护的话，某个未打桩的
  // 测试触发一次选中就会在 post-flush watcher 里抛出未捕获异常，进而污染 Vue
  // 全局调度器，让同一测试文件里后续所有用例的挂载都跟着崩掉。
  if (typeof el?.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
}, { flush: "post" });

watch(() => props.store.renamingId.value, id => { if (id) beginEdit(id); });

function onHoverEnter(id: string) {
  internalHoverId.value = id;
  emit("hover", id);
}

function onHoverLeave() {
  internalHoverId.value = null;
  emit("hover", null);
}

function beginEdit(id: string) {
  const region = props.store.regions.value.find(item => item.id === id);
  if (!region) return;
  editingId.value = id;
  draft.value = region.displayName;
  void nextTick(() => inputEl.value?.focus());
}

function commit() {
  if (editingId.value && draft.value.trim()) {
    props.store.rename(editingId.value, draft.value.trim());
  }
  close();
}

function close() {
  editingId.value = null;
  props.store.stopRename();
}

// 拆分模式下画布色块的 pointer-events 被禁掉了，但列表行本来还能点；
// ctrl/shift 点第二行会把选中变成多选，selectedIndex 退化成 -1，操作条卡在
// "拆分「undefined」"上、切分线恒红，只能按 Esc 脱困。拆分模式下列表本身也
// 不可选中，逻辑与画布保持一致。
function onRowClick(id: string, event: MouseEvent) {
  if (props.store.mode.value === "split") return;
  props.store.select(id, event.ctrlKey || event.metaKey || event.shiftKey);
}

function expand(id: string, direction: RegionExpandDirection) {
  props.store.expandRegion(id, direction);
}
</script>

<template>
  <div
    v-if="props.store.needsAnalysis.value"
    data-test="needs-analysis"
    class="notice"
  >
    这是按视觉分割线生成的<strong>初始划分</strong>，还没经过 AI 判断。<br />
    点工具栏的「重新分析」获得语义命名的模块。
  </div>
  <ul class="list">
    <li
      v-for="(region, index) in props.store.regions.value"
      :key="region.id"
      :ref="el => setRowRef(region.id, el)"
      data-test="row"
      :data-region-id="region.id"
      class="row"
      :class="{
        selected: props.store.selectedIds.value.includes(region.id),
        hovered: activeHoverId === region.id,
        disabled: props.store.mode.value === 'split',
      }"
      @click="onRowClick(region.id, $event)"
      @mouseenter="onHoverEnter(region.id)"
      @mouseleave="onHoverLeave"
    >
      <span class="index">{{ index + 1 }}</span>
      <input
        v-if="editingId === region.id"
        :ref="setInputRef"
        v-model="draft"
        data-test="rename-input"
        @click.stop
        @keydown.enter="commit"
        @keydown.esc="close"
        @blur="commit"
      />
      <span v-else data-test="name" class="name" @dblclick.stop="beginEdit(region.id)">
        {{ props.store.pendingRenameIds.value.includes(region.id) ? "命名中…" : region.displayName }}
      </span>
      <span class="type">{{ region.type }}</span>
      <span
        v-if="region.scrollX || region.scrollY"
        data-test="scroll"
        class="scroll"
        :title="[region.scrollX ? '可横向滑动' : '', region.scrollY ? '可纵向滑动' : ''].filter(Boolean).join(' · ')"
      >{{ region.scrollX ? "↔" : "" }}{{ region.scrollY ? "↕" : "" }}</span>
      <span class="boundary-controls" @dblclick.stop>
        <button
          type="button"
          data-test="expand-up"
          aria-label="向上扩展区域"
          title="向上扩展区域"
          :disabled="!props.store.canExpandRegion(region.id, 'up')"
          @click.stop="expand(region.id, 'up')"
        >▲</button>
        <button
          type="button"
          data-test="expand-down"
          aria-label="向下扩展区域"
          title="向下扩展区域"
          :disabled="!props.store.canExpandRegion(region.id, 'down')"
          @click.stop="expand(region.id, 'down')"
        >▼</button>
      </span>
    </li>
  </ul>
</template>

<style scoped>
.notice {
  margin: 6px; padding: 8px 10px; border-radius: 6px;
  background: #fff8e1; border: 1px solid #f0d492; color: #7a5c12;
  font-size: 12px; line-height: 1.6;
}
.list { list-style: none; margin: 0; padding: 4px; }
.row { display: flex; align-items: center; gap: 6px; padding: 6px; border-radius: 6px; cursor: pointer; }
.row.hovered { background: #f0f4ff; }
.row.selected { background: #e8f0fe; }
.row.disabled { cursor: default; opacity: 0.6; }
.index { width: 18px; color: #999; font-size: 12px; }
.name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.type { font-size: 11px; color: #888; }
.boundary-controls { display: inline-flex; gap: 2px; margin-left: 2px; }
.boundary-controls button {
  width: 22px; height: 22px; padding: 0; border: 1px solid #c9d3e6;
  border-radius: 4px; background: #fff; color: #2f6fed; cursor: pointer;
  font-size: 10px; line-height: 1;
}
.boundary-controls button:hover:not(:disabled) { background: #edf3ff; }
.boundary-controls button:disabled { color: #b8bec9; background: #f5f6f8; cursor: not-allowed; }
.scroll { font-size: 12px; color: #2f6fed; cursor: help; }
input { flex: 1; min-width: 0; }
</style>
