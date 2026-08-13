# 区域列表边界调整按钮实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除区域列表中的置信度百分比，并为每个区域增加可单击或长按的向上、向下扩展按钮。

**Architecture:** 核心层继续使用现有 `adjustBoundary` 操作共享边界；前端 store 新增按区域 ID 和方向表达的 `canExpandRegion`、`expandRegion` 接口，将“向上扩展”映射为移动前一条共享边界，将“向下扩展”映射为移动后一条共享边界。`RegionList.vue` 只负责按钮状态和长按手势，所有选择、撤销、边界约束和持久化仍由 store 统一处理。

**Tech Stack:** Vue 3 Composition API、TypeScript、Vue Test Utils、Vitest、pnpm workspace

---

## 文件结构

- 修改 `apps/region-split-ui/src/state.ts`：新增区域方向类型、方向可用性判断、按区域扩展动作，并抽取无空撤销步骤的共享边界微调流程。
- 修改 `apps/region-split-ui/src/state.test.ts`：覆盖上下扩展映射、自动选择、限制条件、撤销合并和 no-op。
- 修改 `apps/region-split-ui/src/components/RegionList.vue`：删除置信度，渲染按钮并实现长按生命周期。
- 修改 `apps/region-split-ui/src/components/RegionList.test.ts`：覆盖显示、禁用、单击、事件隔离和长按。

不修改核心 `packages/region-split/src/operations.ts`：现有 `adjustBoundary(regions, index, delta)` 已能安全表达两个方向，并负责最小高度钳制。

### Task 1: 增加按区域方向调整的 store 能力

**Files:**
- Modify: `apps/region-split-ui/src/state.ts:1-303`
- Test: `apps/region-split-ui/src/state.test.ts:14-64`

- [ ] **Step 1: 编写上下扩展和自动选择的失败测试**

在 `state.test.ts` 的现有 nudge 测试后加入：

```ts
it("expands a region upward and selects it", async () => {
  const { store } = await loadedStore();
  store.doc.value = { ...store.doc.value!, analyzedAt: "2026-08-13T00:00:00.000Z" };

  store.expandRegion("b", "up");

  expect(store.selectedIds.value).toEqual(["b"]);
  expect(store.regions.value.map(region => region.bounds)).toEqual([
    { x: 0, y: 0, w: 375, h: 199 },
    { x: 0, y: 199, w: 375, h: 201 },
    { x: 0, y: 400, w: 375, h: 200 },
  ]);
});

it("expands a region downward and selects it", async () => {
  const { store } = await loadedStore();
  store.doc.value = { ...store.doc.value!, analyzedAt: "2026-08-13T00:00:00.000Z" };

  store.expandRegion("b", "down");

  expect(store.selectedIds.value).toEqual(["b"]);
  expect(store.regions.value.map(region => region.bounds)).toEqual([
    { x: 0, y: 0, w: 375, h: 200 },
    { x: 0, y: 200, w: 375, h: 201 },
    { x: 0, y: 401, w: 375, h: 199 },
  ]);
});
```

- [ ] **Step 2: 运行测试并确认因接口不存在而失败**

Run:

```powershell
$env:PNPM_HOME='D:\workspace\ui\.pnpm-bin'; $env:PNPM_STORE_DIR='D:\workspace\ui\.pnpm-store'; pnpm --filter @region-split/ui test -- src/state.test.ts
```

Expected: FAIL，TypeScript 或运行时报告 `expandRegion` 不存在。

- [ ] **Step 3: 实现方向类型、可用性判断和最小扩展动作**

在 `state.ts` 顶部类型区加入：

```ts
export type RegionExpandDirection = "up" | "down";
```

在 `needsAnalysis` 后加入内部定位与判断函数：

```ts
function boundaryMoveForRegion(id: string, direction: RegionExpandDirection) {
  const regionIndex = regions.value.findIndex(region => region.id === id);
  if (regionIndex < 0) return null;
  return direction === "up"
    ? { regionIndex, boundaryIndex: regionIndex - 1, delta: -1 }
    : { regionIndex, boundaryIndex: regionIndex, delta: 1 };
}

function canExpandRegion(id: string, direction: RegionExpandDirection): boolean {
  if (busy.value || needsAnalysis.value || mode.value === "split") return false;
  const move = boundaryMoveForRegion(id, direction);
  if (!move || !canAdjustBoundary(regions.value, move.boundaryIndex)) return false;
  return adjustBoundary(regions.value, move.boundaryIndex, move.delta) !== regions.value;
}
```

