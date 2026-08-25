# 整页轮廓等高可调分栏实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将整页轮廓无限画布改为三栏等高、各栏独立纵向滚动，并通过两条分隔线自由调整相邻栏宽度。

**Architecture:** 新增无 DOM 依赖的 `panel-layout.ts`，统一负责默认宽度、最小宽度、相邻栏拖动钳制和边界复位。`PageOutline.vue` 只维护栏宽、视口高度和 pointer 会话，将结果输出为动态 Grid；无限画布继续只维护 `scale/x/y`，两种拖动状态严格隔离。

**Tech Stack:** Vue 3 Composition API、TypeScript、CSS Grid、Pointer Events、Vitest、Vue Test Utils、jsdom。

---

## 文件结构

- Create: `apps/region-split-ui/src/panel-layout.ts` — 三栏宽度、舞台尺寸及相邻栏调整的纯函数。
- Create: `apps/region-split-ui/src/panel-layout.test.ts` — 宽度计算、最小值和非有限输入单元测试。
- Modify: `apps/region-split-ui/src/components/PageOutline.vue` — 等高布局、独立滚动、双分隔线、收起恢复和图片栏定位。
- Modify: `apps/region-split-ui/src/components/PageOutline.test.ts` — DOM 布局、滚轮、Pointer Events、收起恢复及定位回归测试。

## 统一实现约定

```ts
export type PanelWidths = {
  image: number;
  tree: number;
  property: number;
};

export type PanelBoundary = "image-tree" | "tree-property";

export const SPLITTER_SIZE = 6;
export const TREE_RESTORE_WIDTH = 34;
export const DEFAULT_WORKSPACE_HEIGHT = 760;
export const DEFAULT_PANEL_WIDTHS: PanelWidths = { image: 594, tree: 297, property: 297 };
export const MIN_PANEL_WIDTHS: PanelWidths = { image: 320, tree: 220, property: 220 };
```

展开态总宽为 \(594 + 297 + 297 + 2\times6 = 1200\) 像素。拖动仅在相邻两栏间重新分配宽度，因此展开态总宽恒定。收起态总宽为当前原图宽度、恢复条宽度和属性栏宽度之和。

所有 pnpm 命令都从 `D:/workspace/ui` 执行，并显式使用项目内 store：

```powershell
pnpm --store-dir D:/workspace/ui/.pnpm-store ...
```

### Task 1: 建立三栏宽度纯计算模型

**Files:**
- Create: `apps/region-split-ui/src/panel-layout.ts`
- Create: `apps/region-split-ui/src/panel-layout.test.ts`

- [ ] **Step 1: 编写相邻栏调整和复位的失败测试**

