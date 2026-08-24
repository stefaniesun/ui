# 整页轮廓无限画布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将顶部工具区下方的原图、结构树和属性栏组合成一个可统一缩放、平移、适应视图的无限画布工作台，同时保留面板内部滚动和全部业务交互。

**Architecture:** `PageOutline.vue` 保留业务状态和 DOM 事件编排，新建纯函数模块 `infinite-canvas-view.ts` 负责适应、锚点缩放、中心保持和目标可见性计算。画布视口裁切内容，三栏舞台统一应用 `translate3d(...) scale(...)`；树和属性栏仍是普通 DOM 并保留独立滚动。

**Tech Stack:** Vue 3 Composition API、TypeScript、Vitest、Vue Test Utils、CSS Transform、Pointer Events、ResizeObserver。

设计依据：`docs/superpowers/specs/2026-08-24-page-outline-infinite-canvas-design.md`。分支：`dev`。

---

## 文件结构与职责

- Create: `apps/region-split-ui/src/infinite-canvas-view.ts`
  - 只包含有限数值保护、适应视图、锚点缩放、保持中心和目标可见性等纯计算。
  - 不访问 DOM，不持有 Vue 状态，不依赖业务 DTO。
- Create: `apps/region-split-ui/src/infinite-canvas-view.test.ts`
  - 对所有视图数学函数做确定性单元测试，包括非法尺寸和非有限输入。
- Modify: `apps/region-split-ui/src/components/PageOutline.vue`
  - 挂载画布视口和三栏舞台。
  - 编排 ResizeObserver、滚轮、指针、键盘、工具栏按钮和元素定位。
  - 删除左侧原图独立滚动缩放模型。
- Modify: `apps/region-split-ui/src/components/PageOutline.test.ts`
  - 将原有左栏滚动测试改为统一舞台测试，并补齐滚轮路由、平移手势、视图恢复和业务交互回归。
- Create: `docs/superpowers/reports/2026-08-24-page-outline-infinite-canvas.md`
  - 记录红绿测试证据、工程验证、真实浏览器走查和偏差。

本次不修改 `App.vue`、后端、DTO、PATCH 契约、`.npmrc` 或依赖清单。若实现时发现 `App.vue` 高度阻止画布视口获得有效尺寸，必须先添加失败测试证明，再做最小调整，不能顺带重构。

## 全局执行约束

- 严格 TDD：每个行为先写失败测试，确认失败原因正确，再写最小实现。
- 不放宽现有业务断言；旧的“左栏滚动缩放”断言应被新空间模型的明确断言替换。
- 所有包命令使用项目内配置和现有本地依赖：

```powershell
Set-Location D:/workspace/ui/apps/region-split-ui
D:/nodejs/corepack.cmd pnpm exec vitest run <test-files>
```

- 不执行安装，不新增第三方库，不更改 `D:/workspace/ui/.npmrc`。
- 每个任务只暂存计划列出的文件，避免混入现有 `.npmrc` 和工作区外未跟踪文件。
- 每次提交后执行：

```powershell
git -C D:/workspace/ui status --short
git -C D:/workspace/ui show --stat --oneline HEAD
```

---

### Task 1: 提取无限画布视图数学

**Files:**
- Create: `apps/region-split-ui/src/infinite-canvas-view.ts`
- Create: `apps/region-split-ui/src/infinite-canvas-view.test.ts`

- [ ] **Step 1: 写纯函数失败测试**

创建 `apps/region-split-ui/src/infinite-canvas-view.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIEW,
  fitView,
  keepViewportCenter,
  revealRect,
  zoomAt,
} from "./infinite-canvas-view.js";

describe("infinite canvas view math", () => {
  it("fits and centers the whole stage with padding", () => {
    expect(fitView({ width: 1200, height: 800 }, { width: 1000, height: 600 }, 40)).toEqual({
      scale: 1.12,
      x: 40,
      y: 64,
    });
  });

  it("clamps a fitted view to the supported zoom range", () => {
    expect(fitView({ width: 5000, height: 5000 }, { width: 100, height: 100 }, 0)).toEqual({
      scale: 4,
      x: 2300,
      y: 2300,
    });
    expect(fitView({ width: 100, height: 100 }, { width: 5000, height: 5000 }, 0)).toEqual({
      scale: 0.2,
      x: -450,
      y: -450,
    });
  });

  it("falls back to 100 percent centered when dimensions are invalid", () => {
    expect(fitView({ width: 0, height: 600 }, { width: 1000, height: 600 }, 40)).toEqual(DEFAULT_VIEW);
    expect(fitView({ width: 1200, height: 800 }, { width: Number.NaN, height: 600 }, 40)).toEqual(DEFAULT_VIEW);
  });

  it("zooms around a viewport anchor", () => {
    expect(zoomAt({ scale: 1, x: 100, y: 50 }, 2, { x: 300, y: 250 })).toEqual({
      scale: 2,
      x: -100,
      y: -150,
    });
  });

  it("clamps zoom and ignores non-finite input", () => {
    expect(zoomAt(DEFAULT_VIEW, 10, { x: 0, y: 0 }).scale).toBe(4);
    expect(zoomAt(DEFAULT_VIEW, 0.01, { x: 0, y: 0 }).scale).toBe(0.2);
    expect(zoomAt(DEFAULT_VIEW, Number.NaN, { x: 10, y: 10 })).toEqual(DEFAULT_VIEW);
  });

  it("keeps the same stage point under the viewport center after resizing", () => {
    expect(keepViewportCenter(
      { scale: 1, x: 100, y: 50 },
      { width: 800, height: 600 },
      { width: 1000, height: 700 },
    )).toEqual({ scale: 1, x: 200, y: 100 });
  });

  it("moves only enough to reveal a hidden target while preserving scale", () => {
    expect(revealRect(
      { scale: 2, x: -100, y: -100 },
      { width: 600, height: 400 },
      { x: 400, y: 250, width: 100, height: 50 },
      24,
    )).toEqual({ scale: 2, x: -424, y: -224 });
  });

  it("does not move an already visible target", () => {
    const view = { scale: 1, x: 20, y: 30 };
    expect(revealRect(view, { width: 800, height: 600 }, { x: 100, y: 100, width: 80, height: 40 }, 24)).toEqual(view);
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

```powershell
Set-Location D:/workspace/ui/apps/region-split-ui
D:/nodejs/corepack.cmd pnpm exec vitest run src/infinite-canvas-view.test.ts
```

Expected: FAIL，提示无法解析 `./infinite-canvas-view.js`。

- [ ] **Step 3: 实现纯函数模块**

创建 `apps/region-split-ui/src/infinite-canvas-view.ts`：

```ts
export interface CanvasPoint { x: number; y: number }
export interface CanvasSize { width: number; height: number }
export interface CanvasRect extends CanvasPoint, CanvasSize {}
export interface CanvasView extends CanvasPoint { scale: number }