在返回对象的方法区加入：

```ts
expandRegion(id: string, direction: RegionExpandDirection) {
  if (!canExpandRegion(id, direction)) return;
  const move = boundaryMoveForRegion(id, direction)!;
  const next = adjustBoundary(regions.value, move.boundaryIndex, move.delta);
  selectedIds.value = [id];
  const now = Date.now();
  if (now - lastNudgeAt >= COALESCE_MS) pushUndo();
  lastNudgeAt = now;
  regions.value = next;
  schedulePersist();
},
```

并将 `canExpandRegion` 暴露在返回对象的响应式能力一段：

```ts
isModelConfigured, candidateLines, needsAnalysis, canExpandRegion,
```

- [ ] **Step 4: 运行状态测试并确认上下扩展通过**

Run:

```powershell
$env:PNPM_HOME='D:\workspace\ui\.pnpm-bin'; $env:PNPM_STORE_DIR='D:\workspace\ui\.pnpm-store'; pnpm --filter @region-split/ui test -- src/state.test.ts
```

Expected: PASS。

- [ ] **Step 5: 编写首尾、最小高度、模式门禁和 no-op 的失败测试**

继续在 `state.test.ts` 加入：

```ts
it("reports whether each region can expand in either direction", async () => {
  const { store } = await loadedStore();
  store.doc.value = { ...store.doc.value!, analyzedAt: "2026-08-13T00:00:00.000Z" };

  expect(store.canExpandRegion("a", "up")).toBe(false);
  expect(store.canExpandRegion("a", "down")).toBe(true);
  expect(store.canExpandRegion("c", "up")).toBe(true);
  expect(store.canExpandRegion("c", "down")).toBe(false);

  store.regions.value = [
    makeRegion("a", 0, 8),
    makeRegion("b", 8, 584),
    makeRegion("c", 592, 8),
  ];
  expect(store.canExpandRegion("b", "up")).toBe(false);
  expect(store.canExpandRegion("b", "down")).toBe(false);
});

it("blocks directional expansion while unanalysed, busy, or splitting", async () => {
  const { store } = await loadedStore();
  const before = store.regions.value;

  expect(store.needsAnalysis.value).toBe(true);
  store.expandRegion("b", "up");
  expect(store.regions.value).toBe(before);

  store.doc.value = { ...store.doc.value!, analyzedAt: "2026-08-13T00:00:00.000Z" };
  store.busyLabel.value = "AI 分析中…";
  store.expandRegion("b", "up");
  expect(store.regions.value).toBe(before);

  store.busyLabel.value = "";
  store.select("b", false);
  store.beginSplit();
  store.expandRegion("b", "up");
  expect(store.regions.value).toBe(before);
});

it("does not create undo or persistence work for an impossible expansion", async () => {
  const { store, putRegions } = await loadedStore();
  store.doc.value = { ...store.doc.value!, analyzedAt: "2026-08-13T00:00:00.000Z" };

  store.expandRegion("a", "up");

  expect(store.canUndo.value).toBe(false);
  await vi.advanceTimersByTimeAsync(500);
  expect(putRegions).not.toHaveBeenCalled();
});
```

- [ ] **Step 6: 运行测试并确认限制条件存在缺口**

Run:

```powershell
$env:PNPM_HOME='D:\workspace\ui\.pnpm-bin'; $env:PNPM_STORE_DIR='D:\workspace\ui\.pnpm-store'; pnpm --filter @region-split/ui test -- src/state.test.ts
```

Expected: 如果 Step 3 已完整实现则直接 PASS；否则失败点必须对应模式门禁、最小高度或 no-op 撤销。

- [ ] **Step 7: 让旧 `nudge` 同样避免 no-op 撤销和持久化**

将 `nudge` 改为先计算结果、结果发生变化后才压栈：

```ts
nudge(delta: number) {
  if (busy.value) return;
  const index = selectedIndex.value;
  if (index < 0 || !canAdjustBoundary(regions.value, index)) return;
  const next = adjustBoundary(regions.value, index, delta);
  if (next === regions.value) return;
  const now = Date.now();
  if (now - lastNudgeAt >= COALESCE_MS) pushUndo();
  lastNudgeAt = now;
  regions.value = next;
  schedulePersist();
},
```