创建 `apps/region-split-ui/src/panel-layout.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PANEL_WIDTHS,
  MIN_PANEL_WIDTHS,
  SPLITTER_SIZE,
  TREE_RESTORE_WIDTH,
  collapsedWorkspaceWidth,
  expandedWorkspaceWidth,
  resetPanelBoundary,
  resizePanelBoundary,
} from "./panel-layout.js";

describe("panel layout", () => {
  it("keeps expanded workspace width while resizing adjacent panels", () => {
    const before = expandedWorkspaceWidth(DEFAULT_PANEL_WIDTHS);
    const first = resizePanelBoundary(DEFAULT_PANEL_WIDTHS, "image-tree", 80);
    expect(first).toEqual({ image: 674, tree: 220, property: 297 });
    expect(expandedWorkspaceWidth(first)).toBe(before);

    const second = resizePanelBoundary(first, "tree-property", 40);
    expect(second).toEqual({ image: 674, tree: 260, property: 257 });
    expect(expandedWorkspaceWidth(second)).toBe(before);
  });

  it("clamps every panel at its minimum width", () => {
    expect(resizePanelBoundary(DEFAULT_PANEL_WIDTHS, "image-tree", -999)).toEqual({
      image: MIN_PANEL_WIDTHS.image,
      tree: 571,
      property: 297,
    });
    expect(resizePanelBoundary(DEFAULT_PANEL_WIDTHS, "tree-property", -999)).toEqual({
      image: 594,
      tree: MIN_PANEL_WIDTHS.tree,
      property: 374,
    });
    expect(resizePanelBoundary(DEFAULT_PANEL_WIDTHS, "tree-property", 999)).toEqual({
      image: 594,
      tree: 374,
      property: MIN_PANEL_WIDTHS.property,
    });
  });

  it("ignores non-finite deltas and does not mutate the input", () => {
    const widths = { ...DEFAULT_PANEL_WIDTHS };
    expect(resizePanelBoundary(widths, "image-tree", Number.NaN)).toEqual(widths);
    expect(resizePanelBoundary(widths, "tree-property", Number.POSITIVE_INFINITY)).toEqual(widths);
    expect(widths).toEqual(DEFAULT_PANEL_WIDTHS);
  });

  it("resets only the selected pair using its default ratio", () => {
    const widths = { image: 500, tree: 391, property: 297 };
    expect(resetPanelBoundary(widths, "image-tree")).toEqual(DEFAULT_PANEL_WIDTHS);

    const second = { image: 594, tree: 250, property: 344 };
    expect(resetPanelBoundary(second, "tree-property")).toEqual(DEFAULT_PANEL_WIDTHS);
  });

  it("includes splitters only while expanded", () => {
    expect(expandedWorkspaceWidth(DEFAULT_PANEL_WIDTHS)).toBe(1200);
    expect(collapsedWorkspaceWidth(DEFAULT_PANEL_WIDTHS)).toBe(594 + TREE_RESTORE_WIDTH + 297);
    expect(SPLITTER_SIZE).toBe(6);
  });
});
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run:

```powershell
pnpm --store-dir D:/workspace/ui/.pnpm-store --filter @region-split/ui test -- src/panel-layout.test.ts
```

Expected: FAIL，提示无法解析 `./panel-layout.js`。

- [ ] **Step 3: 实现最小纯计算模块**

创建 `apps/region-split-ui/src/panel-layout.ts`：

```ts
export type PanelWidths = {
  image: number;
  tree: number;
  property: number;
};

export type PanelBoundary = "image-tree" | "tree-property";

export const SPLITTER_SIZE = 6;
export const TREE_RESTORE_WIDTH = 34;
export const DEFAULT_WORKSPACE_HEIGHT = 760;
export const DEFAULT_PANEL_WIDTHS: PanelWidths = { image: 594, tree: 297, property: 297 };
export const MIN_PANEL_WIDTHS: PanelWidths = { image: 320, tree: 220, property: 220 };

function finiteWidths(widths: PanelWidths) {
  return Object.values(widths).every(width => Number.isFinite(width) && width > 0);
}

function distributePair(total: number, preferredFirst: number, firstMin: number, secondMin: number) {
  const first = Math.min(Math.max(preferredFirst, firstMin), total - secondMin);
  return [first, total - first] as const;
}

export function resizePanelBoundary(widths: PanelWidths, boundary: PanelBoundary, delta: number): PanelWidths {
  if (!finiteWidths(widths) || !Number.isFinite(delta)) return { ...widths };
  if (boundary === "image-tree") {
    const total = widths.image + widths.tree;
    const [image, tree] = distributePair(total, widths.image + delta, MIN_PANEL_WIDTHS.image, MIN_PANEL_WIDTHS.tree);
    return { image, tree, property: widths.property };
  }
  const total = widths.tree + widths.property;
  const [tree, property] = distributePair(total, widths.tree + delta, MIN_PANEL_WIDTHS.tree, MIN_PANEL_WIDTHS.property);
  return { image: widths.image, tree, property };
}

