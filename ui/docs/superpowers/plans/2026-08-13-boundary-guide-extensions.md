# 区域分割线向原图延伸实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在双图工作区中，将每条内部区域分割线从分析图左边缘向原图延伸 `32px`，方便横向对照分界位置。

**Architecture:** 在 `RegionsNode.vue` 的 `.comparison-images` 共同容器中增加无指针事件的引导层，使用已分析区域中除首块外各区域的 `bounds.y` 作为内部边界。组件通过原图元素的实际显示高度计算原图坐标缩放比例，并使用 `ResizeObserver` 在布局尺寸变化时同步；`RegionCanvas.vue` 保持不变，避免跨越其 `overflow: hidden` 裁剪边界。

**Tech Stack:** Vue 3 Composition API、TypeScript、Vue Test Utils、Vitest、ResizeObserver、pnpm workspace

---

## 文件结构

- 修改 `apps/region-split-ui/src/canvas/nodes/RegionsNode.vue`：测量图片显示高度、计算内部边界位置、渲染跨图接缝的 `32px` 引导线，并管理 `ResizeObserver` 生命周期。
- 修改 `apps/region-split-ui/src/canvas/nodes/RegionsNode.test.ts`：覆盖显示条件、数量、位置、响应式更新、指针穿透和 observer 清理。

不修改 `RegionCanvas.vue`：它继续只负责右侧分析图内部的区域覆盖层和编辑交互。

### Task 1: 渲染内部边界引导线

**Files:**
- Modify: `apps/region-split-ui/src/canvas/nodes/RegionsNode.vue:1-264`
- Test: `apps/region-split-ui/src/canvas/nodes/RegionsNode.test.ts:1-228`

- [ ] **Step 1: 增加 ResizeObserver 测试替身和清理**

将测试导入改为：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
```

在文件顶部加入：

```ts
let resizeCallback: ResizeObserverCallback;
const observe = vi.fn();
const disconnect = vi.fn();