这样新旧边界入口都遵守规范中的 no-op 要求。

- [ ] **Step 8: 验证状态层完整测试**

Run:

```powershell
$env:PNPM_HOME='D:\workspace\ui\.pnpm-bin'; $env:PNPM_STORE_DIR='D:\workspace\ui\.pnpm-store'; pnpm --filter @region-split/ui test -- src/state.test.ts
```

Expected: PASS，且无未处理 Promise 或定时器警告。

- [ ] **Step 9: 提交状态层改动**

```powershell
git add apps/region-split-ui/src/state.ts apps/region-split-ui/src/state.test.ts; git commit -m "feat: add directional region expansion"
```

### Task 2: 用上下箭头替换列表置信度

**Files:**
- Modify: `apps/region-split-ui/src/components/RegionList.vue:1-156`
- Test: `apps/region-split-ui/src/components/RegionList.test.ts:7-139`

- [ ] **Step 1: 让组件测试默认使用已分析文档**

修改 `RegionList.test.ts` 的 `mounted` helper，使普通交互测试能够操作按钮：

```ts
async function mounted() {
  const store = createStore(makeFakeApi(initial));
  await store.load("p1");
  store.doc.value = { ...store.doc.value!, analyzedAt: "2026-08-13T00:00:00.000Z" };
  return { store, wrapper: mount(RegionList, { props: { store } }) };
}
```

将“未分析提示”测试改为显式清除 `analyzedAt`：

```ts
it("warns that an un-analysed document is only the initial split", async () => {
  const { store, wrapper } = await mounted();
  store.doc.value = { ...store.doc.value!, analyzedAt: undefined };
  await wrapper.vm.$nextTick();
  const notice = wrapper.find("[data-test=needs-analysis]");
  expect(notice.exists()).toBe(true);
  expect(notice.text()).toContain("初始划分");
  expect(notice.text()).toContain("重新分析");
});
```

- [ ] **Step 2: 编写置信度移除和箭头显示的失败测试**

替换首个列表展示测试：

```ts
it("lists every region with type and boundary controls instead of confidence", async () => {
  const { wrapper } = await mounted();
  const rows = wrapper.findAll("[data-test=row]");

  expect(rows).toHaveLength(2);
  expect(rows[0]!.text()).toContain("名-a");
  expect(rows[0]!.text()).toContain("card");
  expect(rows[0]!.text()).not.toContain("87%");
  expect(rows[0]!.find("[data-test=expand-up]").attributes("aria-label"))
    .toBe("向上扩展区域");
  expect(rows[0]!.find("[data-test=expand-down]").attributes("aria-label"))
    .toBe("向下扩展区域");
});
```

再加入首尾禁用测试：

```ts
it("disables controls at fixed outer boundaries", async () => {
  const { wrapper } = await mounted();
  const rows = wrapper.findAll("[data-test=row]");

  expect(rows[0]!.get("[data-test=expand-up]").attributes("disabled")).toBeDefined();
  expect(rows[0]!.get("[data-test=expand-down]").attributes("disabled")).toBeUndefined();
  expect(rows[1]!.get("[data-test=expand-up]").attributes("disabled")).toBeUndefined();
  expect(rows[1]!.get("[data-test=expand-down]").attributes("disabled")).toBeDefined();
});
```

- [ ] **Step 3: 运行组件测试并确认失败**

Run:

```powershell
$env:PNPM_HOME='D:\workspace\ui\.pnpm-bin'; $env:PNPM_STORE_DIR='D:\workspace\ui\.pnpm-store'; pnpm --filter @region-split/ui test -- src/components/RegionList.test.ts
```

Expected: FAIL，找不到 `expand-up` / `expand-down`，且仍出现 `87%`。

- [ ] **Step 4: 添加基础按钮并删除置信度**

在 `RegionList.vue` 的 `<script setup>` 中加入：

```ts
import type { RegionExpandDirection } from "../state.js";

function expand(id: string, direction: RegionExpandDirection) {
  props.store.expandRegion(id, direction);
}
```

将模板中的 `confidence` 替换为：

```vue
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
```

删除 `.confidence`，增加紧凑样式：