export const MIN_CANVAS_SCALE = 0.2;
export const MAX_CANVAS_SCALE = 4;
export const DEFAULT_VIEW: CanvasView = { scale: 1, x: 0, y: 0 };

function finite(value: number) {
  return Number.isFinite(value);
}

function validSize(size: CanvasSize) {
  return finite(size.width) && finite(size.height) && size.width > 0 && size.height > 0;
}

export function clampScale(scale: number) {
  if (!finite(scale)) return 1;
  return Math.min(MAX_CANVAS_SCALE, Math.max(MIN_CANVAS_SCALE, scale));
}

export function fitView(viewport: CanvasSize, stage: CanvasSize, padding: number): CanvasView {
  if (!validSize(viewport) || !validSize(stage) || !finite(padding)) return { ...DEFAULT_VIEW };
  const availableWidth = Math.max(1, viewport.width - Math.max(0, padding) * 2);
  const availableHeight = Math.max(1, viewport.height - Math.max(0, padding) * 2);
  const scale = clampScale(Math.min(availableWidth / stage.width, availableHeight / stage.height));
  return {
    scale,
    x: (viewport.width - stage.width * scale) / 2,
    y: (viewport.height - stage.height * scale) / 2,
  };
}

export function zoomAt(view: CanvasView, requestedScale: number, anchor: CanvasPoint): CanvasView {
  if (![view.scale, view.x, view.y, requestedScale, anchor.x, anchor.y].every(finite) || view.scale <= 0) return { ...DEFAULT_VIEW };
  const scale = clampScale(requestedScale);
  const stageX = (anchor.x - view.x) / view.scale;
  const stageY = (anchor.y - view.y) / view.scale;
  return { scale, x: anchor.x - stageX * scale, y: anchor.y - stageY * scale };
}

export function keepViewportCenter(view: CanvasView, previous: CanvasSize, next: CanvasSize): CanvasView {
  if (!validSize(previous) || !validSize(next) || !finite(view.scale) || view.scale <= 0) return { ...DEFAULT_VIEW };
  const stageX = (previous.width / 2 - view.x) / view.scale;
  const stageY = (previous.height / 2 - view.y) / view.scale;
  return {
    ...view,
    x: next.width / 2 - stageX * view.scale,
    y: next.height / 2 - stageY * view.scale,
  };
}

export function revealRect(view: CanvasView, viewport: CanvasSize, target: CanvasRect, padding: number): CanvasView {
  if (!validSize(viewport) || !validSize(target) || ![view.scale, view.x, view.y, padding].every(finite) || view.scale <= 0) return view;
  const safe = Math.max(0, padding);
  const left = view.x + target.x * view.scale;
  const top = view.y + target.y * view.scale;
  const right = left + target.width * view.scale;
  const bottom = top + target.height * view.scale;
  let x = view.x;
  let y = view.y;
  if (left < safe) x += safe - left;
  else if (right > viewport.width - safe) x -= right - (viewport.width - safe);
  if (top < safe) y += safe - top;
  else if (bottom > viewport.height - safe) y -= bottom - (viewport.height - safe);
  return { ...view, x, y };
}
```

- [ ] **Step 4: 运行测试，确认纯函数通过**

```powershell
Set-Location D:/workspace/ui/apps/region-split-ui
D:/nodejs/corepack.cmd pnpm exec vitest run src/infinite-canvas-view.test.ts
```

Expected: PASS，8 tests passed。

- [ ] **Step 5: 回退验证核心锚点断言**

临时将 `zoomAt` 的 `x` 返回值改成 `view.x`，重跑：

```powershell
D:/nodejs/corepack.cmd pnpm exec vitest run src/infinite-canvas-view.test.ts -t "zooms around a viewport anchor"
```

Expected: FAIL。恢复实现后重跑并确认 PASS。

- [ ] **Step 6: 提交纯函数与测试**

```powershell
git -C D:/workspace/ui add -- apps/region-split-ui/src/infinite-canvas-view.ts apps/region-split-ui/src/infinite-canvas-view.test.ts
git -C D:/workspace/ui commit -m "feat: add infinite canvas view math"
```

---

### Task 2: 建立固定工具区、画布视口和统一三栏舞台

**Files:**
- Modify: `apps/region-split-ui/src/components/PageOutline.vue`
- Modify: `apps/region-split-ui/src/components/PageOutline.test.ts`

- [ ] **Step 1: 用统一舞台结构替换旧结构断言**

在 `PageOutline.test.ts` 删除旧测试 `renders image, tree, and independent property columns`、`fills the panel width without a fixed cap or panel inset`，添加：

```ts
  it("keeps tools outside one transformed three-column stage", () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const viewport = wrapper.get('[data-test="canvas-viewport"]');
    const stage = wrapper.get('[data-test="canvas-stage"]');
    const tools = wrapper.get('[data-test="view-controls"]');
    expect(tools.element.parentElement).not.toBe(viewport.element);
    expect(stage.element.parentElement).toBe(viewport.element);
    for (const selector of ['[data-test="image-panel"]', '[data-test="tree-panel"]', '[data-test="property-panel"]']) {
      expect(wrapper.get(selector).element.parentElement).toBe(stage.element);
    }
    expect(stage.attributes("style")).toContain("translate3d(");
    expect(stage.attributes("style")).toContain("scale(");
  });

  it("renders accessible fit and 100 percent controls", () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    expect(wrapper.get('[data-test="zoom-out"]').attributes("aria-label")).toBe("缩小画布");
    expect(wrapper.get('[data-test="zoom-level"]').text()).toMatch(/^\d+%$/);
    expect(wrapper.get('[data-test="zoom-in"]').attributes("aria-label")).toBe("放大画布");
    expect(wrapper.get('[data-test="fit-view"]').text()).toBe("适应视图");
    expect(wrapper.get('[data-test="actual-size"]').text()).toBe("100%");
  });