export function resetPanelBoundary(widths: PanelWidths, boundary: PanelBoundary): PanelWidths {
  if (!finiteWidths(widths)) return { ...DEFAULT_PANEL_WIDTHS };
  if (boundary === "image-tree") {
    const total = widths.image + widths.tree;
    const defaultPair = DEFAULT_PANEL_WIDTHS.image + DEFAULT_PANEL_WIDTHS.tree;
    const preferred = total * DEFAULT_PANEL_WIDTHS.image / defaultPair;
    const [image, tree] = distributePair(total, preferred, MIN_PANEL_WIDTHS.image, MIN_PANEL_WIDTHS.tree);
    return { image, tree, property: widths.property };
  }
  const total = widths.tree + widths.property;
  const defaultPair = DEFAULT_PANEL_WIDTHS.tree + DEFAULT_PANEL_WIDTHS.property;
  const preferred = total * DEFAULT_PANEL_WIDTHS.tree / defaultPair;
  const [tree, property] = distributePair(total, preferred, MIN_PANEL_WIDTHS.tree, MIN_PANEL_WIDTHS.property);
  return { image: widths.image, tree, property };
}

export function expandedWorkspaceWidth(widths: PanelWidths) {
  return widths.image + widths.tree + widths.property + SPLITTER_SIZE * 2;
}

export function collapsedWorkspaceWidth(widths: PanelWidths) {
  return widths.image + TREE_RESTORE_WIDTH + widths.property;
}
```

- [ ] **Step 4: 运行纯函数测试并确认通过**

Run:

```powershell
pnpm --store-dir D:/workspace/ui/.pnpm-store --filter @region-split/ui test -- src/panel-layout.test.ts
```

Expected: `5 passed`。

- [ ] **Step 5: 提交宽度计算模型**

```powershell
git add apps/region-split-ui/src/panel-layout.ts apps/region-split-ui/src/panel-layout.test.ts
git commit -m "feat: add outline panel layout model"
```

### Task 2: 让三栏等高并分别滚动

**Files:**
- Modify: `apps/region-split-ui/src/components/PageOutline.vue:117-213,397-475,480-519`
- Modify: `apps/region-split-ui/src/components/PageOutline.test.ts:141-258`

- [ ] **Step 1: 编写等高和三栏滚轮路由的失败测试**

在 `PageOutline.test.ts` 的统一舞台测试后加入：

```ts
it("uses the viewport height for one equal-height three-panel workspace", async () => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: "0-1000::ok" } });
  const viewport = wrapper.get('[data-test="canvas-viewport"]');
  setElementSize(viewport.element, 1024, 680);
  resizeCallback?.();
  await wrapper.vm.$nextTick();

  const stageStyle = wrapper.get('[data-test="canvas-stage"]').attributes("style") ?? "";
  expect(stageStyle).toContain("height: 680px");
  for (const selector of ['[data-test="image-panel"]', '[data-test="tree-panel"]', '[data-test="property-panel"]']) {
    expect(wrapper.get(selector).attributes("data-scroll-panel")).toBe("true");
  }
});