```css
.boundary-controls { display: inline-flex; gap: 2px; margin-left: 2px; }
.boundary-controls button {
  width: 22px; height: 22px; padding: 0; border: 1px solid #c9d3e6;
  border-radius: 4px; background: #fff; color: #2f6fed; cursor: pointer;
  font-size: 10px; line-height: 1;
}
.boundary-controls button:hover:not(:disabled) { background: #edf3ff; }
.boundary-controls button:disabled { color: #b8bec9; background: #f5f6f8; cursor: not-allowed; }
```

- [ ] **Step 5: 运行组件测试并确认基础展示通过**

Run:

```powershell
$env:PNPM_HOME='D:\workspace\ui\.pnpm-bin'; $env:PNPM_STORE_DIR='D:\workspace\ui\.pnpm-store'; pnpm --filter @region-split/ui test -- src/components/RegionList.test.ts
```

Expected: PASS。

- [ ] **Step 6: 编写单击自动选择、事件隔离和状态禁用测试**

在 `RegionList.test.ts` 加入：

```ts
it("selects the row and expands it from either boundary button", async () => {
  const { store, wrapper } = await mounted();
  const secondRow = wrapper.findAll("[data-test=row]")[1]!;

  await secondRow.get("[data-test=expand-up]").trigger("click");

  expect(store.selectedIds.value).toEqual(["b"]);
  expect(store.regions.value[0]!.bounds.h).toBe(299);
  expect(store.regions.value[1]!.bounds).toMatchObject({ y: 299, h: 301 });
});

it("does not bubble a boundary-control click into additive row selection", async () => {
  const { store, wrapper } = await mounted();
  store.select("a", false);

  await wrapper.findAll("[data-test=row]")[1]!
    .get("[data-test=expand-up]").trigger("click", { ctrlKey: true });

  expect(store.selectedIds.value).toEqual(["b"]);
});

it("disables both controls while busy, unanalysed, or splitting", async () => {
  const { store, wrapper } = await mounted();
  const controlsDisabled = () => wrapper.findAll(".boundary-controls button")
    .every(button => button.attributes("disabled") !== undefined);

  store.busyLabel.value = "AI 分析中…";
  await wrapper.vm.$nextTick();
  expect(controlsDisabled()).toBe(true);

  store.busyLabel.value = "";
  store.doc.value = { ...store.doc.value!, analyzedAt: undefined };
  await wrapper.vm.$nextTick();
  expect(controlsDisabled()).toBe(true);

  store.doc.value = { ...store.doc.value!, analyzedAt: "2026-08-13T00:00:00.000Z" };
  store.select("a", false);
  store.beginSplit();
  await wrapper.vm.$nextTick();
  expect(controlsDisabled()).toBe(true);
});
```

- [ ] **Step 7: 运行组件测试并确认行为通过**

Run:

```powershell
$env:PNPM_HOME='D:\workspace\ui\.pnpm-bin'; $env:PNPM_STORE_DIR='D:\workspace\ui\.pnpm-store'; pnpm --filter @region-split/ui test -- src/components/RegionList.test.ts
```

Expected: PASS。

- [ ] **Step 8: 提交基础列表按钮**

```powershell
git add apps/region-split-ui/src/components/RegionList.vue apps/region-split-ui/src/components/RegionList.test.ts; git commit -m "feat: replace confidence with boundary controls"
```

### Task 3: 实现按钮长按连续调整

**Files:**
- Modify: `apps/region-split-ui/src/components/RegionList.vue:1-180`
- Test: `apps/region-split-ui/src/components/RegionList.test.ts`

- [ ] **Step 1: 编写长按节奏和尾随 click 抑制的失败测试**

将 Vitest 导入改为：

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
```

在 describe 内加入清理：

```ts
afterEach(() => vi.useRealTimers());
```

加入测试：

```ts
it("repeats expansion after 400ms while held and suppresses the trailing click", async () => {
  vi.useFakeTimers();
  const { store, wrapper } = await mounted();
  const button = wrapper.findAll("[data-test=row]")[1]!.get("[data-test=expand-up]");

  await button.trigger("pointerdown", { button: 0 });
  expect(store.regions.value[1]!.bounds.h).toBe(301);

  await vi.advanceTimersByTimeAsync(399);
  expect(store.regions.value[1]!.bounds.h).toBe(301);

  await vi.advanceTimersByTimeAsync(61);
  expect(store.regions.value[1]!.bounds.h).toBe(302);

  await button.trigger("pointerup");
  await button.trigger("click");
  expect(store.regions.value[1]!.bounds.h).toBe(302);

  await vi.advanceTimersByTimeAsync(120);
  expect(store.regions.value[1]!.bounds.h).toBe(302);
});

