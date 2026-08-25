# 整页轮廓属性栏右边缘调宽实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为整页轮廓属性栏最右边缘增加独立调宽能力，使舞台总宽随属性栏宽度增减，同时保持左侧两栏和无限画布视图稳定。

**Architecture:** 将现有 `PanelBoundary`扩展为 `property-edge`，由纯布局模型区分“内部边界重新分配相邻栏宽”和“外边缘只调整属性栏宽”两种语义。`PageOutline.vue`在属性栏内侧覆盖一个不占 Grid 列的右边缘拖动柄，复用现有 pointer capture、缩放换算和清理流程。

**Tech Stack:** Vue 3 Composition API、TypeScript、CSS Grid、Pointer Events、Vitest、Vue Test Utils、jsdom、Chromium。

---

## 文件结构

- Modify: `apps/region-split-ui/src/panel-layout.ts` — 增加属性栏外边缘宽度计算。
- Modify: `apps/region-split-ui/src/panel-layout.test.ts` — 覆盖外边缘调整、最小宽度和舞台总宽变化。
- Modify: `apps/region-split-ui/src/components/PageOutline.vue` — 增加覆盖式右边缘拖动柄并复用现有调宽会话。
- Modify: `apps/region-split-ui/src/components/PageOutline.test.ts` — 覆盖展开/收起、缩放换算、事件隔离和无双击复位。

所有 pnpm 命令从 `D:/workspace/ui`执行，并显式使用项目内缓存：

```powershell
$env:COREPACK_HOME='D:/workspace/ui/.corepack/v1'
$env:pnpm_config_store_dir='D:/workspace/ui/.pnpm-store'
corepack pnpm ...
```

### Task 1: 扩展属性栏外边缘纯计算模型

**Files:**
- Modify: `apps/region-split-ui/src/panel-layout.ts:1-87`
- Modify: `apps/region-split-ui/src/panel-layout.test.ts:1-79`

- [ ] **Step 1: 编写属性栏外边缘调整的失败测试**

在 `panel-layout.test.ts`现有 `panel layout`测试组中加入：

```ts
it("resizes only the property panel from its outer edge", () => {
  const beforeExpanded = expandedWorkspaceWidth(DEFAULT_PANEL_WIDTHS);
  const beforeCollapsed = collapsedWorkspaceWidth(DEFAULT_PANEL_WIDTHS);

  const wider = resizePanelBoundary(DEFAULT_PANEL_WIDTHS, "property-edge", 80);
  expect(wider).toEqual({ image: 594, tree: 297, property: 377 });
  expect(expandedWorkspaceWidth(wider)).toBe(beforeExpanded + 80);
  expect(collapsedWorkspaceWidth(wider)).toBe(beforeCollapsed + 80);

  const narrower = resizePanelBoundary(wider, "property-edge", -40);
  expect(narrower).toEqual({ image: 594, tree: 297, property: 337 });
});

it("clamps the property outer edge and ignores non-finite deltas", () => {
  expect(resizePanelBoundary(DEFAULT_PANEL_WIDTHS, "property-edge", -999)).toEqual({
    image: 594,
    tree: 297,
    property: MIN_PANEL_WIDTHS.property,
  });
  expect(resizePanelBoundary(DEFAULT_PANEL_WIDTHS, "property-edge", Number.NaN))
    .toEqual(DEFAULT_PANEL_WIDTHS);
  expect(resizePanelBoundary(DEFAULT_PANEL_WIDTHS, "property-edge", Number.POSITIVE_INFINITY))
    .toEqual(DEFAULT_PANEL_WIDTHS);
});
```

同时保留内部两条边界“展开态舞台总宽不变”的原有测试，明确两类边界行为不同。

- [ ] **Step 2: 运行纯函数测试并确认类型或断言失败**

Run:

```powershell
$env:COREPACK_HOME='D:/workspace/ui/.corepack/v1'; $env:pnpm_config_store_dir='D:/workspace/ui/.pnpm-store'; corepack pnpm --filter @region-split/ui test -- src/panel-layout.test.ts
```

Expected: FAIL，`property-edge`不能赋给 `PanelBoundary`，或当前实现将其误当作 `tree-property`。

- [ ] **Step 3: 为外边缘增加独立计算分支**

