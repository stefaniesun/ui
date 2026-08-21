<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { elementKinds, type ElementKind, type PageOutline, type PageOutlineElement, type Rect } from "@region-split/core/browser";

const props = defineProps<{
  projectId: string;
  outline: PageOutline;
  selectedId: string | null;
  hoveredId?: string | null;
  busy?: boolean;
  progressText?: string;
  error?: string;
}>();
const emit = defineEmits<{
  select: [id: string];
  hover: [id: string | null];
  retry: [];
  patch: [id: string, patch: { kind?: ElementKind; text?: string; box?: Rect }];
}>();
const treeRefs = new Map<string, HTMLElement>();
const boxRefs = new Map<string, HTMLElement>();
const collapsedIds = ref(new Set<string>());
const treePanelCollapsed = ref(false);
const editKind = ref<ElementKind>("text");
const editText = ref("");
const editBox = ref<Rect>({ x: 0, y: 0, w: 4, h: 4 });

const selected = computed(() => props.outline.elements.find(element => element.id === props.selectedId) ?? null);
const imageSrc = computed(() => `/api/projects/${encodeURIComponent(props.projectId)}/image`);
const ordered = computed(() => props.outline.elements);
const elementById = computed(() => new Map(props.outline.elements.map(node => [node.id, node])));
const validParentById = computed(() => {
  const parents = new Map<string, string>();
  for (const node of props.outline.elements) {
    const parentId = node.parentHint;
    if (parentId && parentId !== node.id && elementById.value.has(parentId)) parents.set(node.id, parentId);
  }
  const cyclicIds = new Set<string>();
  for (const node of props.outline.elements) {
    const path: string[] = [];
    const indexById = new Map<string, number>();
    let currentId: string | undefined = node.id;
    while (currentId && parents.has(currentId)) {
      const cycleStart = indexById.get(currentId);
      if (cycleStart !== undefined) {
        for (const id of path.slice(cycleStart)) cyclicIds.add(id);
        break;
      }
      indexById.set(currentId, path.length);
      path.push(currentId);
      currentId = parents.get(currentId);
    }
  }
  for (const id of cyclicIds) parents.delete(id);
  return parents;
});
const childrenById = computed(() => {
  const children = new Map<string, string[]>();
  for (const [childId, parentId] of validParentById.value) {
    const siblings = children.get(parentId) ?? [];
    siblings.push(childId);
    children.set(parentId, siblings);
  }
  return children;
});
function ancestorsOf(id: string) {
  const ancestors: string[] = [];
  let currentId: string | undefined = id;
  while (currentId && validParentById.value.has(currentId)) {
    const parentId: string = validParentById.value.get(currentId)!;
    ancestors.push(parentId);
    currentId = parentId;
  }
  return ancestors;
}
const visibleNodes = computed(() => ordered.value.filter(node =>
  !ancestorsOf(node.id).some(parentId => collapsedIds.value.has(parentId)),
));
function displayDepth(id: string) { return ancestorsOf(id).length; }
const failedRegions = computed(() => props.outline.regions.filter(region => region.status === "failed" || region.status === "missing"));