it("coalesces one held adjustment into one undo step", async () => {
  vi.useFakeTimers();
  const { store, wrapper } = await mounted();
  const button = wrapper.findAll("[data-test=row]")[1]!.get("[data-test=expand-up]");

  await button.trigger("pointerdown", { button: 0 });
  await vi.advanceTimersByTimeAsync(580);
  await button.trigger("pointerup");
  expect(store.regions.value[1]!.bounds.h).toBeGreaterThan(301);

  store.undo();
  expect(store.regions.value[1]!.bounds).toMatchObject({ y: 300, h: 300 });
  expect(store.canUndo.value).toBe(false);
});
```

- [ ] **Step 2: 运行测试并确认当前 pointerdown 不会连续调整**

Run:

```powershell
$env:PNPM_HOME='D:\workspace\ui\.pnpm-bin'; $env:PNPM_STORE_DIR='D:\workspace\ui\.pnpm-store'; pnpm --filter @region-split/ui test -- src/components/RegionList.test.ts
```

Expected: FAIL，`pointerdown` 不改变高度或长按不重复。

- [ ] **Step 3: 在组件中实现可清理的 pointer 长按状态**

更新 Vue 导入：

```ts
import {
  computed, nextTick, onBeforeUnmount, ref, watch,
  type ComponentPublicInstance,
} from "vue";
```

在 `RegionList.vue` 脚本中加入：

```ts
const REPEAT_DELAY_MS = 400;
const REPEAT_INTERVAL_MS = 60;
let repeatDelay: ReturnType<typeof setTimeout> | null = null;
let repeatInterval: ReturnType<typeof setInterval> | null = null;
let suppressClick = false;

function clearRepeatTimers() {
  if (repeatDelay) clearTimeout(repeatDelay);
  if (repeatInterval) clearInterval(repeatInterval);
  repeatDelay = null;
  repeatInterval = null;
}

function startExpand(event: PointerEvent, id: string, direction: RegionExpandDirection) {
  if (event.button !== 0 || !props.store.canExpandRegion(id, direction)) return;
  clearRepeatTimers();
  suppressClick = false;
  props.store.expandRegion(id, direction);
  repeatDelay = setTimeout(() => {
    suppressClick = true;
    repeatInterval = setInterval(() => {
      if (!props.store.canExpandRegion(id, direction)) {
        clearRepeatTimers();
        return;
      }
      props.store.expandRegion(id, direction);
    }, REPEAT_INTERVAL_MS);
  }, REPEAT_DELAY_MS);
}

function stopExpand() {
  clearRepeatTimers();
}

function onExpandClick(event: MouseEvent, id: string, direction: RegionExpandDirection) {
  if (suppressClick) {
    suppressClick = false;
    event.preventDefault();
    return;
  }
  // 键盘激活没有 pointerdown，需要在 click 阶段执行；鼠标单击已在 pointerdown 执行。
  if (event.detail === 0) props.store.expandRegion(id, direction);
}