```

- [ ] **Step 2: 运行结构测试并确认失败**

```powershell
Set-Location D:/workspace/ui/apps/region-split-ui
D:/nodejs/corepack.cmd pnpm exec vitest run src/components/PageOutline.test.ts -t "one transformed|accessible fit"
```

Expected: FAIL，找不到 `canvas-viewport` 或 `view-controls`。

- [ ] **Step 3: 建立模板和最小视图状态**

在 `PageOutline.vue`：

1. 导入 `onBeforeUnmount`、`onMounted`，并导入纯函数与类型：

```ts
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  DEFAULT_VIEW,
  fitView,
  keepViewportCenter,
  zoomAt,
  type CanvasSize,
  type CanvasView,
} from "../infinite-canvas-view.js";
```

2. 删除旧的 `imagePanel`、`zoom`、`stageStyle`、`pendingZoomAnchor`、`zoomCorrectionScheduled`、`panFrom` 及 `onZoom/onPan*` 实现，新增：

```ts
const FIT_PADDING = 32;
const ZOOM_STEP = 0.1;
const canvasViewport = ref<HTMLElement | null>(null);
const canvasStage = ref<HTMLElement | null>(null);
const view = ref<CanvasView>({ ...DEFAULT_VIEW });
const viewportSize = ref<CanvasSize>({ width: 0, height: 0 });
const stageSize = ref<CanvasSize>({ width: 0, height: 0 });
const userChangedView = ref(false);
const zoomLabel = computed(() => `${Math.round(view.value.scale * 100)}%`);
const canvasStageStyle = computed(() => ({
  transform: `translate3d(${view.value.x}px, ${view.value.y}px, 0) scale(${view.value.scale})`,
}));

function measure(element: HTMLElement | null): CanvasSize {
  if (!element) return { width: 0, height: 0 };
  return { width: element.clientWidth, height: element.clientHeight };
}

function fitCanvas() {
  view.value = fitView(viewportSize.value, stageSize.value, FIT_PADDING);
  userChangedView.value = false;
}

function setActualSize() {
  const viewport = viewportSize.value;
  view.value = zoomAt(view.value, 1, { x: viewport.width / 2, y: viewport.height / 2 });
  userChangedView.value = true;
}

function zoomBy(step: number) {
  const viewport = viewportSize.value;
  view.value = zoomAt(view.value, view.value.scale + step, { x: viewport.width / 2, y: viewport.height / 2 });
  userChangedView.value = true;
}

let resizeObserver: ResizeObserver | null = null;
onMounted(() => {
  const viewport = canvasViewport.value;
  const stage = canvasStage.value;
  if (!viewport || !stage) return;
  viewportSize.value = measure(viewport);
  stageSize.value = measure(stage);
  fitCanvas();
  resizeObserver = new ResizeObserver(entries => {
    const previousViewport = viewportSize.value;
    for (const entry of entries) {
      if (entry.target === viewport) viewportSize.value = measure(viewport);
      if (entry.target === stage) stageSize.value = measure(stage);
    }
    if (!userChangedView.value) fitCanvas();
    else if (previousViewport.width !== viewportSize.value.width || previousViewport.height !== viewportSize.value.height) {
      view.value = keepViewportCenter(view.value, previousViewport, viewportSize.value);
    }
  });
  resizeObserver.observe(viewport);
  resizeObserver.observe(stage);
});

onBeforeUnmount(() => resizeObserver?.disconnect());
```

3. 在固定工具区域加入：

```html
<div class="view-controls" data-test="view-controls" aria-label="画布视图控制">
  <button type="button" data-test="zoom-out" aria-label="缩小画布" @click="zoomBy(-ZOOM_STEP)">−</button>
  <output data-test="zoom-level" aria-live="polite">{{ zoomLabel }}</output>
  <button type="button" data-test="zoom-in" aria-label="放大画布" @click="zoomBy(ZOOM_STEP)">+</button>
  <button type="button" data-test="fit-view" @click="fitCanvas">适应视图</button>
  <button type="button" data-test="actual-size" @click="setActualSize">100%</button>
</div>
```

4. 将原 `.outline-workspace` 外层改成画布视口，三栏放入舞台：

```html
<section
  ref="canvasViewport"
  class="canvas-viewport"
  data-test="canvas-viewport"
  @dblclick.self="fitCanvas"
>
  <div
    ref="canvasStage"
    class="outline-workspace canvas-stage"
    data-test="canvas-stage"
    :class="{ 'tree-panel-collapsed': treePanelCollapsed }"
    :style="canvasStageStyle"
  >
    <!-- 原 image-panel、tree-panel / restore、property-panel 原样放在这里 -->
  </div>
</section>
```

5. `image-panel` 不再绑定旧的 pointer/wheel 处理，只保留 `data-test`：

```html
<div class="page-scroll" data-test="image-panel">
  <div ref="pageStage" class="page-stage" data-test="page-stage">