在 `panel-layout.ts`修改边界类型：

```ts
export type PanelBoundary = "image-tree" | "tree-property" | "property-edge";
```

在 `resizePanelBoundary()`完成输入校验后、内部两栏计算前加入：

```ts
if (boundary === "property-edge") {
  return {
    image: widths.image,
    tree: widths.tree,
    property: Math.max(MIN_PANEL_WIDTHS.property, widths.property + delta),
  };
}
```

将 `resetPanelBoundary()`参数限制为仅内部可复位边界，避免误将外边缘传入双击逻辑：

```ts
export type ResettablePanelBoundary = Exclude<PanelBoundary, "property-edge">;

export function resetPanelBoundary(
  widths: PanelWidths,
  boundary: ResettablePanelBoundary,
): PanelWidths {
  // 保留现有函数体
}
```

- [ ] **Step 4: 运行纯函数测试并确认全部通过**

Run:

```powershell
$env:COREPACK_HOME='D:/workspace/ui/.corepack/v1'; $env:pnpm_config_store_dir='D:/workspace/ui/.pnpm-store'; corepack pnpm --filter @region-split/ui test -- src/panel-layout.test.ts
```

Expected: `panel-layout.test.ts`全部 PASS；现有内部边界总宽、复位和非法输入测试无回归。

- [ ] **Step 5: 提交布局模型**

```powershell
git add apps/region-split-ui/src/panel-layout.ts apps/region-split-ui/src/panel-layout.test.ts
git commit -m "feat: resize outline property outer edge"
```

### Task 2: 增加覆盖式属性栏右边缘拖动柄

**Files:**
- Modify: `apps/region-split-ui/src/components/PageOutline.vue:1-570`
- Modify: `apps/region-split-ui/src/components/PageOutline.test.ts:275-420,545-640`

- [ ] **Step 1: 编写展开态右边缘调宽的失败测试**

在 `PageOutline.test.ts`现有分隔线测试附近加入：

```ts
it("resizes only the property panel from the workspace right edge", async () => {
  const wrapper = mount(PageOutline, {
    props: { projectId: "p1", outline, selectedId: null },
  });
  const stage = wrapper.get('[data-test="canvas-stage"]');
  const edge = wrapper.get('[data-test="property-edge-resizer"]');
  const capture = mockPointerCapture(edge.element);
  const beforeTransform = stage.attributes("style")?.match(/transform:[^;]+/)?.[0];

  await edge.trigger("pointerdown", { button: 0, pointerId: 61, clientX: 1200 });
  await edge.trigger("pointermove", { pointerId: 61, clientX: 1280 });
  await edge.trigger("pointerup", { pointerId: 61, clientX: 1280 });

  expect(capture.setPointerCapture).toHaveBeenCalledWith(61);
  expect(capture.releasePointerCapture).toHaveBeenCalledWith(61);
  expect(stage.attributes("style")).toContain("width: 1280px");
  expect(stage.attributes("style")).toContain("594px 6px 297px 6px 377px");
  expect(stage.attributes("style")?.match(/transform:[^;]+/)?.[0]).toBe(beforeTransform);
});

it("clamps the property edge at its minimum width", async () => {
  const wrapper = mount(PageOutline, {
    props: { projectId: "p1", outline, selectedId: null },
  });
  const edge = wrapper.get('[data-test="property-edge-resizer"]');
  mockPointerCapture(edge.element);
  await edge.trigger("pointerdown", { button: 0, pointerId: 62, clientX: 1200 });
  await edge.trigger("pointermove", { pointerId: 62, clientX: 0 });
  await edge.trigger("pointerup", { pointerId: 62, clientX: 0 });

  const style = wrapper.get('[data-test="canvas-stage"]').attributes("style") ?? "";
  expect(style).toContain("594px 6px 297px 6px 220px");
  expect(style).toContain("width: 1123px");
});
```

默认展开宽度为 `1200px`；属性栏从 `297px`增至 `377px`后总宽为 `1280px`；缩至 `220px`后总宽为 `1123px`。

- [ ] **Step 2: 编写缩放换算与收起态失败测试**

继续加入：