function boxStyle(node: PageOutlineElement) {
  const { width, height } = props.outline.image;
  return {
    left: `${node.box.x / width * 100}%`, top: `${node.box.y / height * 100}%`,
    width: `${node.box.w / width * 100}%`, height: `${node.box.h / height * 100}%`,
  };
}
function toggleNode(id: string) {
  const next = new Set(collapsedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsedIds.value = next;
}
function expandAncestors(id: string) {
  const ancestors = new Set(ancestorsOf(id));
  if (!ancestors.size) return;
  collapsedIds.value = new Set([...collapsedIds.value].filter(nodeId => !ancestors.has(nodeId)));
}
function select(id: string, source: "tree" | "box") {
  if (source === "box") expandAncestors(id);
  emit("select", id);
  nextTick(() => {
    const target = source === "tree" ? boxRefs.get(id) : treeRefs.get(id);
    if (typeof target?.scrollIntoView === "function") target.scrollIntoView({ block: "center" });
  });
}
function bindTree(id: string, element: unknown) {
  if (element instanceof HTMLElement) treeRefs.set(id, element);
  else treeRefs.delete(id);
}
function bindBox(id: string, element: unknown) {
  if (element instanceof HTMLElement) boxRefs.set(id, element);
  else boxRefs.delete(id);
}
function restoreTreePanel() {
  treePanelCollapsed.value = false;
  const id = props.selectedId;
  if (!id) return;
  expandAncestors(id);
  nextTick(() => {
    const target = treeRefs.get(id);
    if (typeof target?.scrollIntoView === "function") target.scrollIntoView({ block: "center" });
  });
}
function save() {
  if (!selected.value) return;
  emit("patch", selected.value.id, { kind: editKind.value, text: editText.value, box: { ...editBox.value } });
}
watch(selected, node => {
  if (!node) return;
  editKind.value = node.kind;
  editText.value = node.text ?? "";
  editBox.value = { ...node.box };
}, { immediate: true });
</script>

<template>
  <main class="page-outline" data-test="page-outline">
    <header class="outline-toolbar">
      <div>
        <strong>整页轮廓图</strong>
        <span>可疑项 {{ outline.suspiciousCount }} / {{ outline.elements.length }}</span>
      </div>
      <div class="progress" aria-live="polite">{{ busy ? (progressText || "正在解析全部区域…") : progressText }}</div>
      <button v-if="failedRegions.length" type="button" data-test="retry-failed" @click="emit('retry')">
        重跑失败/缺失区域（{{ failedRegions.length }}）
      </button>
    </header>
    <p v-if="error" class="error">{{ error }}</p>

    <section class="outline-workspace" :class="{ 'tree-panel-collapsed': treePanelCollapsed }">
      <div class="page-scroll" data-test="image-panel">
        <div class="page-stage">
          <img :src="imageSrc" alt="待校准整页截图" />
          <button
            v-for="node in outline.elements" :key="node.id" :ref="element => bindBox(node.id, element)"
            type="button" class="element-box"
            :class="{ suspicious: node.suspicious, selected: node.id === selectedId, hovered: node.id === hoveredId }"
            :style="boxStyle(node)" :aria-label="`${node.displayName}${node.suspicious ? '，可疑' : ''} 元素框`" :aria-pressed="node.id === selectedId"
            @click="select(node.id, 'box')" @mouseenter="emit('hover', node.id)" @mouseleave="emit('hover', null)"
          />
        </div>
      </div>

      <aside v-if="!treePanelCollapsed" class="tree-panel" data-test="tree-panel" aria-label="页面结构树">
        <header class="panel-header">
          <strong>结构树</strong>
          <button type="button" data-test="collapse-tree-panel" aria-label="收起结构栏" @click="treePanelCollapsed = true">«</button>
        </header>
        <div class="outline-tree" data-test="outline-tree" role="tree" aria-label="页面元素结构">
          <div
            v-for="node in visibleNodes" :key="node.id" :ref="element => bindTree(node.id, element)"
            class="tree-item" :class="{ suspicious: node.suspicious, selected: node.id === selectedId }"
            role="treeitem" :aria-level="displayDepth(node.id) + 1" :aria-selected="node.id === selectedId"
            :aria-label="`${node.displayName}${node.suspicious ? '，可疑' : ''}`"
            :style="{ paddingLeft: `${7 + displayDepth(node.id) * 14}px` }"
            @mouseenter="emit('hover', node.id)" @mouseleave="emit('hover', null)"
          >
            <button
              v-if="childrenById.has(node.id)" type="button" class="tree-toggle"
              :data-test="`tree-toggle-${node.id}`" :aria-label="`${collapsedIds.has(node.id) ? '展开' : '折叠'} ${node.displayName}`"
              :aria-expanded="!collapsedIds.has(node.id)" @click.stop="toggleNode(node.id)"
            >{{ collapsedIds.has(node.id) ? "›" : "⌄" }}</button>
            <span v-else class="tree-toggle-spacer" />
            <button type="button" class="tree-item-content" @click="select(node.id, 'tree')">
              <span>{{ node.outlineNumber }}</span><strong>{{ node.displayName }}</strong><small>{{ node.kind }}</small>
            </button>
          </div>
        </div>
      </aside>
      <button
        v-else type="button" class="tree-panel-restore" data-test="restore-tree-panel"
        aria-label="展开结构栏" @click="restoreTreePanel"
      ><span>›</span><span>结构</span></button>

      <aside class="property-panel" data-test="property-panel" aria-label="元素属性编辑">
        <form v-if="selected" class="calibration" data-test="calibration" @submit.prevent="save">
          <header class="property-heading">
            <div><small>{{ selected.outlineNumber }} · {{ selected.regionName }}</small><strong>{{ selected.displayName }}</strong></div>
            <span v-if="selected.suspicious" class="suspicious-badge">可疑</span>
          </header>
          <label>分类
            <select v-model="editKind" data-test="calibration-kind">
              <option v-for="kind in elementKinds" :key="kind" :value="kind">{{ kind }}</option>
            </select>
          </label>
          <label>文字<input v-model="editText" data-test="calibration-text" /></label>
          <div class="rect-fields">
            <label v-for="key in (['x', 'y', 'w', 'h'] as const)" :key="key">{{ key }}
              <input v-model.number="editBox[key]" type="number" :min="key === 'w' || key === 'h' ? 4 : 0" />
            </label>
          </div>
          <button type="submit" data-test="save-calibration">保存校准</button>
        </form>
        <div v-else class="property-empty" data-test="property-empty">选择元素后编辑属性</div>
      </aside>
    </section>
  </main>
</template>

<style scoped>
.page-outline { height: 100%; min-height: 0; display: flex; flex-direction: column; color: var(--text, #e5e7eb); background: #11151d; }
.outline-toolbar { min-height: 52px; padding: 8px 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid #2a3342; background: #171c25; }
.outline-toolbar div:first-child { display: flex; align-items: baseline; gap: 10px; }
.outline-toolbar span, .progress { color: #93a4bb; font-size: 12px; }
.outline-toolbar button, .calibration button { border: 1px solid #3979d1; border-radius: 5px; padding: 6px 10px; color: #cfe3ff; background: #19365d; cursor: pointer; }
.error { margin: 0; padding: 6px 14px; color: #ffb4b4; background: #501f28; }
.outline-workspace { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 300px 300px; }
.outline-workspace.tree-panel-collapsed { grid-template-columns: minmax(0, 1fr) 34px 300px; }
.page-scroll { min-width: 0; min-height: 0; overflow: auto; padding: 18px; background: #0c1017; }
.page-stage { position: relative; width: min(100%, 900px); margin: 0 auto; line-height: 0; box-shadow: 0 6px 28px #000a; }
.page-stage > img { width: 100%; height: auto; }
.element-box { position: absolute; padding: 0; border: 1px solid #55a4ff55; background: #3b82f610; cursor: pointer; }
.element-box:hover, .element-box.hovered { border-color: #77b7ff; background: #3b82f62b; }
.element-box.suspicious { z-index: 2; border: 2px solid #ffb020; background: #ff9d0029; }
.element-box.selected { z-index: 3; border: 2px solid #30d5ff; background: #00bce83b; }
.tree-panel, .property-panel { min-height: 0; border-left: 1px solid #2a3342; background: #151a23; }
.tree-panel { display: flex; flex-direction: column; }
.property-panel { overflow: auto; }
.panel-header, .property-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px; border-bottom: 1px solid #2a3342; }
.panel-header button { border: 1px solid #354155; border-radius: 4px; color: #93a4bb; background: #202938; cursor: pointer; }
.property-heading { margin: -10px -10px 2px; }.property-heading div { min-width: 0; display: grid; gap: 3px; }.property-heading small { color: #8192aa; }.property-heading strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.suspicious-badge { border: 1px solid #b66d13; border-radius: 999px; padding: 2px 7px; color: #ffd38a; background: #4a2e0d; font-size: 11px; }
.tree-panel-restore { min-width: 0; border: 0; border-left: 1px solid #2a3342; color: #93a4bb; background: #151a23; cursor: pointer; writing-mode: vertical-rl; }
.outline-tree { flex: 1; min-height: 0; overflow: auto; padding: 8px; }
.tree-item { width: 100%; display: grid; grid-template-columns: 24px minmax(0, 1fr); align-items: center; border: 1px solid transparent; border-radius: 5px; color: #cad5e3; background: transparent; }
.tree-item:hover { background: #202938; }.tree-item.suspicious { color: #ffd38a; }.tree-item.selected { border-color: #30d5ff; background: #183b4a; }
.tree-toggle, .tree-item-content { border: 0; color: inherit; background: transparent; cursor: pointer; }
.tree-toggle { width: 24px; height: 30px; padding: 0; font-size: 18px; }.tree-toggle-spacer { width: 24px; }
.tree-item-content { min-width: 0; display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; gap: 7px; align-items: center; padding: 7px 7px 7px 0; text-align: left; }
.tree-item-content strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.tree-item small { color: #8192aa; }.calibration { padding: 10px; display: grid; gap: 8px; }
.calibration label { display: grid; gap: 3px; color: #93a4bb; font-size: 11px; }.calibration input, .calibration select { min-width: 0; padding: 5px; border: 1px solid #354155; border-radius: 4px; color: #e7edf6; background: #10151d; }
.rect-fields { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; }
.property-empty { display: grid; min-height: 180px; place-items: center; padding: 24px; color: #8192aa; text-align: center; }
@media (max-width: 900px) { .outline-workspace, .outline-workspace.tree-panel-collapsed { grid-template-columns: minmax(0, 1fr) minmax(260px, 38vw); grid-template-rows: minmax(360px, 55vh) minmax(280px, auto); overflow: auto; }.page-scroll { grid-column: 1 / -1; min-height: 360px; }.tree-panel, .tree-panel-restore, .property-panel { min-height: 280px; border-top: 1px solid #2a3342; }.tree-panel, .tree-panel-restore { border-left: 0; }.tree-panel-restore { writing-mode: vertical-rl; } }
@media (max-width: 640px) { .outline-workspace, .outline-workspace.tree-panel-collapsed { display: flex; flex-direction: column; overflow: auto; }.page-scroll { min-height: 55vh; }.tree-panel, .property-panel { min-height: 280px; }.tree-panel-restore { min-height: 34px; writing-mode: horizontal-tb; } }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
</style>