```

- [ ] **Step 4: 将 CSS 改为稳定舞台尺寸**

用以下空间规则替换旧 `.outline-workspace`、`.page-scroll` 和响应式拆栏规则：

```css
.page-outline { height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; color: var(--text, #e5e7eb); background: #11151d; }
.migrated-tools { flex-wrap: wrap; }
.view-controls { display: flex; align-items: center; gap: 6px; }
.view-controls output { min-width: 48px; color: #cfe3ff; text-align: center; font-variant-numeric: tabular-nums; }
.canvas-viewport { position: relative; flex: 1; min-height: 0; overflow: hidden; background-color: #0c1017; background-image: radial-gradient(circle, #263244 1px, transparent 1px); background-size: 24px 24px; cursor: grab; touch-action: none; }
.canvas-viewport.is-panning { cursor: grabbing; }
.outline-workspace { position: absolute; top: 0; left: 0; width: 1200px; height: 760px; display: grid; grid-template-columns: minmax(0, 1fr) 300px 300px; transform-origin: 0 0; will-change: transform; box-shadow: 0 12px 42px #000b; }
.outline-workspace.tree-panel-collapsed { grid-template-columns: minmax(0, 1fr) 34px 300px; }
.page-scroll { min-width: 0; min-height: 0; overflow: hidden; background: #0c1017; }
.page-stage { position: relative; width: 100%; min-width: 0; margin: 0; line-height: 0; }
.page-stage > img { display: block; width: 100%; height: auto; }
.tree-panel, .property-panel { min-height: 0; }
@media (max-width: 900px) {
  .outline-workspace, .outline-workspace.tree-panel-collapsed { width: 1080px; height: 680px; }
}
@media (max-width: 640px) {
  .outline-workspace, .outline-workspace.tree-panel-collapsed { width: 960px; height: 620px; }
}
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; transition: none !important; } }
```

保留元素框、树、属性表单现有样式。删除旧的 `<=900px` 上下拆栏和 `<=640px` 纵向排列规则。

- [ ] **Step 5: 运行组件测试和类型检查**

```powershell
Set-Location D:/workspace/ui/apps/region-split-ui
D:/nodejs/corepack.cmd pnpm exec vitest run src/components/PageOutline.test.ts
D:/nodejs/corepack.cmd pnpm exec vue-tsc --noEmit -p tsconfig.json
```

Expected: 新结构测试 PASS；旧缩放/拖动测试因空间模型已删除而 FAIL。先删除或重写这些旧测试，不允许通过兼容旧滚动模型来让它们继续通过。其余业务测试必须 PASS。

- [ ] **Step 6: 提交统一舞台骨架**

```powershell
git -C D:/workspace/ui add -- apps/region-split-ui/src/components/PageOutline.vue apps/region-split-ui/src/components/PageOutline.test.ts
git -C D:/workspace/ui commit -m "feat: place outline workspace on one canvas stage"
```

---

### Task 3: 实现首次适应、视图按钮和滚轮路由

**Files:**
- Modify: `apps/region-split-ui/src/components/PageOutline.vue`
- Modify: `apps/region-split-ui/src/components/PageOutline.test.ts`

- [ ] **Step 1: 添加 ResizeObserver 测试替身**

在 `PageOutline.test.ts` 的 describe 外加入：

```ts
let resizeCallback: (() => void) | null = null;
class ResizeObserverStub {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = () => callback([], this as unknown as ResizeObserver);
  }
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

function setElementSize(element: Element, width: number, height: number) {
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: width },
    clientHeight: { configurable: true, value: height },
  });
}
```

在 `afterEach` 恢复全局替身，并在相关测试挂载前执行：

```ts
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
```

- [ ] **Step 2: 写首次适应和按钮失败测试**

```ts
  it("fits the whole stage after the first valid measurement", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const viewport = wrapper.get('[data-test="canvas-viewport"]');
    const stage = wrapper.get('[data-test="canvas-stage"]');
    setElementSize(viewport.element, 1024, 700);
    setElementSize(stage.element, 1200, 760);
    resizeCallback?.();
    await wrapper.vm.$nextTick();
    expect(stage.attributes("style")).toContain("scale(0.8)");
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("80%");
  });

  it("zooms toolbar buttons around the viewport center and restores actual size", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const viewport = wrapper.get('[data-test="canvas-viewport"]');
    const stage = wrapper.get('[data-test="canvas-stage"]');
    setElementSize(viewport.element, 1024, 700);
    setElementSize(stage.element, 1200, 760);
    resizeCallback?.();
    await wrapper.vm.$nextTick();
    await wrapper.get('[data-test="zoom-in"]').trigger("click");
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("90%");
    await wrapper.get('[data-test="actual-size"]').trigger("click");
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("100%");
    await wrapper.get('[data-test="fit-view"]').trigger("click");
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("80%");
  });
