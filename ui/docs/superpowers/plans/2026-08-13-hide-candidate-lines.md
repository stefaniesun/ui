# 隐藏候选分隔线实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 隐藏区域分析图中的金色候选分隔线，同时保留拆分时的候选线吸附能力。

**Architecture:** 只移除 `RegionCanvas` 的候选线可视层和上层可见性 props/state，不删除 `store.candidateLines`。拆分模式继续将候选线传给 `snapToCandidates()`，因此视觉层变化不会影响坐标和吸附算法。

**Tech Stack:** Vue 3、TypeScript、Vitest、Vue Test Utils。

---

### Task 1: 隐藏候选线视觉层并保留拆分吸附

**Files:**
- Modify: `apps/region-split-ui/src/components/RegionCanvas.test.ts`
- Modify: `apps/region-split-ui/src/components/RegionCanvas.vue`
- Modify: `apps/region-split-ui/src/canvas/nodes/RegionsNode.test.ts`
- Modify: `apps/region-split-ui/src/canvas/nodes/RegionsNode.vue`
- Modify: `apps/region-split-ui/src/App.vue`

- [ ] **Step 1: 编写候选线永不渲染的失败测试**

在 `RegionCanvas.test.ts` 创建包含候选线的 analyzed 文档，挂载组件后断言：

```ts
expect(wrapper.findAll(".candidate-line")).toHaveLength(0);
```

同时保留并运行现有拆分吸附用例，证明 `pointermove` 仍调用候选线吸附并将预览线移动到候选位置。

- [ ] **Step 2: 运行测试确认红灯**

Run:

```powershell
D:/nodejs/corepack.cmd pnpm --filter @region-split/ui test -- src/components/RegionCanvas.test.ts
```

Expected: 新增的“不渲染候选线”断言失败，现有拆分吸附用例通过。

- [ ] **Step 3: 删除 `RegionCanvas` 候选线可视层**

从 `RegionCanvas.vue` 删除：

- `showCandidateLines` prop。
- 模板中的 `.candidate-line` 循环元素。
- `.candidate-line` CSS。

保留拆分定位中的候选线参数：

```ts
splitY.value = snapToCandidates(
  rawY,
  props.store.candidateLines.value,
  threshold,
  image.value.height,
);
```

不得删除或清空 `store.candidateLines`。

- [ ] **Step 4: 清理上层候选线显示 props 和状态**

在 `RegionsNode.vue` 删除 `showCandidateLines` prop 及传给 `RegionCanvas` 的 `:show-candidate-lines`。

在 `App.vue` 删除：

```ts
const showCandidateLines = ref(true);
```

并删除传给 `RegionsNode` 的 `:show-candidate-lines`。保留 `showPanels`，因为表面区块覆盖层仍是独立能力。

- [ ] **Step 5: 更新组件测试装配参数**

从 `RegionsNode.test.ts` 和 `RegionCanvas.test.ts` 的 mount props 中删除 `showCandidateLines`，并增加断言：

```ts
expect(wrapper.find(".candidate-line").exists()).toBe(false);
```

不要删除现有候选吸附、非法拆分位置和有效提交测试。

- [ ] **Step 6: 运行定向测试与类型检查**

Run:

```powershell
D:/nodejs/corepack.cmd pnpm --filter @region-split/ui test -- src/components/RegionCanvas.test.ts src/canvas/nodes/RegionsNode.test.ts src/coords.test.ts
D:/nodejs/corepack.cmd pnpm --filter @region-split/ui typecheck
```

Expected: 所有测试和类型检查通过。

- [ ] **Step 7: 运行全量验证与构建**

Run:

```powershell
D:/nodejs/corepack.cmd pnpm test
D:/nodejs/corepack.cmd pnpm --filter @region-split/core typecheck
D:/nodejs/corepack.cmd pnpm --filter @region-split/ui typecheck
D:/nodejs/corepack.cmd pnpm --filter @region-split/ui build
git diff --check
```

Expected: 全量测试、逐包类型检查、UI 构建和空白检查全部通过。

- [ ] **Step 8: 提交并推送**

```powershell
git add apps/region-split-ui/src/App.vue apps/region-split-ui/src/canvas/nodes/RegionsNode.vue apps/region-split-ui/src/canvas/nodes/RegionsNode.test.ts apps/region-split-ui/src/components/RegionCanvas.vue apps/region-split-ui/src/components/RegionCanvas.test.ts
git commit -m "fix: hide candidate split lines"
git push
```

Expected: 提交成功；若网络仍重置，保留本地提交并报告，不修改 git config。