beforeEach(() => {
  observe.mockClear();
  disconnect.mockClear();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) {
      resizeCallback = callback;
    }
    observe = observe;
    disconnect = disconnect;
    unobserve = vi.fn();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
```

这使组件可以在 jsdom 中创建 observer，并允许测试主动触发尺寸变化。

- [ ] **Step 2: 编写内部边界数量和样式的失败测试**

在 `RegionsNode.test.ts` 加入 helper：

```ts
async function showAnalyzedResult(
  store: ReturnType<typeof createStore>,
  regions = [
    makeRegion("a", 0, 200),
    makeRegion("b", 200, 200),
    makeRegion("c", 400, 200),
  ],
) {
  store.projectId.value = "p1";
  store.doc.value = makeDoc(regions, [], true);
  store.regions.value = regions;
  await nextTick();
  const image = document.querySelector<HTMLElement>('[data-test="original-image"]')!;
  Object.defineProperty(image, "clientHeight", { configurable: true, value: 600 });
  image.dispatchEvent(new Event("load"));
  await nextTick();
}
```

加入测试：

```ts
it("extends each internal region boundary 32px into the original image", async () => {
  const { store, wrapper } = await mountNode();
  await showAnalyzedResult(store);

  const layer = wrapper.get('[data-test="boundary-guides"]');
  const guides = wrapper.findAll('[data-test="boundary-guide"]');

  expect(guides).toHaveLength(2);
  expect(layer.attributes("style")).toContain("height: 600px");
  expect(guides[0]!.attributes("style")).toContain("top: 200px");
  expect(guides[1]!.attributes("style")).toContain("top: 400px");
  expect(guides.every(guide => guide.attributes("style").includes("width: 32px"))).toBe(true);
});
```

该测试通过数量 `n - 1` 同时证明顶部 `0` 和底部 `600` 未被渲染。

- [ ] **Step 3: 运行测试并确认失败**

Run:

```powershell
$env:COREPACK_HOME='D:\workspace\.worktrees\region-split-canvas-ui\ui\.corepack'; $env:PNPM_HOME='D:\workspace\.worktrees\region-split-canvas-ui\ui\.pnpm-bin'; $env:PNPM_STORE_DIR='D:\workspace\.worktrees\region-split-canvas-ui\ui\.cache\pnpm-store'; & 'D:\nodejs\corepack.cmd' pnpm --filter @region-split/ui test -- src/canvas/nodes/RegionsNode.test.ts
```

Expected: FAIL，找不到 `[data-test="boundary-guides"]`。

- [ ] **Step 4: 实现图片测量与内部边界计算**

更新 `RegionsNode.vue` 的 Vue 导入：

```ts
import {
  computed, nextTick, onBeforeUnmount, onMounted, ref, watch,
  type CSSProperties,
} from "vue";
```

在状态区加入：

```ts
const originalImageEl = ref<HTMLImageElement | null>(null);
const imageDisplayHeight = ref(0);
let imageResizeObserver: ResizeObserver | null = null;

const internalBoundaryGuides = computed(() => {
  const documentHeight = props.store.doc.value?.height ?? 0;
  if (!resultReady.value || documentHeight <= 0 || imageDisplayHeight.value <= 0) return [];
  const scale = imageDisplayHeight.value / documentHeight;
  return props.store.regions.value.slice(1).map(region => ({
    id: region.id,
    top: region.bounds.y * scale,
  }));
});

function guideStyle(top: number): CSSProperties {
  return { top: `${top}px`, width: "32px" };
}

function measureOriginalImage() {
  imageDisplayHeight.value = originalImageEl.value?.clientHeight ?? 0;
}

function observeOriginalImage() {
  imageResizeObserver?.disconnect();
  imageResizeObserver = null;
  const image = originalImageEl.value;
  if (!image || typeof ResizeObserver === "undefined") {
    measureOriginalImage();
    return;
  }
  imageResizeObserver = new ResizeObserver(measureOriginalImage);
  imageResizeObserver.observe(image);
  measureOriginalImage();
}
```

扩展现有 `watch(imageSrc, ...)`，在 URL 更新后等待 DOM 更新并观察新图片：

```ts
watch(imageSrc, async (_value, previous) => {
  if (previous) URL.revokeObjectURL(previous);
  await nextTick();
  observeOriginalImage();
});
```

删除原来重复的 `watch(imageSrc, value => ...)`。在现有卸载钩子中加入 observer 清理：

```ts
onBeforeUnmount(() => {
  if (imageSrc.value) URL.revokeObjectURL(imageSrc.value);
  imageResizeObserver?.disconnect();
});
```

`onMounted` 中在原有加载逻辑后执行一次：

```ts
onMounted(observeOriginalImage);
```

- [ ] **Step 5: 渲染共同容器引导层**

为原图增加 ref 和 load 测量：

```vue
<img
  ref="originalImageEl"
  data-test="original-image"
  class="comparison-image"
  :src="imageSrc"
  alt="原始效果图"
  @load="measureOriginalImage"
/>
```

在 `.comparison-images` 中两个 `.image-panel` 之后加入：

```vue
<div
  v-if="internalBoundaryGuides.length"
  data-test="boundary-guides"
  class="boundary-guides"
  :style="{ height: `${imageDisplayHeight}px` }"
  aria-hidden="true"
>
  <span
    v-for="guide in internalBoundaryGuides"
    :key="guide.id"
    data-test="boundary-guide"
    class="boundary-guide"
    :style="guideStyle(guide.top)"
  />
</div>
```

- [ ] **Step 6: 添加跨接缝且不参与布局和交互的样式**

更新并新增样式：

```css
.comparison-images {
  position: relative;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 430px));
  gap: 0;
  align-items: start;
}
.boundary-guides {
  position: absolute;
  z-index: 6;
  top: 28px;
  left: calc(50% - 32px);
  width: 32px;
  overflow: visible;
  pointer-events: none;
}
.boundary-guide {
  position: absolute;
  left: 0;
  height: 1px;
  background: #4c8dff66;
  pointer-events: none;
}
```

`left: calc(50% - 32px)` 使线条右端严格对齐第二列（分析图）左边缘；绝对定位保证它不扩展网格宽度或产生额外间距。

- [ ] **Step 7: 运行测试并确认基础引导线通过**

Run:

```powershell
$env:COREPACK_HOME='D:\workspace\.worktrees\region-split-canvas-ui\ui\.corepack'; $env:PNPM_HOME='D:\workspace\.worktrees\region-split-canvas-ui\ui\.pnpm-bin'; $env:PNPM_STORE_DIR='D:\workspace\.worktrees\region-split-canvas-ui\ui\.cache\pnpm-store'; & 'D:\nodejs\corepack.cmd' pnpm --filter @region-split/ui test -- src/canvas/nodes/RegionsNode.test.ts
```

Expected: PASS，原有上传、分析、双图和事件测试保持通过。

- [ ] **Step 8: 提交基础引导线**

```powershell
git add apps/region-split-ui/src/canvas/nodes/RegionsNode.vue apps/region-split-ui/src/canvas/nodes/RegionsNode.test.ts; git commit -m "feat: extend region boundaries into source image"
```

### Task 2: 覆盖响应式更新和生命周期

**Files:**
- Modify: `apps/region-split-ui/src/canvas/nodes/RegionsNode.vue`
- Test: `apps/region-split-ui/src/canvas/nodes/RegionsNode.test.ts`

- [ ] **Step 1: 编写显示门禁测试**

加入：

```ts
it("hides boundary guides until analysis and image measurement are ready", async () => {
  const { store, wrapper } = await mountNode();

  expect(wrapper.find('[data-test="boundary-guides"]').exists()).toBe(false);

  store.projectId.value = "p1";
  store.doc.value = makeDoc([makeRegion("a", 0, 600)], [], true);
  store.regions.value = store.doc.value.regions;
  await nextTick();
  expect(wrapper.find('[data-test="boundary-guides"]').exists()).toBe(false);

  store.regions.value = [makeRegion("a", 0, 300), makeRegion("b", 300, 300)];
  store.doc.value = makeDoc(store.regions.value, [], false);
  await nextTick();
  expect(wrapper.find('[data-test="boundary-guides"]').exists()).toBe(false);
});
```

覆盖未分析、单区域和未测量三类情况。

- [ ] **Step 2: 编写区域与尺寸响应式更新测试**

加入：

```ts
it("updates guide positions after boundary and image-size changes", async () => {
  const { store, wrapper } = await mountNode();
  await showAnalyzedResult(store);

  store.regions.value = [
    makeRegion("a", 0, 180),
    makeRegion("b", 180, 220),
    makeRegion("c", 400, 200),
  ];
  await nextTick();
  expect(wrapper.findAll('[data-test="boundary-guide"]')[0]!.attributes("style"))
    .toContain("top: 180px");

  const image = wrapper.get('[data-test="original-image"]').element;
  Object.defineProperty(image, "clientHeight", { configurable: true, value: 300 });
  resizeCallback([], {} as ResizeObserver);
  await nextTick();

  const guides = wrapper.findAll('[data-test="boundary-guide"]');
  expect(guides[0]!.attributes("style")).toContain("top: 90px");
  expect(guides[1]!.attributes("style")).toContain("top: 200px");
});
```

- [ ] **Step 3: 编写 observer 生命周期和指针穿透测试**

加入：

```ts
it("observes image size, keeps guides pointer-transparent, and disconnects on unmount", async () => {
  const { store, wrapper } = await mountNode();
  await showAnalyzedResult(store);

  const image = wrapper.get('[data-test="original-image"]').element;
  expect(observe).toHaveBeenCalledWith(image);
  expect(wrapper.get('[data-test="boundary-guides"]').classes()).toContain("boundary-guides");

  wrapper.unmount();
  expect(disconnect).toHaveBeenCalled();
});
```

CSS 中 `.boundary-guides` 和 `.boundary-guide` 均为 `pointer-events: none`；测试通过固定 class 锁定该行为，并由生产构建验证样式存在。

- [ ] **Step 4: 运行组件测试**

Run:

```powershell
$env:COREPACK_HOME='D:\workspace\.worktrees\region-split-canvas-ui\ui\.corepack'; $env:PNPM_HOME='D:\workspace\.worktrees\region-split-canvas-ui\ui\.pnpm-bin'; $env:PNPM_STORE_DIR='D:\workspace\.worktrees\region-split-canvas-ui\ui\.cache\pnpm-store'; & 'D:\nodejs\corepack.cmd' pnpm --filter @region-split/ui test -- src/canvas/nodes/RegionsNode.test.ts
```

Expected: 全部 PASS；若响应式或 observer 清理测试失败，只修改 `RegionsNode.vue` 中对应测量/生命周期逻辑，不改测试期望规避问题。

- [ ] **Step 5: 运行 UI 类型检查**

```powershell
$env:COREPACK_HOME='D:\workspace\.worktrees\region-split-canvas-ui\ui\.corepack'; $env:PNPM_HOME='D:\workspace\.worktrees\region-split-canvas-ui\ui\.pnpm-bin'; $env:PNPM_STORE_DIR='D:\workspace\.worktrees\region-split-canvas-ui\ui\.cache\pnpm-store'; & 'D:\nodejs\corepack.cmd' pnpm --filter @region-split/ui typecheck
```

Expected: 退出码 `0`，`ResizeObserverCallback`、template ref 和 `CSSProperties` 均无类型错误。

- [ ] **Step 6: 提交响应式与生命周期覆盖**

```powershell
git add apps/region-split-ui/src/canvas/nodes/RegionsNode.vue apps/region-split-ui/src/canvas/nodes/RegionsNode.test.ts; git commit -m "test: verify boundary guide synchronization"
```

### Task 3: 全量回归验证与交付

**Files:**
- Verify: `apps/region-split-ui/src/canvas/nodes/RegionsNode.vue`
- Verify: `apps/region-split-ui/src/canvas/nodes/RegionsNode.test.ts`
- Verify: all workspace tests and builds

- [ ] **Step 1: 运行 UI 全量测试**

```powershell
$env:COREPACK_HOME='D:\workspace\.worktrees\region-split-canvas-ui\ui\.corepack'; $env:PNPM_HOME='D:\workspace\.worktrees\region-split-canvas-ui\ui\.pnpm-bin'; $env:PNPM_STORE_DIR='D:\workspace\.worktrees\region-split-canvas-ui\ui\.cache\pnpm-store'; & 'D:\nodejs\corepack.cmd' pnpm --filter @region-split/ui test
```

Expected: 全部 PASS。

- [ ] **Step 2: 运行工作区全量测试**

```powershell
$env:COREPACK_HOME='D:\workspace\.worktrees\region-split-canvas-ui\ui\.corepack'; $env:PNPM_HOME='D:\workspace\.worktrees\region-split-canvas-ui\ui\.pnpm-bin'; $env:PNPM_STORE_DIR='D:\workspace\.worktrees\region-split-canvas-ui\ui\.cache\pnpm-store'; & 'D:\nodejs\corepack.cmd' pnpm test
```

Expected: 全部 PASS。若测试生成 `packages/region-split/probe-in.png`，验证后删除该临时文件。

- [ ] **Step 3: 分包运行类型检查**

```powershell
$env:COREPACK_HOME='D:\workspace\.worktrees\region-split-canvas-ui\ui\.corepack'; $env:PNPM_HOME='D:\workspace\.worktrees\region-split-canvas-ui\ui\.pnpm-bin'; $env:PNPM_STORE_DIR='D:\workspace\.worktrees\region-split-canvas-ui\ui\.cache\pnpm-store'; & 'D:\nodejs\corepack.cmd' pnpm --filter @region-split/core typecheck; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; & 'D:\nodejs\corepack.cmd' pnpm --filter @region-split/ui typecheck
```

Expected: 两个包均通过。

- [ ] **Step 4: 运行 UI 生产构建**

```powershell
$env:COREPACK_HOME='D:\workspace\.worktrees\region-split-canvas-ui\ui\.corepack'; $env:PNPM_HOME='D:\workspace\.worktrees\region-split-canvas-ui\ui\.pnpm-bin'; $env:PNPM_STORE_DIR='D:\workspace\.worktrees\region-split-canvas-ui\ui\.cache\pnpm-store'; & 'D:\nodejs\corepack.cmd' pnpm --filter @region-split/ui build
```

Expected: Vite 构建成功。

- [ ] **Step 5: 检查差异和临时文件**

```powershell
if (Test-Path 'packages/region-split/probe-in.png') { Remove-Item 'packages/region-split/probe-in.png' }; git --no-pager diff --check; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; git --no-pager status --short --branch
```

Expected: `diff --check` 无输出；不包含 `.corepack`、探针图片或其他临时文件。

- [ ] **Step 6: 如验证修正产生改动，提交修正**

仅在验证修正产生预期功能文件改动时运行：

```powershell
git add apps/region-split-ui/src/canvas/nodes/RegionsNode.vue apps/region-split-ui/src/canvas/nodes/RegionsNode.test.ts; git commit -m "fix: finalize boundary guide extensions"
```

- [ ] **Step 7: 推送双图工作区分支**

```powershell
git push origin feature/region-split-canvas-ui
```

Expected: 推送成功；若网络连接 GitHub 失败，保留本地提交并准确报告，不使用 force push。