```

- [ ] **Step 3: 写滚轮路由失败测试**

```ts
  it("zooms empty canvas around the pointer", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const viewport = wrapper.get('[data-test="canvas-viewport"]');
    const event = new WheelEvent("wheel", { deltaY: -100, clientX: 300, clientY: 200, bubbles: true, cancelable: true });
    viewport.element.dispatchEvent(event);
    await wrapper.vm.$nextTick();
    expect(event.defaultPrevented).toBe(true);
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("110%");
  });

  it("leaves ordinary tree and property wheel events to their panels", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: "0-1000::ok" } });
    for (const selector of ['[data-test="outline-tree"]', '[data-test="property-panel"]']) {
      const event = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
      wrapper.get(selector).element.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("100%");
  });

  it("zooms from tree and property panels only with ctrl wheel", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: "0-1000::ok" } });
    const event = new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, clientX: 600, clientY: 300, bubbles: true, cancelable: true });
    wrapper.get('[data-test="property-panel"]').element.dispatchEvent(event);
    await wrapper.vm.$nextTick();
    expect(event.defaultPrevented).toBe(true);
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("110%");
  });

  it("clamps repeated canvas zoom to 20 and 400 percent", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const viewport = wrapper.get('[data-test="canvas-viewport"]');
    for (let index = 0; index < 50; index += 1) viewport.element.dispatchEvent(new WheelEvent("wheel", { deltaY: -1, bubbles: true, cancelable: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("400%");
    for (let index = 0; index < 100; index += 1) viewport.element.dispatchEvent(new WheelEvent("wheel", { deltaY: 1, bubbles: true, cancelable: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("20%");
  });
```

- [ ] **Step 4: 运行新增测试并确认失败**

```powershell
Set-Location D:/workspace/ui/apps/region-split-ui
D:/nodejs/corepack.cmd pnpm exec vitest run src/components/PageOutline.test.ts -t "fits the whole|toolbar buttons|empty canvas|ordinary tree|ctrl wheel|clamps repeated"
```

Expected: FAIL。首次适应断言仍保持挂载时的 `100%`，滚轮事件也不会改变统一舞台比例。

- [ ] **Step 5: 实现滚轮路由和空白双击**

在 `PageOutline.vue` 增加：

```ts
function pointInViewport(event: MouseEvent | WheelEvent) {
  const rect = canvasViewport.value?.getBoundingClientRect();
  return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
}

function isScrollablePanel(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(".outline-tree, .property-panel"));
}

function onCanvasWheel(event: WheelEvent) {
  if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return;
  if (isScrollablePanel(event.target) && !event.ctrlKey) return;
  event.preventDefault();
  const direction = event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
  view.value = zoomAt(view.value, view.value.scale + direction, pointInViewport(event));
  userChangedView.value = true;
}

function onCanvasDoubleClick(event: MouseEvent) {
  if (event.target !== canvasViewport.value) return;
  fitCanvas();
}
```

画布视口事件改为：

```html
<section
  ref="canvasViewport"
  class="canvas-viewport"
  data-test="canvas-viewport"
  @wheel="onCanvasWheel"
  @dblclick="onCanvasDoubleClick"
>
```

ResizeObserver 回调必须在收到首次有效尺寸时调用 `fitCanvas()`；用 `hasValidInitialView` 或等价布尔值保证只有首次自动适应，之后用户操作不被覆盖。图片 `load` 后调用统一测量函数；若用户尚未操作则再次适应，否则保持视图中心。

- [ ] **Step 6: 测试双击只响应真正画布空白**

追加：

```ts
  it("fits on a double click only when the viewport itself was clicked", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const viewport = wrapper.get('[data-test="canvas-viewport"]');
    await viewport.trigger("wheel", { deltaY: -100, clientX: 10, clientY: 10 });
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("110%");
    await wrapper.get('[data-test="property-panel"]').trigger("dblclick");
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("110%");
    await viewport.trigger("dblclick");
    expect(wrapper.get('[data-test="zoom-level"]').text()).not.toBe("110%");
  });
```

- [ ] **Step 7: 运行测试并回退验证**

```powershell
Set-Location D:/workspace/ui/apps/region-split-ui
D:/nodejs/corepack.cmd pnpm exec vitest run src/infinite-canvas-view.test.ts src/components/PageOutline.test.ts
D:/nodejs/corepack.cmd pnpm exec vue-tsc --noEmit -p tsconfig.json
```

临时删除 `if (isScrollablePanel(event.target) && !event.ctrlKey) return;`，确认 `ordinary tree and property wheel events` 变红，再恢复并确认全绿。

- [ ] **Step 8: 提交缩放与适应视图**

```powershell
git -C D:/workspace/ui add -- apps/region-split-ui/src/components/PageOutline.vue apps/region-split-ui/src/components/PageOutline.test.ts
git -C D:/workspace/ui commit -m "feat: fit and zoom the outline canvas"
```

---

### Task 4: 实现左键空白、中键与空格拖动画布

**Files:**
- Modify: `apps/region-split-ui/src/components/PageOutline.vue`
- Modify: `apps/region-split-ui/src/components/PageOutline.test.ts`

- [ ] **Step 1: 写平移手势失败测试**

```ts
  it("pans from empty canvas with the left pointer and captures it", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const viewport = wrapper.get('[data-test="canvas-viewport"]');
    const capture = vi.spyOn(viewport.element as HTMLElement, "setPointerCapture").mockImplementation(() => undefined);
    await viewport.trigger("pointerdown", { button: 0, pointerId: 7, clientX: 100, clientY: 100 });
    await viewport.trigger("pointermove", { pointerId: 7, clientX: 140, clientY: 130 });
    expect(capture).toHaveBeenCalledWith(7);
    expect(wrapper.get('[data-test="canvas-stage"]').attributes("style")).toContain("translate3d(40px, 30px, 0)");
  });

  it("does not left-pan from a tree node or form control", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: "0-1000::ok" } });
    const viewport = wrapper.get('[data-test="canvas-viewport"]');
    const before = wrapper.get('[data-test="canvas-stage"]').attributes("style");
    for (const selector of [".tree-item-content", '[data-test="calibration-text"]', ".element-box"]) {
      await wrapper.get(selector).trigger("pointerdown", { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
      await viewport.trigger("pointermove", { pointerId: 1, clientX: 160, clientY: 160 });
      await viewport.trigger("pointerup", { pointerId: 1 });
    }
    expect(wrapper.get('[data-test="canvas-stage"]').attributes("style")).toBe(before);
  });

  it("pans from any panel with the middle pointer", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: "0-1000::ok" } });
    const viewport = wrapper.get('[data-test="canvas-viewport"]');
    await wrapper.get('[data-test="calibration-text"]').trigger("pointerdown", { button: 1, pointerId: 3, clientX: 100, clientY: 100 });
    await viewport.trigger("pointermove", { pointerId: 3, clientX: 150, clientY: 140 });
    expect(wrapper.get('[data-test="canvas-stage"]').attributes("style")).toContain("translate3d(50px, 40px, 0)");
  });

  it("pans from any panel with space plus the left pointer", async () => {
    const wrapper = mount(PageOutline, { attachTo: document.body, props: { projectId: "p1", outline, selectedId: null } });
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));
    await wrapper.get(".tree-item-content").trigger("pointerdown", { button: 0, pointerId: 4, clientX: 100, clientY: 100 });
    await wrapper.get('[data-test="canvas-viewport"]').trigger("pointermove", { pointerId: 4, clientX: 125, clientY: 135 });
    expect(wrapper.get('[data-test="canvas-stage"]').attributes("style")).toContain("translate3d(25px, 35px, 0)");
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", bubbles: true }));
    wrapper.unmount();
  });

  it("does not enter space-pan while an editable control has focus", async () => {
    const wrapper = mount(PageOutline, { attachTo: document.body, props: { projectId: "p1", outline, selectedId: "0-1000::ok" } });
    const input = wrapper.get('[data-test="calibration-text"]');
    (input.element as HTMLInputElement).focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));
    await input.trigger("pointerdown", { button: 0, pointerId: 5, clientX: 100, clientY: 100 });
    await wrapper.get('[data-test="canvas-viewport"]').trigger("pointermove", { pointerId: 5, clientX: 150, clientY: 150 });
    expect(wrapper.get('[data-test="canvas-stage"]').attributes("style")).toContain("translate3d(0px, 0px, 0)");
    wrapper.unmount();
  });