```ts
it("converts property edge movement at the current canvas scale", async () => {
  const wrapper = mount(PageOutline, {
    props: { projectId: "p1", outline, selectedId: null },
  });
  await wrapper.get('[data-test="actual-size"]').trigger("click");
  await wrapper.get('[data-test="zoom-in"]').trigger("click");
  expect(wrapper.get('[data-test="zoom-level"]').text()).toBe("110%");

  const edge = wrapper.get('[data-test="property-edge-resizer"]');
  mockPointerCapture(edge.element);
  await edge.trigger("pointerdown", { button: 0, pointerId: 63, clientX: 1200 });
  await edge.trigger("pointermove", { pointerId: 63, clientX: 1288 });
  await edge.trigger("pointerup", { pointerId: 63, clientX: 1288 });

  expect(wrapper.get('[data-test="canvas-stage"]').attributes("style"))
    .toContain("594px 6px 297px 6px 377px");
});

it("keeps the property edge resizer available while the tree is collapsed", async () => {
  const wrapper = mount(PageOutline, {
    props: { projectId: "p1", outline, selectedId: null },
  });
  await wrapper.get('[data-test="collapse-tree-panel"]').trigger("click");
  const edge = wrapper.get('[data-test="property-edge-resizer"]');
  mockPointerCapture(edge.element);
  await edge.trigger("pointerdown", { button: 0, pointerId: 64, clientX: 925 });
  await edge.trigger("pointermove", { pointerId: 64, clientX: 985 });
  await edge.trigger("pointerup", { pointerId: 64, clientX: 985 });

  const style = wrapper.get('[data-test="canvas-stage"]').attributes("style") ?? "";
  expect(style).toContain("594px 34px 357px");
  expect(style).toContain("width: 985px");
});
```

- [ ] **Step 3: 运行组件测试并确认拖动柄不存在**

Run:

```powershell
$env:COREPACK_HOME='D:/workspace/ui/.corepack/v1'; $env:pnpm_config_store_dir='D:/workspace/ui/.pnpm-store'; corepack pnpm --filter @region-split/ui test -- src/components/PageOutline.test.ts
```

Expected: FAIL，找不到 `property-edge-resizer`。

- [ ] **Step 4: 在属性栏内增加覆盖式拖动柄**

在 `PageOutline.vue`属性栏开始标签中增加 `property-panel`定位上下文，并在 `<aside>`内部最前面加入：

```vue
<div
  class="property-edge-resizer"
  data-test="property-edge-resizer"
  role="separator"
  aria-label="调整属性栏宽度"
  aria-orientation="vertical"
  @pointerdown="onResizeStart('property-edge', $event)"
  @pointermove="onResizeMove"
  @pointerup="endResize"
  @pointercancel="endResize"
  @lostpointercapture="endResize"
/>
```

不要绑定 `@dblclick`。现有 `resizeFrom.boundary`已使用 `PanelBoundary`，`onResizeMove()`已执行：

```ts
const scale = Number.isFinite(view.value.scale) && view.value.scale > 0
  ? view.value.scale
  : 1;
panelWidths.value = resizePanelBoundary(
  resizeFrom.widths,
  resizeFrom.boundary,
  (event.clientX - resizeFrom.x) / scale,
);
```

因此组件逻辑无需新增独立 pointer 会话。

- [ ] **Step 5: 增加覆盖式边缘样式**

确认 `.property-panel`包含 `position: relative`：

```css
.property-panel {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  border-left: 1px solid #2a3342;
  background: #151a23;
}
```

增加：

```css
.property-edge-resizer {
  position: absolute;
  z-index: 3;
  top: 0;
  right: 0;
  bottom: 0;
  width: 8px;
  cursor: col-resize;
  touch-action: none;
  user-select: none;
}
.property-edge-resizer::after {
  content: "";
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 2px;
  background: transparent;
}
.property-edge-resizer:hover::after,
.property-edge-resizer:focus-visible::after {
  background: #3b82f6;
}
```

命中区全部位于属性栏内部，避免被 `.outline-workspace { overflow: hidden; }`裁剪。

- [ ] **Step 6: 运行纯函数和组件测试**

Run:

```powershell
$env:COREPACK_HOME='D:/workspace/ui/.corepack/v1'; $env:pnpm_config_store_dir='D:/workspace/ui/.pnpm-store'; corepack pnpm --filter @region-split/ui test -- src/panel-layout.test.ts src/components/PageOutline.test.ts
```

