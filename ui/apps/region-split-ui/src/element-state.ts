import { computed, ref, shallowRef } from "vue";
import {
  applyBox, recomputeLayout,
  type ElementKind, type ElementNode, type ElementTree, type Rect,
} from "@region-split/core/browser";
import type { StoreApi } from "./api.js";

export function supportsBorderRadius(kind: ElementKind): boolean {
  return kind === "image" || kind === "component";
}

function clearBorderRadii(nodes: ElementNode[]): ElementNode[] {
  return nodes.map(node => {
    if (node.style.borderRadius === undefined) return node;
    const style = { ...node.style };
    delete style.borderRadius;
    return { ...node, style };
  });
}

function clearTreeBorderRadii(next: ElementTree | null): ElementTree | null {
  return next ? { ...next, nodes: clearBorderRadii(next.nodes) } : null;
}

/**
 * 元素编辑独立于区域编辑：不共用撤销栈，也不进 state.ts。
 * 元素的每个动作都可直接反向操作（删除→重新框选，新增→删除），不需要撤销栈；
 * 混进区域的 Region[] 栈只会让两种状态互相污染。
 */
export function createElementStore(api: StoreApi) {
  const tree = shallowRef<ElementTree | null>(null);
  const treeVersion = ref<string | null>(null);
  const dirty = ref(false);
  const editingLocked = ref(false);
  const undoSnapshot = shallowRef<{ tree: ElementTree; treeVersion: string | null } | null>(null);
  const busyLabel = ref("");
  const error = ref("");
  const selectedId = ref<string | null>(null);
  const busy = computed(() => busyLabel.value !== "");
  const nodes = computed(() => tree.value?.nodes ?? []);
  const selectedNode = computed(() =>
    nodes.value.find(node => node.id === selectedId.value) ?? null);

  function nextId(existing: ElementNode[]): string {
    const used = new Set(existing.map(node => node.id));
    let n = existing.length + 1;
    while (used.has(`n${n}`)) n++;
    return `n${n}`;
  }

  const contains = (outer: Rect, inner: Rect) =>
    inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w
    && inner.y + inner.h <= outer.y + outer.h;

  /**
   * 人工改动父子关系之后，受影响容器的布局量、重复与滚动就过时了。
   * 这些量全是纯几何——只用子块矩形，不需要像素——所以前端直接算，改完立刻可见。
   * 已被人工切换过滚动的节点记在 scrollOverrides 里，重算时保留它们的取值。
   */
  const scrollOverrides = new Set<string>();
  const relayout = (next: ElementNode[]) => recomputeLayout(next, scrollOverrides);

  async function commit(projectId: string, region: Rect, next: ElementNode[]): Promise<void> {
    const current = tree.value;
    if (!current || editingLocked.value) return;
    // 先落本地再落盘：保存失败时保留本地编辑不回滚，只报错，
    // 与 state.ts 里 persistNow 的做法一致。
    const edited: ElementTree = { ...current, nodes: next };
    tree.value = edited;
    dirty.value = true;
    undoSnapshot.value = null;
    error.value = "";
    try {
      const saved = await api.putElements(projectId, region, edited);
      tree.value = saved.tree;
      treeVersion.value = saved.treeVersion ?? null;
      dirty.value = false;
    } catch (err) {
      error.value = (err as Error).message;
    }
  }

  return {
    tree, treeVersion, dirty, editingLocked, undoSnapshot, nodes, busy, busyLabel, error, selectedId, selectedNode,

    select(id: string | null) { selectedId.value = id; },

    replaceFromRefactor(next: ElementTree, version: string, candidateRootId: string) {
      if (tree.value) undoSnapshot.value = { tree: structuredClone(tree.value), treeVersion: treeVersion.value };
      tree.value = next;
      treeVersion.value = version;
      dirty.value = false;
      selectedId.value = candidateRootId;
    },

    async undoRefactor(projectId: string, region: Rect) {
      const snapshot = undoSnapshot.value;
      if (!snapshot || editingLocked.value) return;
      const saved = await api.putElements(projectId, region, snapshot.tree);
      tree.value = saved.tree;
      treeVersion.value = saved.treeVersion ?? null;
      selectedId.value = snapshot.tree.nodes[0]?.id ?? null;
      undoSnapshot.value = null;
      dirty.value = false;
    },

    async load(projectId: string, region: Rect) {
      busyLabel.value = "载入元素…"; error.value = "";
      try {
        const loaded = await api.getElements(projectId, region.y, region.h);
        tree.value = clearTreeBorderRadii(loaded.tree);
        treeVersion.value = loaded.treeVersion;
        dirty.value = false;
        undoSnapshot.value = null;
        selectedId.value = null;
        scrollOverrides.clear();
      } catch (err) { error.value = (err as Error).message; }
      finally { busyLabel.value = ""; }
    },

    async detect(projectId: string, region: Rect) {
      if (busy.value) return;
      busyLabel.value = "解析元素中…"; error.value = "";
      try {
        const detected = await api.detectElements(projectId, region);
        tree.value = detected.tree;
        treeVersion.value = detected.treeVersion ?? null;
        selectedId.value = null;
        scrollOverrides.clear();
      } catch (err) { error.value = (err as Error).message; }
      finally { busyLabel.value = ""; }
    },

    async rename(projectId: string, region: Rect, id: string, displayName: string) {
      if (displayName.trim() === "") return;
      await commit(projectId, region, nodes.value.map(node =>
        node.id === id ? { ...node, displayName: displayName.trim() } : node));
    },

    async setKind(projectId: string, region: Rect, id: string, kind: ElementKind) {
      await commit(projectId, region, nodes.value.map(node => {
        if (node.id !== id) return node;
        const style = { ...node.style };
        if (!supportsBorderRadius(kind)) delete style.borderRadius;
        return { ...node, kind, style, classification: "human" as const };
      }));
    },

    /** 人工覆盖几何判定出来的滚动属性 */
    async setScroll(
      projectId: string, region: Rect, id: string, axis: "x" | "y", value: boolean,
    ) {
      scrollOverrides.add(id);
      await commit(projectId, region, nodes.value.map(node => node.id === id
        ? { ...node, ...(axis === "x" ? { scrollX: value } : { scrollY: value }) }
        : node));
    },

    /**
     * 人工微调一个元素的框。测量会出错，所以这里必须能改。
     *
     * 尺寸变化会连带改动祖先或子孙（放大顶开父框、缩小裁进子框），所以
     * applyBox 返回的是**整棵更新后的节点表**而不是单个框。做不到就原样返回
     * 不落盘——与其发一个注定 422 的请求，不如当场什么都不做。
     */
    async setBox(projectId: string, region: Rect, id: string, next: Rect) {
      const result = applyBox(nodes.value, region, id, next);
      if (!result.ok) {
        // 改不动要说清楚原因，静默无动作看起来像失灵
        error.value = result.reason;
        return;
      }
      const before = nodes.value;
      const changed = result.nodes.some((node, index) => {
        const old = before[index]!.box;
        return old.x !== node.box.x || old.y !== node.box.y
          || old.w !== node.box.w || old.h !== node.box.h;
      });
      if (!changed) return;
      await commit(projectId, region, relayout(result.nodes));
    },

    /**
     * 人工调圆角。正值按用户输入保存，由浏览器按 CSS 规则渲染；
     * 0 表示直角，这时把字段删掉而不是存 0，保持文档干净。
     */
    async setRadius(projectId: string, region: Rect, id: string, radius: number) {
      const current = nodes.value.find(node => node.id === id);
      if (!current) return;
      const next = Math.max(0, Math.round(radius));
      if ((current.style.borderRadius ?? 0) === next) return;
      await commit(projectId, region, nodes.value.map(node => {
        if (node.id !== id) return node;
        const style = { ...node.style };
        if (next > 0) style.borderRadius = next;
        else delete style.borderRadius;
        return { ...node, style };
      }));
    },

    /** 人工改墨色。空值等于"没测出来"，这时删字段而不是存空串。 */
    async setColor(projectId: string, region: Rect, id: string, color: string) {
      const value = color.trim().toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(value)) return;
      const current = nodes.value.find(node => node.id === id);
      if (!current || current.style.color === value) return;
      await commit(projectId, region, nodes.value.map(node =>
        node.id === id ? { ...node, style: { ...node.style, color: value } } : node));
    },

    /** 人工改这个区域自身的背景色 */
    async setRegionBackground(projectId: string, region: Rect, color: string) {
      const current = tree.value;
      if (!current) return;
      const value = color.trim().toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(value) || current.background === value) return;
      tree.value = { ...current, background: value };
      await commit(projectId, region, nodes.value);
    },

    /** 写入字号字重。两者一起改——它们是同一次拟合的产物。 */
    async setFont(
      projectId: string, region: Rect, id: string,
      font: { fontSize?: number; fontWeight?: number },
    ) {
      const current = nodes.value.find(node => node.id === id);
      if (!current) return;
      const size = font.fontSize;
      const weight = font.fontWeight;
      if (size !== undefined && !(Number.isFinite(size) && size > 0)) return;
      if (weight !== undefined && !(Number.isFinite(weight) && weight > 0)) return;
      if (current.style.fontSize === size && current.style.fontWeight === weight) return;
      await commit(projectId, region, nodes.value.map(node => {
        if (node.id !== id) return node;
        const style = { ...node.style };
        if (size !== undefined) style.fontSize = Math.round(size * 10) / 10;
        if (weight !== undefined) style.fontWeight = Math.round(weight);
        return { ...node, style };
      }));
    },

    /** 删除一层：子节点上提到父节点，不级联删除 */
    async removeNode(projectId: string, region: Rect, id: string) {
      const target = nodes.value.find(node => node.id === id);
      if (!target) return;
      const next = nodes.value
        .filter(node => node.id !== id)
        .map(node => node.parentId === id ? { ...node, parentId: target.parentId } : node);
      if (selectedId.value === id) selectedId.value = null;
      scrollOverrides.delete(id);
      await commit(projectId, region, relayout(next));
    },

    /**
     * 框选新增一层容器：父节点取包含该矩形的**最深**节点，
     * 被该矩形完整包含的现有兄弟自动成为它的子节点。
     * 这正是补一层不可见容器——它在图上不留痕迹，原理上无法检测，只能人工加。
     */
    async addContainer(projectId: string, region: Rect, box: Rect) {
      if (!tree.value) return;
      const parent = nodes.value
        .filter(node => contains(node.box, box))
        .sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h)[0] ?? null;
      const id = nextId(nodes.value);
      const added: ElementNode = {
        id, parentId: parent?.id ?? null, box, kind: "component",
        displayName: "新建容器", style: {}, uniformity: 1,
        source: "manual", classification: "human",
        scrollX: false, scrollY: false, positioning: "flow",
      };
      const next = nodes.value.map(node =>
        node.parentId === (parent?.id ?? null) && contains(box, node.box)
          ? { ...node, parentId: id }
          : node);
      await commit(projectId, region, relayout([...next, added]));
      selectedId.value = id;
    },
  };
}

export type ElementStore = ReturnType<typeof createElementStore>;