```

测试环境若 `HTMLElement.prototype.setPointerCapture/releasePointerCapture` 不存在，在 `beforeEach` 中用可配置空函数补齐，在 `afterEach` 恢复。

- [ ] **Step 2: 写拖动阈值、误点击和取消失败测试**

```ts
  it("suppresses the click after a real pan but keeps a click below the threshold", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const viewport = wrapper.get('[data-test="canvas-viewport"]');
    await viewport.trigger("pointerdown", { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    await viewport.trigger("pointermove", { pointerId: 1, clientX: 12, clientY: 12 });
    await viewport.trigger("pointerup", { pointerId: 1 });
    await wrapper.get(".element-box").trigger("click");
    expect(wrapper.emitted("select")).toHaveLength(1);

    await viewport.trigger("pointerdown", { button: 0, pointerId: 2, clientX: 10, clientY: 10 });
    await viewport.trigger("pointermove", { pointerId: 2, clientX: 40, clientY: 40 });
    await viewport.trigger("pointerup", { pointerId: 2 });
    await wrapper.get(".element-box").trigger("click");
    expect(wrapper.emitted("select")).toHaveLength(1);
  });

  it("clears pan state on pointer cancel", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const viewport = wrapper.get('[data-test="canvas-viewport"]');
    await viewport.trigger("pointerdown", { button: 0, pointerId: 9, clientX: 10, clientY: 10 });
    await viewport.trigger("pointercancel", { pointerId: 9 });
    const before = wrapper.get('[data-test="canvas-stage"]').attributes("style");
    await viewport.trigger("pointermove", { pointerId: 9, clientX: 80, clientY: 80 });
    expect(wrapper.get('[data-test="canvas-stage"]').attributes("style")).toBe(before);
  });
```

- [ ] **Step 3: 运行新增测试并确认失败**

```powershell
Set-Location D:/workspace/ui/apps/region-split-ui
D:/nodejs/corepack.cmd pnpm exec vitest run src/components/PageOutline.test.ts -t "pans from|does not left-pan|space-pan|suppresses|pointer cancel"
```

Expected: FAIL，舞台平移不变或没有指针捕获。

- [ ] **Step 4: 实现统一平移状态机**

在 `PageOutline.vue` 增加：

```ts
const DRAG_THRESHOLD = 4;
const spacePressed = ref(false);
const isPanning = ref(false);
let panFrom: { pointerId: number; x: number; y: number; viewX: number; viewY: number; moved: boolean } | null = null;
let suppressClick = false;

function isEditable(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, button, [contenteditable='true']"));
}

function isDirectPanSurface(target: EventTarget | null) {
  return target === canvasViewport.value || target instanceof Element && Boolean(target.closest(".page-scroll") && !target.closest(".element-box"));
}

function onKeyDown(event: KeyboardEvent) {
  if (event.code !== "Space" || event.repeat || isEditable(document.activeElement)) return;
  spacePressed.value = true;
  event.preventDefault();
}

function onKeyUp(event: KeyboardEvent) {
  if (event.code === "Space") spacePressed.value = false;
}

function onPanStart(event: PointerEvent) {
  const viewport = canvasViewport.value;
  if (!viewport) return;
  const leftAllowed = event.button === 0 && (spacePressed.value || isDirectPanSurface(event.target));
  const middleAllowed = event.button === 1;
  if (!leftAllowed && !middleAllowed) return;
  event.preventDefault();
  viewport.setPointerCapture(event.pointerId);
  panFrom = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, viewX: view.value.x, viewY: view.value.y, moved: false };
}

function onPanMove(event: PointerEvent) {
  if (!panFrom || panFrom.pointerId !== event.pointerId) return;
  const dx = event.clientX - panFrom.x;
  const dy = event.clientY - panFrom.y;
  if (!panFrom.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
  panFrom.moved = true;
  isPanning.value = true;
  userChangedView.value = true;
  view.value = { ...view.value, x: panFrom.viewX + dx, y: panFrom.viewY + dy };
}

function endPan(event?: PointerEvent) {
  if (!panFrom || event && panFrom.pointerId !== event.pointerId) return;
  suppressClick = panFrom.moved;
  const viewport = canvasViewport.value;
  if (event && viewport?.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
  panFrom = null;
  isPanning.value = false;
}

function onPanClick(event: MouseEvent) {
  if (!suppressClick) return;
  suppressClick = false;
  event.preventDefault();
  event.stopPropagation();
}

function onWindowBlur() {
  spacePressed.value = false;
  endPan();
}
```

在 mounted/unmount 生命周期中注册和清理：

```ts
window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);
window.addEventListener("blur", onWindowBlur);

window.removeEventListener("keydown", onKeyDown);
window.removeEventListener("keyup", onKeyUp);
window.removeEventListener("blur", onWindowBlur);
endPan();
```

画布视口增加：

```html
:class="{ 'is-panning': isPanning, 'space-pan-ready': spacePressed }"
@pointerdown="onPanStart"
@pointermove="onPanMove"
@pointerup="endPan"
@pointercancel="endPan"
@click.capture="onPanClick"
@auxclick.prevent
```

不要使用 `pointerleave` 结束拖动；指针捕获的目的就是允许移出后继续拖动。

- [ ] **Step 5: 运行平移测试和业务回归**

```powershell
Set-Location D:/workspace/ui/apps/region-split-ui
D:/nodejs/corepack.cmd pnpm exec vitest run src/components/PageOutline.test.ts
D:/nodejs/corepack.cmd pnpm exec vue-tsc --noEmit -p tsconfig.json
```

Expected: 全部 PASS；普通树节点、元素框、按钮、表单测试仍通过。

- [ ] **Step 6: 回退验证交互边界**

临时让 `leftAllowed` 忽略 `isDirectPanSurface`，允许任意左键起拖，运行：

```powershell
D:/nodejs/corepack.cmd pnpm exec vitest run src/components/PageOutline.test.ts -t "does not left-pan from a tree node or form control"
```

Expected: FAIL。恢复后确认 PASS。

- [ ] **Step 7: 提交平移交互**

```powershell
git -C D:/workspace/ui add -- apps/region-split-ui/src/components/PageOutline.vue apps/region-split-ui/src/components/PageOutline.test.ts
git -C D:/workspace/ui commit -m "feat: pan the outline canvas with pointer gestures"
```

---

### Task 5: 保持视图中心并让树选择的元素进入画布视口

**Files:**
- Modify: `apps/region-split-ui/src/components/PageOutline.vue`
- Modify: `apps/region-split-ui/src/components/PageOutline.test.ts`

- [ ] **Step 1: 写结构栏尺寸变化保持中心的失败测试**

```ts
  it("keeps the viewport center stable when the tree panel changes stage width", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: "0-1000::bad" } });
    const viewport = wrapper.get('[data-test="canvas-viewport"]');
    const stage = wrapper.get('[data-test="canvas-stage"]');
    setElementSize(viewport.element, 1000, 700);
    setElementSize(stage.element, 1200, 760);
    resizeCallback?.();
    await wrapper.vm.$nextTick();
    await wrapper.get('[data-test="zoom-in"]').trigger("click");
    const before = stage.attributes("style");
    await wrapper.get('[data-test="collapse-tree-panel"]').trigger("click");
    setElementSize(stage.element, 934, 760);
    resizeCallback?.();
    await wrapper.vm.$nextTick();
    expect(stage.attributes("style")).not.toBe(before);
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("90%");
  });