Expected: 全部 PASS；现有两条内部分隔线、收起恢复、滚轮路由和元素定位测试无回归。

- [ ] **Step 7: 提交右边缘拖动柄**

```powershell
git add apps/region-split-ui/src/components/PageOutline.vue apps/region-split-ui/src/components/PageOutline.test.ts
git commit -m "feat: resize outline property panel from edge"
```

### Task 3: 补齐事件隔离和无双击复位行为

**Files:**
- Modify: `apps/region-split-ui/src/components/PageOutline.test.ts:300-430`
- Modify if needed: `apps/region-split-ui/src/components/PageOutline.vue:294-329,518-545`

- [ ] **Step 1: 编写事件隔离和无双击复位测试**

在右边缘组件测试后加入：

```ts
it("isolates property edge pointer events and does not reset on double click", async () => {
  const wrapper = mount(PageOutline, {
    props: { projectId: "p1", outline, selectedId: null },
  });
  const stage = wrapper.get('[data-test="canvas-stage"]');
  const edge = wrapper.get('[data-test="property-edge-resizer"]');
  mockPointerCapture(edge.element);
  const beforeTransform = stage.attributes("style")?.match(/transform:[^;]+/)?.[0];

  const middleDown = new MouseEvent("pointerdown", {
    button: 1,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(middleDown, "pointerId", { value: 71 });
  edge.element.dispatchEvent(middleDown);
  expect(middleDown.defaultPrevented).toBe(true);

  await edge.trigger("pointerdown", { button: 0, pointerId: 72, clientX: 1200 });
  await edge.trigger("pointermove", { pointerId: 72, clientX: 1260 });
  await edge.trigger("pointerup", { pointerId: 72, clientX: 1260 });
  const resized = stage.attributes("style") ?? "";
  expect(resized).toContain("357px");
  expect(resized.match(/transform:[^;]+/)?.[0]).toBe(beforeTransform);

  await edge.trigger("dblclick");
  expect(stage.attributes("style")).toBe(resized);
});
```

- [ ] **Step 2: 编写取消和窗口失焦清理测试**

```ts
it("stops property edge resizing after cancel and window blur", async () => {
  const wrapper = mount(PageOutline, {
    props: { projectId: "p1", outline, selectedId: null },
  });
  const edge = wrapper.get('[data-test="property-edge-resizer"]');
  mockPointerCapture(edge.element);

  await edge.trigger("pointerdown", { button: 0, pointerId: 73, clientX: 1200 });
  await edge.trigger("pointermove", { pointerId: 73, clientX: 1240 });
  await edge.trigger("pointercancel", { pointerId: 73 });
  const afterCancel = wrapper.get('[data-test="canvas-stage"]').attributes("style");
  await edge.trigger("pointermove", { pointerId: 73, clientX: 1280 });
  expect(wrapper.get('[data-test="canvas-stage"]').attributes("style")).toBe(afterCancel);

  await edge.trigger("pointerdown", { button: 0, pointerId: 74, clientX: 1240 });
  window.dispatchEvent(new Event("blur"));
  await edge.trigger("pointermove", { pointerId: 74, clientX: 1300 });
  expect(wrapper.get('[data-test="canvas-stage"]').attributes("style")).toBe(afterCancel);
});
```

- [ ] **Step 3: 运行测试并按结果完成最小修正**

Run:

```powershell
$env:COREPACK_HOME='D:/workspace/ui/.corepack/v1'; $env:pnpm_config_store_dir='D:/workspace/ui/.pnpm-store'; corepack pnpm --filter @region-split/ui test -- src/components/PageOutline.test.ts
```

Expected: 若 Task 2 正确复用现有事件处理器，新增测试直接 PASS。若失败，只修正具体事件绑定或清理问题；不得给右边缘添加 `dblclick`处理器。

- [ ] **Step 4: 提交事件回归测试**

```powershell
git add apps/region-split-ui/src/components/PageOutline.test.ts apps/region-split-ui/src/components/PageOutline.vue
git commit -m "test: verify outline property edge interactions"
```

### Task 4: 完整工程和真实浏览器验收