it("keeps ordinary wheel scrolling inside all three panels", async () => {
  const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: "0-1000::ok" } });
  for (const selector of ['[data-test="image-panel"]', '[data-test="tree-panel"]', '[data-test="property-panel"]']) {
    const event = new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true });
    wrapper.get(selector).element.dispatchEvent(event);
    await wrapper.vm.$nextTick();
    expect(event.defaultPrevented).toBe(false);
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("100%");
  }

  const ctrlWheel = new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true });
  wrapper.get('[data-test="image-panel"]').element.dispatchEvent(ctrlWheel);
  await wrapper.vm.$nextTick();
  expect(ctrlWheel.defaultPrevented).toBe(true);
  expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("110%");
});
```

同时把现有普通面板滚轮循环从树栏、属性栏扩充为原图栏，删除“原图普通滚轮缩放”的旧断言。

- [ ] **Step 2: 运行组件定向测试并确认失败**

Run:

```powershell
pnpm --store-dir D:/workspace/ui/.pnpm-store --filter @region-split/ui test -- src/components/PageOutline.test.ts
```

Expected: FAIL，舞台没有 `height: 680px`，原图普通滚轮仍触发缩放。

- [ ] **Step 3: 输出有效视口高度并统一滚动识别**

在 `PageOutline.vue` 导入布局常量：

```ts
import {
  DEFAULT_PANEL_WIDTHS,
  DEFAULT_WORKSPACE_HEIGHT,
  SPLITTER_SIZE,
  TREE_RESTORE_WIDTH,
  collapsedWorkspaceWidth,
  expandedWorkspaceWidth,
  resetPanelBoundary,
  resizePanelBoundary,
  type PanelBoundary,
  type PanelWidths,
} from "../panel-layout.js";
```

本任务先使用其中高度常量。更新舞台样式和滚动判断：

```ts
const workspaceHeight = computed(() => hasSize(viewportSize.value)
  ? viewportSize.value.height
  : DEFAULT_WORKSPACE_HEIGHT);

const canvasStageStyle = computed(() => ({
  height: `${workspaceHeight.value}px`,
  transform: `translate3d(${view.value.x}px, ${view.value.y}px, 0) scale(${view.value.scale})`,
}));