```

实现时不能只断言 style 改变；额外解析 `translate3d` 数值，按 `keepViewportCenter` 的输入验证视口中心对应舞台点未变化。

- [ ] **Step 2: 写树选择后只平移舞台的失败测试**

```ts
  it("reveals the selected image box by panning the canvas without changing zoom", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const viewport = wrapper.get('[data-test="canvas-viewport"]');
    const box = wrapper.findAll(".element-box")[1]!;
    setElementSize(viewport.element, 600, 400);
    vi.spyOn(box.element, "getBoundingClientRect").mockReturnValue({
      x: 800, y: 600, left: 800, top: 600, right: 860, bottom: 660,
      width: 60, height: 60, toJSON: () => ({}),
    });
    const zoom = wrapper.get('[data-test="zoom-level"]').text();
    await wrapper.findAll(".tree-item-content")[1]!.trigger("click");
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-test="zoom-level"]').text()).toBe(zoom);
    expect(wrapper.get('[data-test="canvas-stage"]').attributes("style")).not.toContain("translate3d(0px, 0px, 0)");
  });

  it("still scrolls the tree panel when an image box expands hidden ancestors", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    await wrapper.get('[data-test="tree-toggle-0-1000::ok"]').trigger("click");
    const scrollIntoView = spyOnScrollIntoView();
    await wrapper.findAll(".element-box")[1]!.trigger("click");
    expect(wrapper.emitted("select")?.at(-1)).toEqual(["0-1000::bad"]);
    expect(wrapper.findAll(".tree-item")).toHaveLength(2);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });
```

- [ ] **Step 3: 运行测试并确认失败**

```powershell
Set-Location D:/workspace/ui/apps/region-split-ui
D:/nodejs/corepack.cmd pnpm exec vitest run src/components/PageOutline.test.ts -t "viewport center stable|reveals the selected|still scrolls the tree"
```

Expected: 树选择仍调用旧 `scrollIntoView`，无法通过舞台平移定位；中心保持断言失败。

- [ ] **Step 4: 实现舞台中心保持和元素可见性**

在 ResizeObserver 中同时记录舞台尺寸变化。规则：

- 用户未操作过视图：重新适应。
- 用户已操作：视口变化使用 `keepViewportCenter`。
- 舞台宽高变化：根据变化前后舞台中心相对当前视图的位置，校正 `x/y`，保持视觉中心；不得改变 `scale`。

新增元素定位：

```ts
import { revealRect } from "../infinite-canvas-view.js";