**Files:**
- Modify if needed: `apps/region-split-ui/src/panel-layout.ts`
- Modify if needed: `apps/region-split-ui/src/panel-layout.test.ts`
- Modify if needed: `apps/region-split-ui/src/components/PageOutline.vue`
- Modify if needed: `apps/region-split-ui/src/components/PageOutline.test.ts`

- [ ] **Step 1: 运行 UI 全量测试**

```powershell
$env:COREPACK_HOME='D:/workspace/ui/.corepack/v1'; $env:pnpm_config_store_dir='D:/workspace/ui/.pnpm-store'; corepack pnpm --filter @region-split/ui test
```

Expected: 所有测试文件和测试项通过，零失败。

- [ ] **Step 2: 运行 UI 类型检查**

```powershell
$env:COREPACK_HOME='D:/workspace/ui/.corepack/v1'; $env:pnpm_config_store_dir='D:/workspace/ui/.pnpm-store'; corepack pnpm --filter @region-split/ui typecheck
```

Expected: exit code `0`，无 Vue/TypeScript 错误。

- [ ] **Step 3: 运行生产构建**

```powershell
$env:COREPACK_HOME='D:/workspace/ui/.corepack/v1'; $env:pnpm_config_store_dir='D:/workspace/ui/.pnpm-store'; corepack pnpm --filter @region-split/ui build
```

Expected: Vite 构建成功。若首次仅因 IDE `safe-delete`工具 `ETIMEDOUT`失败，原样重试一次；不得修改项目代码绕过环境工具。

- [ ] **Step 4: 启动真实页面**

```powershell
$env:COREPACK_HOME='D:/workspace/ui/.corepack/v1'; $env:pnpm_config_store_dir='D:/workspace/ui/.pnpm-store'; $env:UIR_UI_PORT='5186'; corepack pnpm --filter @region-split/ui dev -- --host 127.0.0.1
```

使用项目内浏览器工具打开 `http://127.0.0.1:5186`，载入已有项目或项目内测试图片。

- [ ] **Step 5: 完成 Chromium 验收**

逐项验证：

1. 属性栏最右侧出现可命中的调宽区域，视觉不额外占 Grid 宽度。
2. 向右拖动仅扩大属性栏，原图和结构树宽度不变，舞台右边缘向右移动。
3. 向左拖动仅缩小属性栏，达到 `220px`后停止。
4. `100%`和非 `100%`缩放下，右边缘都跟随真实鼠标。
5. 结构树收起后右边缘仍可拖动，恢复后保留属性栏宽度。
6. 右边缘双击不改变当前宽度。
7. 拖动不平移画布、不选中元素、不选择文本。
8. 现有两条内部分隔线仍只重新分配相邻栏宽并保持舞台总宽。
9. 调宽后普通栏内滚动、`Ctrl + 滚轮`缩放、“适应视图”和`100%`正常。
10. 浏览器控制台无错误。

- [ ] **Step 6: 修复验收问题并重新运行工程验证**

任何代码修复先增加最小回归测试，再运行：

```powershell
$env:COREPACK_HOME='D:/workspace/ui/.corepack/v1'; $env:pnpm_config_store_dir='D:/workspace/ui/.pnpm-store'; corepack pnpm --filter @region-split/ui test
$env:COREPACK_HOME='D:/workspace/ui/.corepack/v1'; $env:pnpm_config_store_dir='D:/workspace/ui/.pnpm-store'; corepack pnpm --filter @region-split/ui typecheck
$env:COREPACK_HOME='D:/workspace/ui/.corepack/v1'; $env:pnpm_config_store_dir='D:/workspace/ui/.pnpm-store'; corepack pnpm --filter @region-split/ui build
```

Expected: 三条命令全部成功。

- [ ] **Step 7: 提交验收修复（仅存在额外修改时）**

```powershell
git add apps/region-split-ui/src/panel-layout.ts apps/region-split-ui/src/panel-layout.test.ts apps/region-split-ui/src/components/PageOutline.vue apps/region-split-ui/src/components/PageOutline.test.ts
git commit -m "fix: harden outline property edge resizing"
```

- [ ] **Step 8: 推送当前分支**

```powershell
git push origin dev
```

Expected: `dev -> dev`。若网络失败，保留本地提交并报告错误；不得强制推送或改写历史。
