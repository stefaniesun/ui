import { computed, ref, shallowRef } from "vue";
import {
  recomputeLayout,
  type ElementKind, type ElementNode, type ElementTree, type Rect,
} from "@region-split/core/browser";
import type { StoreApi } from "./api.js";

/**
 * 元素编辑独立于区域编辑：不共用撤销栈，也不进 state.ts。
 * 元素的每个动作都可直接反向操作（删除→重新框选，新增→删除），不需要撤销栈；
 * 混进区域的 Region[] 栈只会让两种状态互相污染。
 */
export function createElementStore(api: StoreApi) {
  const tree = shallowRef<ElementTree | null>(null);
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
    if (!current) return;
    // 先落本地再落盘：保存失败时保留本地编辑不回滚，只报错，
    // 与 state.ts 里 persistNow 的做法一致。
    const edited: ElementTree = { ...current, nodes: next };
    tree.value = edited;
    error.value = "";
    try {
      tree.value = (await api.putElements(projectId, region, edited)).tree;
    } catch (err) {
      error.value = (err as Error).message;
    }
  }

  return {
    tree, nodes, busy, busyLabel, error, selectedId, selectedNode,

    select(id: string | null) { selectedId.value = id; },

    async load(projectId: string, region: Rect) {
      busyLabel.value = "载入元素…"; error.value = "";
      try {
        tree.value = (await api.getElements(projectId, region.y, region.h)).tree;
        selectedId.value = null;
        scrollOverrides.clear();
      } catch (err) { error.value = (err as Error).message; }
      finally { busyLabel.value = ""; }
    },

    async detect(projectId: string, region: Rect) {
      if (busy.value) return;
      busyLabel.value = "解析元素中…"; error.value = "";
      try {
        tree.value = (await api.detectElements(projectId, region)).tree;
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
      await commit(projectId, region, nodes.value.map(node =>
        node.id === id ? { ...node, kind, classification: "human" as const } : node));
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