function revealBox(id: string) {
  const viewport = canvasViewport.value;
  const stage = canvasStage.value;
  const target = boxRefs.get(id);
  if (!viewport || !stage || !target) return;
  const stageRect = stage.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const scale = view.value.scale;
  if (!Number.isFinite(scale) || scale <= 0) return;
  view.value = revealRect(
    view.value,
    viewportSize.value,
    {
      x: (targetRect.left - stageRect.left) / scale,
      y: (targetRect.top - stageRect.top) / scale,
      width: targetRect.width / scale,
      height: targetRect.height / scale,
    },
    24,
  );
}
```

修改 `select`：

```ts
function select(id: string, source: "tree" | "box") {
  if (source === "box") expandAncestors(id);
  emit("select", id);
  nextTick(() => {
    if (source === "tree") revealBox(id);
    else {
      const target = treeRefs.get(id);
      if (typeof target?.scrollIntoView === "function") target.scrollIntoView({ block: "center" });
    }
  });
}
```

不得对元素框调用 `scrollIntoView`，否则浏览器会绕过视图模型移动祖先滚动容器。

- [ ] **Step 5: 保持结构栏恢复行为**

`restoreTreePanel()` 继续展开祖先并滚动树行，但舞台尺寸变化交给 ResizeObserver 保持中心。添加断言：恢复后选择仍存在、树行可见、舞台比例不变。

- [ ] **Step 6: 运行完整组件测试、纯函数测试和类型检查**

```powershell
Set-Location D:/workspace/ui/apps/region-split-ui
D:/nodejs/corepack.cmd pnpm exec vitest run src/infinite-canvas-view.test.ts src/components/PageOutline.test.ts
D:/nodejs/corepack.cmd pnpm exec vue-tsc --noEmit -p tsconfig.json
```

Expected: 全部 PASS。

- [ ] **Step 7: 回退验证舞台定位**

临时将 `revealBox(id)` 替换为无操作，运行：

```powershell
D:/nodejs/corepack.cmd pnpm exec vitest run src/components/PageOutline.test.ts -t "reveals the selected image box"
```

Expected: FAIL。恢复后确认 PASS。

- [ ] **Step 8: 提交定位与中心保持**

```powershell
git -C D:/workspace/ui add -- apps/region-split-ui/src/components/PageOutline.vue apps/region-split-ui/src/components/PageOutline.test.ts
git -C D:/workspace/ui commit -m "feat: preserve and restore outline canvas view"
```

---

### Task 6: 完整工程验证和真实浏览器验收

**Files:**
- Create: `docs/superpowers/reports/2026-08-24-page-outline-infinite-canvas.md`
- Modify only if verification exposes a defect:
  - `apps/region-split-ui/src/components/PageOutline.vue`
  - `apps/region-split-ui/src/components/PageOutline.test.ts`
  - `apps/region-split-ui/src/infinite-canvas-view.ts`
  - `apps/region-split-ui/src/infinite-canvas-view.test.ts`

- [ ] **Step 1: 运行完整前端验证**

```powershell
Set-Location D:/workspace/ui/apps/region-split-ui
D:/nodejs/corepack.cmd pnpm test
D:/nodejs/corepack.cmd pnpm exec vue-tsc --noEmit -p tsconfig.json
D:/nodejs/corepack.cmd pnpm build
```

Expected:

- Vitest 全绿。
- `vue-tsc` 退出码 0，无错误。
- Vite production build 成功。

- [ ] **Step 2: 检查改动范围和静态问题**

```powershell
git -C D:/workspace/ui diff --check
git -C D:/workspace/ui status --short
git -C D:/workspace/ui diff -- apps/region-split-ui/src/infinite-canvas-view.ts apps/region-split-ui/src/infinite-canvas-view.test.ts apps/region-split-ui/src/components/PageOutline.vue apps/region-split-ui/src/components/PageOutline.test.ts
```

确认：

- `.npmrc` 未被本任务改动或暂存。
- 没有后端、DTO、锁文件和依赖变化。
- 没有临时脚本、截图或调试日志进入提交。

- [ ] **Step 3: 启动现有 API 与前端**

先检查端口；若 API `4800` 和前端端口已有当前工作区进程则复用，否则启动：

```powershell
Set-Location D:/workspace/ui/packages/region-split
D:/nodejs/corepack.cmd pnpm dev
```

```powershell
Set-Location D:/workspace/ui/apps/region-split-ui
D:/nodejs/corepack.cmd pnpm dev -- --host 127.0.0.1 --port 5180
```

日志只写入现有 `D:/workspace/ui/.logs`，不纳入 Git。

- [ ] **Step 4: 用真实 Chrome 逐项验收**

在已有项目整页轮廓页逐项验证：

1. 顶部标题、统计、迁移工具和视图控制固定。
2. 下方完整原图、结构树、属性栏一起缩放和平移。
3. 首次进入完整三栏居中适应视口。
4. 窄屏仍保持三栏整体舞台，不拆成上下布局。
5. 画布空白普通滚轮围绕指针缩放，连续触控板滚轮无明显漂移。
6. 树和属性栏普通滚轮只滚动面板；`Ctrl + 滚轮` 缩放舞台。
7. 画布空白左键拖动；面板任意位置中键拖动；空格加左键拖动。
8. 指针移出视口后仍持续拖动，释放后不黏滞。
9. 元素框普通点击、树节点点击、箭头折叠、输入、选择、保存和文字选择均不被错误接管。
10. 输入框聚焦时输入空格不会触发平移。
11. `适应视图`、空白双击和 `100%` 行为符合设计。
12. 中栏收起或恢复时比例不变、视觉中心稳定、属性栏仍存在。
13. 树选择视口外元素后，舞台只做必要平移且比例不变。
14. 从图片选择折叠分支后代时，树自动展开并定位。
15. 开启系统“减少动态效果”后无视图过渡。
16. 浏览器控制台无错误和未处理 Promise rejection。

- [ ] **Step 5: 对验收缺陷执行小循环 TDD**

如发现缺陷：

1. 在对应测试文件写能复现的失败测试。
2. 单独运行并确认失败。
3. 做最小修复。
4. 单独测试转绿。
5. 重新执行 Step 1 全套验证。

不得只凭手工走查修改，也不得把失败项写成“已知问题”后声称完成。

- [ ] **Step 6: 编写验证报告**

创建 `docs/superpowers/reports/2026-08-24-page-outline-infinite-canvas.md`，必须包含：

```md
# 整页轮廓无限画布实施报告

## 改动摘要
- 视图数学：...
- 统一舞台：...
- 缩放路由：...
- 平移手势：...
- 定位与中心保持：...

## TDD 证据
- Task 1：失败原因 / 通过结果 / 回退验证结果
- Task 2：...

## 自动验证
- 前端测试：命令、测试文件数、测试数、结果
- TypeScript：命令、结果
- Build：命令、结果
- 静态诊断：结果

## 浏览器验收
- 按计划 16 项逐项记录 PASS/FAIL 与观察结果

## 偏差
- 无；或列出与设计不同之处、原因和影响
```

报告中的数字必须来自本次实际命令输出，不得沿用历史报告。

- [ ] **Step 7: 提交报告与验收修复**

若有验收修复，先提交代码：

```powershell
git -C D:/workspace/ui add -- apps/region-split-ui/src/infinite-canvas-view.ts apps/region-split-ui/src/infinite-canvas-view.test.ts apps/region-split-ui/src/components/PageOutline.vue apps/region-split-ui/src/components/PageOutline.test.ts
git -C D:/workspace/ui commit -m "fix: close infinite canvas interaction gaps"
```

再提交报告：

```powershell
git -C D:/workspace/ui add -- docs/superpowers/reports/2026-08-24-page-outline-infinite-canvas.md
git -C D:/workspace/ui commit -m "docs: report infinite canvas verification"
```

- [ ] **Step 8: 最终证据检查并推送当前分支**

```powershell
git -C D:/workspace/ui status --short --branch
git -C D:/workspace/ui log -6 --oneline
git -C D:/workspace/ui push origin dev
```

只在本次全套验证输出可见且成功后声明完成。推送失败时保留本地提交并准确报告网络或权限错误。

---

## 完成标准

- 顶部工具区固定，完整三栏工作台由同一个 `translate3d + scale` 舞台控制。
- 首次进入自动适应视图，`适应视图`、双击空白和 `100%` 可可靠恢复视图。
- 缩放范围为 `20%–400%`，画布空白滚轮和面板内 `Ctrl + 滚轮` 均按指针锚点缩放。
- 树与属性栏普通滚轮只滚动自身。
- 空白左键、中键和空格加左键平移符合交互边界，并使用指针捕获。
- 元素、树、输入框、按钮和属性保存无回归。
- 中栏收起、恢复和窗口尺寸变化保持视觉中心，不擅自重置用户比例。
- 树选择视口外元素时只平移舞台使其可见，不改变缩放。
- 无后端、DTO、依赖、锁文件或 `.npmrc` 变更。
- 前端测试、TypeScript、构建、静态检查和真实 Chrome 16 项验收全部通过。