onBeforeUnmount(clearRepeatTimers);
```

将两个按钮的事件分别改为以下形式；方向按按钮使用 `up` 或 `down`：

```vue
@pointerdown.stop="startExpand($event, region.id, 'up')"
@pointerup.stop="stopExpand"
@pointercancel.stop="stopExpand"
@pointerleave="stopExpand"
@click.stop="onExpandClick($event, region.id, 'up')"
```

```vue
@pointerdown.stop="startExpand($event, region.id, 'down')"
@pointerup.stop="stopExpand"
@pointercancel.stop="stopExpand"
@pointerleave="stopExpand"
@click.stop="onExpandClick($event, region.id, 'down')"
```

- [ ] **Step 4: 运行长按和全部列表测试**

Run:

```powershell
$env:PNPM_HOME='D:\workspace\ui\.pnpm-bin'; $env:PNPM_STORE_DIR='D:\workspace\ui\.pnpm-store'; pnpm --filter @region-split/ui test -- src/components/RegionList.test.ts
```

Expected: PASS；长按从 pointerdown 立即调整一次，`400ms` 后按 `60ms` 周期继续，松开后停止，尾随 click 不重复调整。

- [ ] **Step 5: 验证长按持久化仍被防抖**

在 `RegionList.test.ts` 增加：

```ts
it("debounces persistence during a held adjustment", async () => {
  vi.useFakeTimers();
  const api = makeFakeApi(initial);
  const store = createStore(api);
  await store.load("p1");
  store.doc.value = { ...store.doc.value!, analyzedAt: "2026-08-13T00:00:00.000Z" };
  const wrapper = mount(RegionList, { props: { store } });
  const button = wrapper.findAll("[data-test=row]")[1]!.get("[data-test=expand-up]");

  await button.trigger("pointerdown", { button: 0 });
  await vi.advanceTimersByTimeAsync(580);
  expect(api.putRegions).not.toHaveBeenCalled();

  await button.trigger("pointerup");
  await vi.advanceTimersByTimeAsync(400);
  expect(api.putRegions).toHaveBeenCalledTimes(1);
});
```

Run:

```powershell
$env:PNPM_HOME='D:\workspace\ui\.pnpm-bin'; $env:PNPM_STORE_DIR='D:\workspace\ui\.pnpm-store'; pnpm --filter @region-split/ui test -- src/components/RegionList.test.ts
```

Expected: PASS，只产生一次防抖后的 `putRegions` 调用。

- [ ] **Step 6: 提交长按交互**

```powershell
git add apps/region-split-ui/src/components/RegionList.vue apps/region-split-ui/src/components/RegionList.test.ts; git commit -m "feat: support held boundary adjustments"
```

### Task 4: 全量回归验证与交付

**Files:**
- Verify: `apps/region-split-ui/src/state.ts`
- Verify: `apps/region-split-ui/src/components/RegionList.vue`
- Verify: all workspace tests and builds

- [ ] **Step 1: 运行 UI 测试**

Run:

```powershell
$env:PNPM_HOME='D:\workspace\ui\.pnpm-bin'; $env:PNPM_STORE_DIR='D:\workspace\ui\.pnpm-store'; pnpm --filter @region-split/ui test
```

Expected: 全部 PASS。

- [ ] **Step 2: 运行工作区全量测试**

Run:

```powershell
$env:PNPM_HOME='D:\workspace\ui\.pnpm-bin'; $env:PNPM_STORE_DIR='D:\workspace\ui\.pnpm-store'; pnpm test
```

Expected: 全部 PASS。

- [ ] **Step 3: 分包运行类型检查**

根 `typecheck` 在 Windows 子进程中可能找不到 `pnpm`，按包运行：

```powershell
$env:PNPM_HOME='D:\workspace\ui\.pnpm-bin'; $env:PNPM_STORE_DIR='D:\workspace\ui\.pnpm-store'; pnpm --filter @region-split/core typecheck; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; pnpm --filter @region-split/ui typecheck
```

Expected: 两个命令退出码均为 `0`。

- [ ] **Step 4: 运行 UI 生产构建**

Run:

```powershell
$env:PNPM_HOME='D:\workspace\ui\.pnpm-bin'; $env:PNPM_STORE_DIR='D:\workspace\ui\.pnpm-store'; pnpm --filter @region-split/ui build
```

Expected: Vite 构建成功，无 TypeScript 或打包错误。

- [ ] **Step 5: 检查差异和工作区状态**

Run:

```powershell
git --no-pager diff --check; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; git --no-pager status --short
```

Expected: `diff --check` 无输出；只显示预期功能文件以及用户原有的 `.npmrc` 改动，不包含临时文件。

- [ ] **Step 6: 如验证修正产生未提交改动，提交修正**

仅当 Step 1–5 的修正产生功能文件改动时运行：

```powershell
git add apps/region-split-ui/src/state.ts apps/region-split-ui/src/state.test.ts apps/region-split-ui/src/components/RegionList.vue apps/region-split-ui/src/components/RegionList.test.ts; git commit -m "test: verify region boundary controls"
```

不要暂存或提交用户原有的 `.npmrc` 改动。

- [ ] **Step 7: 推送当前分支**

```powershell
git push
```

Expected: 当前 `feature/region-split` 分支成功推送到其 upstream；不使用 force push。