function isScrollablePanel(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("[data-scroll-panel='true'], .tree-panel-restore"));
}
```

给原图、结构树外栏和属性栏添加 `data-scroll-panel="true"`。保留结构树栏头固定，滚动仍发生在 `.outline-tree`。

CSS 改为：

```css
.outline-workspace { position: absolute; top: 0; left: 0; display: grid; align-items: stretch; overflow: hidden; transform-origin: 0 0; will-change: transform; box-shadow: 0 12px 42px #000b; }
.page-scroll { min-width: 0; min-height: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; background: #0c1017; }
.tree-panel, .property-panel { min-width: 0; min-height: 0; overflow: hidden; border-left: 1px solid #2a3342; background: #151a23; }
.property-panel { overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; }
.outline-tree { flex: 1; min-height: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; padding: 8px; }
```

移除 `.outline-workspace` 的 `min-height` 和三个媒体查询中的固定宽高；Task 3 会补全动态列宽。

- [ ] **Step 4: 运行组件测试并确认等高滚动测试通过**

Run:

```powershell
pnpm --store-dir D:/workspace/ui/.pnpm-store --filter @region-split/ui test -- src/components/PageOutline.test.ts
```

Expected: 新增测试 PASS；若现有 fit 测试依赖 `stage.clientHeight`，继续通过 `setElementSize(stage, width, height)`提供确定尺寸。

- [ ] **Step 5: 提交等高滚动布局**

```powershell
git add apps/region-split-ui/src/components/PageOutline.vue apps/region-split-ui/src/components/PageOutline.test.ts
git commit -m "feat: make outline panels equal-height scroll regions"
```

### Task 3: 增加两条可拖动分隔线

**Files:**
- Modify: `apps/region-split-ui/src/components/PageOutline.vue:117-289,397-475,480-519`
- Modify: `apps/region-split-ui/src/components/PageOutline.test.ts:275-383,433-481`

- [ ] **Step 1: 编写两条分隔线、最小宽度和事件隔离的失败测试**

在 `PageOutline.test.ts` 加入 helper：

```ts
function mockPointerCapture(element: Element) {
  const setPointerCapture = vi.fn();
  const releasePointerCapture = vi.fn();
  Object.defineProperties(element, {
    setPointerCapture: { configurable: true, value: setPointerCapture },
    hasPointerCapture: { configurable: true, value: () => true },
    releasePointerCapture: { configurable: true, value: releasePointerCapture },
  });
  return { setPointerCapture, releasePointerCapture };
}
```

加入测试：

```ts
it("resizes only adjacent panels while keeping the expanded stage width", async () => {
  const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
  const stage = wrapper.get('[data-test="canvas-stage"]');
  expect(stage.attributes("style")).toContain("width: 1200px");

  const first = wrapper.get('[data-test="splitter-image-tree"]');
  mockPointerCapture(first.element);
  await first.trigger("pointerdown", { button: 0, pointerId: 11, clientX: 600 });
  await first.trigger("pointermove", { pointerId: 11, clientX: 680 });
  await first.trigger("pointerup", { pointerId: 11, clientX: 680 });
  expect(stage.attributes("style")).toContain("674px 6px 220px 6px 297px");
  expect(stage.attributes("style")).toContain("width: 1200px");

  const second = wrapper.get('[data-test="splitter-tree-property"]');
  mockPointerCapture(second.element);
  await second.trigger("pointerdown", { button: 0, pointerId: 12, clientX: 900 });
  await second.trigger("pointermove", { pointerId: 12, clientX: 940 });
  await second.trigger("pointerup", { pointerId: 12, clientX: 940 });
  expect(stage.attributes("style")).toContain("674px 6px 260px 6px 257px");
  expect(stage.attributes("style")).toContain("width: 1200px");
});

it("captures splitter pointers without starting canvas panning", async () => {
  const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
  const splitter = wrapper.get('[data-test="splitter-image-tree"]');
  const capture = mockPointerCapture(splitter.element);
  const beforeTransform = wrapper.get('[data-test="canvas-stage"]').attributes("style");

  await splitter.trigger("pointerdown", { button: 0, pointerId: 21, clientX: 600 });
  await splitter.trigger("pointermove", { pointerId: 21, clientX: -1000 });
  await splitter.trigger("pointerup", { pointerId: 21, clientX: -1000 });

  expect(capture.setPointerCapture).toHaveBeenCalledWith(21);
  expect(capture.releasePointerCapture).toHaveBeenCalledWith(21);
  expect(wrapper.get('[data-test="canvas-stage"]').attributes("style")).toContain("320px 6px 571px 6px 297px");
  expect(wrapper.get('[data-test="canvas-stage"]').attributes("style")?.match(/transform:[^;]+/)?.[0])
    .toBe(beforeTransform?.match(/transform:[^;]+/)?.[0]);
});

it("cleans splitter drag on cancel and resets a boundary on double click", async () => {
  const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
  const splitter = wrapper.get('[data-test="splitter-tree-property"]');
  mockPointerCapture(splitter.element);
  await splitter.trigger("pointerdown", { button: 0, pointerId: 31, clientX: 900 });
  await splitter.trigger("pointermove", { pointerId: 31, clientX: 940 });
  await splitter.trigger("pointercancel", { pointerId: 31 });
  const afterCancel = wrapper.get('[data-test="canvas-stage"]').attributes("style");
  await splitter.trigger("pointermove", { pointerId: 31, clientX: 980 });
  expect(wrapper.get('[data-test="canvas-stage"]').attributes("style")).toBe(afterCancel);

  await splitter.trigger("dblclick");
  expect(wrapper.get('[data-test="canvas-stage"]').attributes("style")).toContain("594px 6px 297px 6px 297px");
});
```

- [ ] **Step 2: 运行组件测试并确认分隔线不存在**

Run:

```powershell
pnpm --store-dir D:/workspace/ui/.pnpm-store --filter @region-split/ui test -- src/components/PageOutline.test.ts
```

Expected: FAIL，找不到 `splitter-image-tree` 和 `splitter-tree-property`。

- [ ] **Step 3: 增加栏宽状态和分隔线 pointer 会话**

在 `PageOutline.vue` 增加：

```ts
const panelWidths = ref<PanelWidths>({ ...DEFAULT_PANEL_WIDTHS });
const isResizingPanels = ref(false);
let resizeFrom: {
  pointerId: number;
  boundary: PanelBoundary;
  x: number;
  widths: PanelWidths;
  target: HTMLElement;
} | null = null;

const workspaceWidth = computed(() => treePanelCollapsed.value
  ? collapsedWorkspaceWidth(panelWidths.value)
  : expandedWorkspaceWidth(panelWidths.value));

const canvasStageStyle = computed(() => ({
  width: `${workspaceWidth.value}px`,
  height: `${workspaceHeight.value}px`,
  gridTemplateColumns: treePanelCollapsed.value
    ? `${panelWidths.value.image}px ${TREE_RESTORE_WIDTH}px ${panelWidths.value.property}px`
    : `${panelWidths.value.image}px ${SPLITTER_SIZE}px ${panelWidths.value.tree}px ${SPLITTER_SIZE}px ${panelWidths.value.property}px`,
  transform: `translate3d(${view.value.x}px, ${view.value.y}px, 0) scale(${view.value.scale})`,
}));

function onResizeStart(boundary: PanelBoundary, event: PointerEvent) {
  if (event.button !== 0 || resizeFrom) return;
  event.preventDefault();
  event.stopPropagation();
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return;
  target.setPointerCapture?.(event.pointerId);
  resizeFrom = { pointerId: event.pointerId, boundary, x: event.clientX, widths: { ...panelWidths.value }, target };
  isResizingPanels.value = true;
}

function onResizeMove(event: PointerEvent) {
  if (!resizeFrom || resizeFrom.pointerId !== event.pointerId) return;
  event.preventDefault();
  event.stopPropagation();
  panelWidths.value = resizePanelBoundary(resizeFrom.widths, resizeFrom.boundary, event.clientX - resizeFrom.x);
}

function endResize(event?: PointerEvent) {
  if (!resizeFrom || event && resizeFrom.pointerId !== event.pointerId) return;
  const { pointerId, target } = resizeFrom;
  if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);
  resizeFrom = null;
  isResizingPanels.value = false;
}

function resetBoundary(boundary: PanelBoundary, event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  panelWidths.value = resetPanelBoundary(panelWidths.value, boundary);
}
```

`onWindowBlur`、`onBeforeUnmount` 除清理 pan 外调用 `endResize()`。`onPanStart` 开头增加 `if (isResizingPanels.value) return;` 作为冒泡之外的第二层保护。

- [ ] **Step 4: 在模板中插入分隔线并补齐样式**

展开态模板顺序必须为：原图、第一分隔线、结构树、第二分隔线、属性栏。两个分隔线使用：

```vue
<div
  v-if="!treePanelCollapsed"
  class="panel-splitter"
  data-test="splitter-image-tree"
  role="separator"
  aria-label="调整原图与结构树宽度"
  aria-orientation="vertical"
  @pointerdown="onResizeStart('image-tree', $event)"
  @pointermove="onResizeMove"
  @pointerup="endResize"
  @pointercancel="endResize"
  @lostpointercapture="endResize"
  @dblclick="resetBoundary('image-tree', $event)"
/>
```

第二条使用 `data-test="splitter-tree-property"`、标签“调整结构树与属性栏宽度”和边界 `tree-property`。CSS：

```css
.panel-splitter { position: relative; min-width: 0; background: #111722; cursor: col-resize; touch-action: none; user-select: none; }
.panel-splitter::after { content: ""; position: absolute; inset: 0 2px; background: #354155; }
.panel-splitter:hover::after, .panel-splitter:focus-visible::after { background: #3b82f6; }
.canvas-viewport.is-resizing, .canvas-viewport.is-resizing * { cursor: col-resize !important; user-select: none !important; }
```

在 viewport class 增加 `'is-resizing': isResizingPanels`。删除旧固定 `width/grid-template-columns` 和收起态固定 CSS。

- [ ] **Step 5: 运行纯函数和组件测试**

Run:

```powershell
pnpm --store-dir D:/workspace/ui/.pnpm-store --filter @region-split/ui test -- src/panel-layout.test.ts src/components/PageOutline.test.ts
```

Expected: 两个测试文件全部 PASS。

- [ ] **Step 6: 提交双分隔线功能**

```powershell
git add apps/region-split-ui/src/components/PageOutline.vue apps/region-split-ui/src/components/PageOutline.test.ts
git commit -m "feat: resize outline panels with splitters"
```

### Task 4: 保留收起栏宽并将元素定位改为原图栏滚动

**Files:**
- Modify: `apps/region-split-ui/src/components/PageOutline.vue:296-345,410-475`
- Modify: `apps/region-split-ui/src/components/PageOutline.test.ts:433-519`

- [ ] **Step 1: 编写收起恢复栏宽和原图栏定位的失败测试**

把旧的“树选中后平移整个画布”测试替换为：

```ts
it("scrolls the image panel to a tree-selected box without moving the canvas", async () => {
  const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
  const imagePanel = wrapper.get('[data-test="image-panel"]');
  const box = wrapper.findAll(".element-box")[1]!;
  setElementSize(imagePanel.element, 594, 680);
  Object.defineProperties(box.element, {
    offsetTop: { configurable: true, value: 750 },
    offsetHeight: { configurable: true, value: 40 },
  });
  const scrollTo = vi.fn();
  Object.defineProperty(imagePanel.element, "scrollTo", { configurable: true, value: scrollTo });
  const before = wrapper.get('[data-test="canvas-stage"]').attributes("style")?.match(/transform:[^;]+/)?.[0];

  await wrapper.findAll(".tree-item-content")[1]!.trigger("click");
  await wrapper.vm.$nextTick();

  expect(scrollTo).toHaveBeenCalledWith({ top: 430, behavior: "auto" });
  expect(wrapper.get('[data-test="canvas-stage"]').attributes("style")?.match(/transform:[^;]+/)?.[0]).toBe(before);
});
```

加入收起恢复测试：先拖第一、第二分隔线得到 `674/260/257`，点击收起后断言两条 splitter 不存在、Grid 为 `674px 34px 257px`；恢复后断言 splitter 恢复且 Grid 仍为 `674px 6px 260px 6px 257px`。

- [ ] **Step 2: 运行定向测试并确认旧定位行为失败**

Run:

```powershell
pnpm --store-dir D:/workspace/ui/.pnpm-store --filter @region-split/ui test -- src/components/PageOutline.test.ts
```

Expected: FAIL，`imagePanel.scrollTo` 未调用，旧实现修改画布 `view`。

- [ ] **Step 3: 将树选择定位限制在原图滚动容器**

增加 `pageScroll` ref，并绑定到 `data-test="image-panel"`。以以下实现替换 `revealBox`：

```ts
function revealBoxInImagePanel(id: string) {
  const panel = pageScroll.value;
  const target = boxRefs.get(id);
  if (!panel || !target) return;
  const targetTop = target.offsetTop;
  const targetHeight = target.offsetHeight;
  const panelHeight = panel.clientHeight;
  if (![targetTop, targetHeight, panelHeight].every(Number.isFinite) || panelHeight <= 0) return;
  const top = Math.max(0, targetTop - (panelHeight - targetHeight) / 2);
  panel.scrollTo?.({ top, behavior: "auto" });
}
```

在 `select` 中将树来源分支改为 `revealBoxInImagePanel(id)`。图片框来源仍展开祖先并滚动结构树。删除 `revealRect` import；若无其他使用，保留 `infinite-canvas-view.ts` 中函数不动，避免无关重构。

栏宽本身一直保存在 `panelWidths` 中，收起只通过 `v-if`移除两条分隔线和树栏，因此无需复制快照。确保收起按钮只修改 `treePanelCollapsed`，恢复函数不重置 `panelWidths`。

- [ ] **Step 4: 更新收起态尺寸断言并运行组件测试**

更新旧固定宽度断言：默认收起宽度从 `934` 改为 `925`（`594 + 34 + 297`），用户调宽后按当前 `image + 34 + property`计算。运行：

```powershell
pnpm --store-dir D:/workspace/ui/.pnpm-store --filter @region-split/ui test -- src/components/PageOutline.test.ts
```

Expected: 全部 PASS；属性保存、树折叠、选择联动测试无回归。

- [ ] **Step 5: 提交收起恢复和栏内定位**

```powershell
git add apps/region-split-ui/src/components/PageOutline.vue apps/region-split-ui/src/components/PageOutline.test.ts
git commit -m "fix: preserve outline widths and scroll selected boxes"
```

### Task 5: 完整工程与浏览器验收

**Files:**
- Modify if needed: `apps/region-split-ui/src/components/PageOutline.vue`
- Modify if needed: `apps/region-split-ui/src/components/PageOutline.test.ts`
- Modify if needed: `apps/region-split-ui/src/panel-layout.ts`
- Modify if needed: `apps/region-split-ui/src/panel-layout.test.ts`

- [ ] **Step 1: 运行全部 UI 单元测试**

Run:

```powershell
pnpm --store-dir D:/workspace/ui/.pnpm-store --filter @region-split/ui test
```

Expected: PASS，零失败。

- [ ] **Step 2: 运行 UI 类型检查**

Run:

```powershell
pnpm --store-dir D:/workspace/ui/.pnpm-store --filter @region-split/ui typecheck
```

Expected: exit code `0`，无 TypeScript/Vue 错误。

- [ ] **Step 3: 运行 UI 生产构建**

Run:

```powershell
pnpm --store-dir D:/workspace/ui/.pnpm-store --filter @region-split/ui build
```

Expected: Vite build 成功，无 unresolved import。

- [ ] **Step 4: 启动本地页面并完成真实浏览器验收**

Run:

```powershell
pnpm --store-dir D:/workspace/ui/.pnpm-store --filter @region-split/ui dev -- --host 127.0.0.1
```

在浏览器逐项验证：

1. 三栏顶部和底部严格对齐，高度随窗口变化。
2. 长图、长结构树、长属性分别只滚动自身。
3. 三栏内普通滚轮滚动悬停栏，`Ctrl + 滚轮`缩放舞台。
4. 两条分隔线分别只改变相邻两栏，拖出舞台后仍持续调整。
5. 原图、结构树、属性栏分别无法小于 `320/220/220px`。
6. 双击分隔线恢复默认比例。
7. 分隔线拖动不移动画布、不选择节点、不选中元素框。
8. 中键和`空格 + 左键`在分隔线外仍能平移画布。
9. 结构栏收起后保留原图和属性栏宽度，恢复后还原结构栏宽度。
10. 树选择长图下方元素时只滚动原图栏，舞台 transform 不跳动。
11. “适应视图”、`100%`、缩放和平移仍正常。
12. 控制台无 error 或未处理异常。

- [ ] **Step 5: 修复验收发现的问题并重新执行前三项验证**

任何修复先补最小回归测试，再重新运行：

```powershell
pnpm --store-dir D:/workspace/ui/.pnpm-store --filter @region-split/ui test
pnpm --store-dir D:/workspace/ui/.pnpm-store --filter @region-split/ui typecheck
pnpm --store-dir D:/workspace/ui/.pnpm-store --filter @region-split/ui build
```

Expected: 三条命令全部成功。

- [ ] **Step 6: 提交最终验收修复（仅存在额外修改时）**

```powershell
git add apps/region-split-ui/src/components/PageOutline.vue apps/region-split-ui/src/components/PageOutline.test.ts apps/region-split-ui/src/panel-layout.ts apps/region-split-ui/src/panel-layout.test.ts
git commit -m "test: verify resizable outline panel interactions"
```

- [ ] **Step 7: 推送当前分支**

```powershell
git push origin dev
```

Expected: `dev -> dev`。若网络失败，保留本地提交并记录错误，不改写历史、不强制推送。
